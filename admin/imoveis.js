import { requireAdmin, showAdminError } from "../src/lib/admin.js";
import { escapeHTML, getImageURL, getStoragePath, getStorageURL, supabase } from "../src/lib/supabase.js";
import pdfWorkerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let pdfjsLib = null;

const form = document.getElementById("propertyForm");
const dialog = document.getElementById("propertyDialog");
const galleryPreview = document.getElementById("galleryPreview");
const coverPreview = document.getElementById("coverPreview");
const coverFramingPanel = document.getElementById("coverFraming");
const saveButton = document.getElementById("saveProperty");
const videoURLInput = form.elements.namedItem("video_url");
const pdfInput = document.getElementById("pdfInput");
const pdfPageGrid = document.getElementById("pdfPageGrid");
const pdfImportStatus = document.getElementById("pdfImportStatus");
const pdfAddSelectedButton = document.getElementById("pdfAddSelected");
const pdfLoadMoreButton = document.getElementById("pdfLoadMore");
let properties = [];
let currentProperty = null;
let currentPropertiesPage = 0;
let hasNextPropertiesPage = false;
let propertyLoadGeneration = 0;
let propertySearchTimer = null;
let galleryItems = [];
let coverPath = null;
let coverPreviewURL = null;
let coverFraming = defaultCoverFraming();
let coverDrag = null;
let isSaving = false;
let pdfLoadingTask = null;
let pdfDocument = null;
let pdfPages = [];
let pdfObserver = null;
let pdfRenderQueue = Promise.resolve();
let pdfGeneration = 0;
let pdfProcessing = false;
const pdfRenderedPages = new Set();
let propertyThumbnailObserver = null;
let galleryPreviewObserver = null;
const pdfPreviewURLs = new Set();
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_PDF_SIZE = 50 * 1024 * 1024;
const MAX_PDF_IMAGE_SIZE = 9 * 1024 * 1024;
const PROPERTIES_PAGE_SIZE = 40;
const latestDelivery = new Date();
latestDelivery.setMonth(latestDelivery.getMonth() + 36);
const deliveryDateInput = form.elements.namedItem("data_entrega");
deliveryDateInput.max = new Date(latestDelivery.getTime() - latestDelivery.getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

function defaultCoverFraming() {
  return {
    card: { x: 50, y: 50, zoom: 1 },
    detail: { x: 50, y: 50, zoom: 1 }
  };
}

function normalizeCoverFraming(value) {
  const defaults = defaultCoverFraming();
  const clamp = (input, min, max, fallback) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  return Object.fromEntries(["card", "detail"].map(view => {
    const frame = value?.[view] || defaults[view];
    return [view, {
      x: clamp(frame.x, 0, 100, 50),
      y: clamp(frame.y, 0, 100, 50),
      zoom: clamp(frame.zoom, 0.7, 2.5, 1)
    }];
  }));
}

function renderCoverFrames() {
  const source = coverPreview.hidden ? "" : coverPreview.src;
  coverFramingPanel.hidden = !source;
  document.querySelectorAll("[data-cover-preview]").forEach(preview => {
    const view = preview.dataset.coverPreview;
    preview.replaceChildren();
    if (!source) return;
    const image = new Image();
    image.alt = "Prévia do enquadramento da capa";
    image.draggable = false;
    image.src = source;
    preview.append(image);
    updateCoverFrame(view);
  });
}

function updateCoverFrame(view) {
  const frame = coverFraming[view];
  const preview = document.querySelector(`[data-cover-preview="${view}"]`);
  const image = preview?.querySelector("img");
  if (!frame || !image) return;
  image.style.objectFit = frame.zoom < 1 ? "contain" : "cover";
  image.style.objectPosition = `${frame.x}% ${frame.y}%`;
  image.style.transform = `scale(${frame.zoom})`;
  image.style.transformOrigin = `${frame.x}% ${frame.y}%`;
  const zoomInput = document.querySelector(`[data-cover-zoom="${view}"]`);
  if (zoomInput) zoomInput.value = frame.zoom;
}

function releaseGalleryPreviews() {
  galleryItems.forEach(item => {
    if (item.file && item.preview) URL.revokeObjectURL(item.preview);
  });
}

function setSaveBusy(busy) {
  isSaving = busy;
  form.querySelectorAll("input, select, textarea, button").forEach(control => {
    if (busy) {
      control.dataset.wasDisabled = String(control.disabled);
      control.disabled = true;
    } else {
      control.disabled = control.dataset.wasDisabled === "true";
      delete control.dataset.wasDisabled;
    }
  });
  dialog.setAttribute("aria-busy", String(busy));
}

function releasePdfPreviews() {
  pdfObserver?.disconnect();
  pdfObserver = null;
  pdfPreviewURLs.forEach(url => URL.revokeObjectURL(url));
  pdfPreviewURLs.clear();
  pdfPageGrid.replaceChildren();
  pdfLoadMoreButton.hidden = true;
  pdfRenderedPages.clear();
}

async function clearPdfImport() {
  pdfGeneration += 1;
  releasePdfPreviews();
  const task = pdfLoadingTask;
  pdfLoadingTask = null;
  if (task) {
    try {
      await task.destroy();
    } catch (error) {
      console.error("Erro ao liberar o leitor de PDF:", error);
    }
  }
  pdfDocument = null;
  pdfPages = [];
  pdfRenderedPages.clear();
  pdfProcessing = false;
  pdfInput.value = "";
  pdfInput.disabled = isSaving;
  document.getElementById("closePropertyDialog").disabled = isSaving;
  document.getElementById("cancelProperty").disabled = isSaving;
  pdfAddSelectedButton.disabled = true;
  pdfImportStatus.textContent = "";
}

function notify(message) {
  const notice = document.getElementById("adminNotice");
  notice.hidden = false;
  notice.textContent = message;
}

function validateVideoURL() {
  const value = videoURLInput.value.trim();
  if (!value) {
    videoURLInput.setCustomValidity("");
    return true;
  }
  try {
    const url = new URL(value);
    const valid = ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password;
    videoURLInput.setCustomValidity(valid
      ? ""
      : "Use um link HTTP ou HTTPS válido do YouTube, Instagram, TikTok ou de outro vídeo.");
    return Boolean(valid);
  } catch {
    videoURLInput.setCustomValidity("Use um link HTTP ou HTTPS válido do YouTube, Instagram, TikTok ou de outro vídeo.");
    return false;
  }
}

function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function loadProperties() {
  const generation = ++propertyLoadGeneration;
  const search = document.getElementById("propertySearch").value.trim()
    .replace(/[(),%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let query = supabase
    .from("imoveis")
    .select("id, titulo, slug, nome_empreendimento, regiao, bairro, area_m2, status, destaque, imagem_capa, enquadramento_capa, created_at");
  const region = document.getElementById("regionFilter").value;
  const status = document.getElementById("statusFilter").value;
  if (search) query = query.or(`titulo.ilike.%${search}%,nome_empreendimento.ilike.%${search}%`);
  if (region) query = query.eq("regiao", region);
  if (status) query = query.eq("status", status);
  query = query.order("created_at", { ascending: false })
    .range(currentPropertiesPage * PROPERTIES_PAGE_SIZE, currentPropertiesPage * PROPERTIES_PAGE_SIZE + PROPERTIES_PAGE_SIZE);
  document.getElementById("propertiesPrevious").disabled = true;
  document.getElementById("propertiesNext").disabled = true;
  document.getElementById("propertyList").innerHTML = '<p class="admin-empty-message">Carregando imóveis...</p>';
  const { data, error } = await query;
  if (generation !== propertyLoadGeneration) return;
  if (error) {
    document.getElementById("propertyList").innerHTML =
      `<p class="admin-empty-message">Não foi possível carregar os imóveis: ${escapeHTML(error.message)}</p>`;
    document.querySelector(".property-pagination").hidden = true;
    throw error;
  }
  const rows = data || [];
  hasNextPropertiesPage = rows.length > PROPERTIES_PAGE_SIZE;
  properties = rows.slice(0, PROPERTIES_PAGE_SIZE);
  if (!properties.length && currentPropertiesPage > 0) {
    currentPropertiesPage -= 1;
    return loadProperties();
  }
  document.getElementById("propertiesPrevious").disabled = currentPropertiesPage === 0;
  document.getElementById("propertiesNext").disabled = !hasNextPropertiesPage;
  document.getElementById("propertiesPage").textContent = `Página ${currentPropertiesPage + 1}`;
  document.querySelector(".property-pagination").hidden = !properties.length;
  renderProperties();
}

function loadPropertyThumbnails(list) {
  propertyThumbnailObserver?.disconnect();
  const images = list.querySelectorAll("[data-thumbnail]");
  const loadImage = async image => {
    try {
      image.src = await getImageURL(image.dataset.thumbnail, {
        width: 240,
        quality: 68,
        resize: "contain"
      });
      image.removeAttribute("data-thumbnail");
    } catch (error) {
      console.error("Erro ao carregar miniatura do imóvel:", error);
      image.replaceWith(Object.assign(document.createElement("div"), {
        className: "property-list-image property-list-placeholder"
      }));
      notify(`Não foi possível carregar uma miniatura: ${error.message}`);
    }
  };
  if (!("IntersectionObserver" in window)) {
    images.forEach(image => { loadImage(image); });
    return;
  }
  propertyThumbnailObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      propertyThumbnailObserver.unobserve(entry.target);
      loadImage(entry.target);
    });
  }, { rootMargin: "160px" });
  images.forEach(image => propertyThumbnailObserver.observe(image));
}

function renderProperties() {
  const filtered = properties;
  const list = document.getElementById("propertyList");
  if (!filtered.length) {
    list.innerHTML = '<p class="admin-empty-message">Nenhum imóvel encontrado.</p>';
    return;
  }
  list.innerHTML = filtered.map(property => {
    const frame = normalizeCoverFraming(property.enquadramento_capa).card;
    return `<article class="property-list-item">
      ${property.imagem_capa ? `<img data-thumbnail="${escapeHTML(property.imagem_capa)}" alt="" class="property-list-image" loading="lazy" decoding="async" style="object-fit:${frame.zoom < 1 ? "contain" : "cover"};object-position:${frame.x}% ${frame.y}%;transform:scale(${frame.zoom});transform-origin:${frame.x}% ${frame.y}%">` : '<div class="property-list-image property-list-placeholder"></div>'}
      <div class="property-list-info"><h2>${escapeHTML(property.nome_empreendimento || property.titulo)}</h2><p>${escapeHTML([property.bairro, property.regiao, property.area_m2 !== null && property.area_m2 !== undefined && property.area_m2 !== "" ? `${property.area_m2} m²` : ""].filter(Boolean).join(" · "))}</p><span class="property-status ${property.status}">${property.status === "publicado" ? "Publicado" : "Rascunho"}</span>${property.destaque ? '<span class="property-featured">Destaque</span>' : ""}</div>
      <div class="property-actions">
        <button type="button" class="admin-secondary" data-action="toggle" data-id="${property.id}">${property.status === "publicado" ? "Despublicar" : "Publicar"}</button>
        <button type="button" class="admin-secondary" data-action="feature" data-id="${property.id}">${property.destaque ? "Remover destaque" : "Destacar"}</button>
        <button type="button" class="admin-secondary" data-action="edit" data-id="${property.id}">Editar</button>
        <button type="button" class="admin-danger" data-action="delete" data-id="${property.id}">Excluir</button>
      </div>
    </article>`;
  }).join("");
  loadPropertyThumbnails(list);
}

function setFormValue(name, value) {
  const field = form.elements.namedItem(name);
  if (field) field.value = value ?? "";
}

async function resetForm() {
  form.reset();
  validateVideoURL();
  currentProperty = null;
  releaseGalleryPreviews();
  galleryItems = [];
  coverPath = null;
  coverFraming = defaultCoverFraming();
  form.elements.namedItem("slug").dataset.edited = "";
  document.getElementById("coverActions").hidden = true;
  coverPreview.hidden = true;
  coverPreview.removeAttribute("src");
  if (coverPreviewURL) URL.revokeObjectURL(coverPreviewURL);
  coverPreviewURL = null;
  renderCoverFrames();
  await clearPdfImport();
  document.getElementById("propertyFormTitle").textContent = "Novo apartamento";
  renderGallery();
}

async function editProperty(property) {
  await resetForm();
  notify("Carregando os dados atuais do imóvel...");
  const { data: latest, error } = await supabase.from("imoveis")
    .select("*, imagens_imoveis(id, url, ordem, created_at)")
    .eq("id", property.id)
    .single();
  if (error) throw error;

  currentProperty = latest;
  coverPath = latest.imagem_capa ? getStoragePath(latest.imagem_capa) : null;
  document.getElementById("coverActions").hidden = !coverPath;
  coverFraming = normalizeCoverFraming(latest.enquadramento_capa);
  for (const [name, value] of Object.entries(latest)) {
    if (["id", "created_at", "updated_at", "imagem_capa", "enquadramento_capa", "imagens_imoveis"].includes(name)) continue;
    if (name === "destaque") form.elements.namedItem(name).checked = value;
    else setFormValue(name, value);
  }
  if (coverPath) {
    try {
      coverPreview.src = await getImageURL(latest.imagem_capa, {
        width: 1000,
        quality: 78,
        resize: "contain"
      });
      coverPreview.hidden = false;
    } catch (error) {
      notify(`Não foi possível carregar a imagem de capa: ${error.message}`);
    }
  }
  renderCoverFrames();
  galleryItems = (latest.imagens_imoveis || [])
    .sort((a, b) => a.ordem - b.ordem)
    .map(image => ({ id: image.id, url: image.url, preview: "" }));
  document.getElementById("propertyFormTitle").textContent = "Editar apartamento";
  renderGallery();
  dialog.showModal();
}

function renderGallery() {
  galleryPreview.innerHTML = galleryItems.map((item, index) => `<div class="gallery-preview-item">
    ${item.preview ? `<img src="${escapeHTML(item.preview)}" alt="Imagem ${index + 1} da galeria" loading="lazy" decoding="async">` : item.url ? `<img data-gallery-url="${escapeHTML(item.url)}" alt="Imagem ${index + 1} da galeria" loading="lazy" decoding="async">` : '<div class="gallery-preview-placeholder" aria-hidden="true"></div>'}
    <span>${index + 1}</span>
    <button type="button" data-gallery-action="up" data-index="${index}" aria-label="Mover imagem para cima" ${index === 0 ? "disabled" : ""}>↑</button>
    <button type="button" data-gallery-action="down" data-index="${index}" aria-label="Mover imagem para baixo" ${index === galleryItems.length - 1 ? "disabled" : ""}>↓</button>
    <button type="button" data-gallery-action="replace" data-index="${index}" aria-label="Substituir imagem">Substituir</button>
    <button type="button" data-gallery-action="remove" data-index="${index}" aria-label="Remover imagem">×</button>
    <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" data-gallery-file="${index}" aria-label="Escolher imagem substituta">
  </div>`).join("");
  loadGalleryPreviews(galleryPreview);
}

function loadGalleryPreviews(container) {
  galleryPreviewObserver?.disconnect();
  const images = container.querySelectorAll("[data-gallery-url]");
  const loadImage = async image => {
    try {
      image.src = await getImageURL(image.dataset.galleryUrl, {
        width: 320,
        height: 220,
        quality: 70,
        resize: "contain"
      });
      image.removeAttribute("data-gallery-url");
    } catch (error) {
      console.error("Erro ao carregar prévia da galeria:", error);
      image.replaceWith(Object.assign(document.createElement("div"), {
        className: "gallery-preview-placeholder"
      }));
      notify(`Não foi possível carregar uma prévia da galeria: ${error.message}`);
    }
  };
  if (!("IntersectionObserver" in window)) {
    images.forEach(image => { loadImage(image); });
    return;
  }
  galleryPreviewObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      galleryPreviewObserver.unobserve(entry.target);
      loadImage(entry.target);
    });
  }, { root: dialog, rootMargin: "80px" });
  images.forEach(image => galleryPreviewObserver.observe(image));
}

function updatePdfSelection() {
  const selected = pdfPages.filter(page => page.selected).length;
  pdfImportStatus.textContent = pdfPages.length
    ? `${pdfPages.length} páginas disponíveis; ${selected} selecionada${selected === 1 ? "" : "s"}.`
    : pdfImportStatus.textContent;
  pdfAddSelectedButton.disabled = isSaving || pdfProcessing || !pdfDocument || selected === 0;
  pdfLoadMoreButton.disabled = isSaving || pdfProcessing;
  pdfInput.disabled = isSaving || pdfProcessing;
  document.getElementById("closePropertyDialog").disabled = isSaving || pdfProcessing;
  document.getElementById("cancelProperty").disabled = isSaving || pdfProcessing;
  saveButton.disabled = isSaving || pdfProcessing;
  pdfPageGrid.querySelectorAll("[data-pdf-select], [data-pdf-remove]").forEach(control => {
    control.disabled = isSaving || pdfProcessing;
  });
}

function queuePdfRender(render) {
  const queued = pdfRenderQueue.then(render, render);
  pdfRenderQueue = queued.catch(() => {});
  return queued;
}

function observePdfPreviews() {
  if (!("IntersectionObserver" in window)) {
    pdfPageGrid.querySelectorAll("[data-pdf-page]").forEach(item => renderPdfThumbnail(Number(item.dataset.pdfPage), pdfGeneration));
    return;
  }
  pdfObserver?.disconnect();
  pdfObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      pdfObserver.unobserve(entry.target);
      renderPdfThumbnail(Number(entry.target.dataset.pdfPage), pdfGeneration);
    });
  }, { root: dialog, rootMargin: "120px" });
  pdfPageGrid.querySelectorAll("[data-pdf-page]").forEach(item => pdfObserver.observe(item));
}

function appendPdfPageBatch() {
  const batch = pdfPages.filter(page => !pdfRenderedPages.has(page.number)).slice(0, 30);
  if (!batch.length) {
    pdfLoadMoreButton.hidden = true;
    return;
  }
  const markup = batch.map(page => `<article class="pdf-page-item" data-pdf-page="${page.number}">
    <div class="pdf-thumbnail-wrap"><span>Prévia será carregada ao visualizar</span><img alt="Prévia da página ${page.number} do PDF" hidden loading="lazy" decoding="async"></div>
    <div class="pdf-page-controls"><label><input type="checkbox" data-pdf-select="${page.number}"> Página ${page.number}</label><button type="button" data-pdf-remove="${page.number}">Excluir</button></div>
  </article>`).join("");
  pdfPageGrid.insertAdjacentHTML("beforeend", markup);
  batch.forEach(page => pdfRenderedPages.add(page.number));
  pdfLoadMoreButton.hidden = pdfRenderedPages.size >= pdfPages.length;
  observePdfPreviews();
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("O navegador não conseguiu gerar uma imagem para a página do PDF."));
    }, "image/jpeg", quality);
  });
}

async function renderPdfThumbnail(pageNumber, generation) {
  await queuePdfRender(async () => {
    if (generation !== pdfGeneration || !pdfDocument) return;
    const item = pdfPageGrid.querySelector(`[data-pdf-page="${pageNumber}"]`);
    const image = item?.querySelector("img");
    const placeholder = item?.querySelector(".pdf-thumbnail-wrap span");
    if (!item || !image || image.src) return;
    let canvas;
    let page;
    try {
      page = await pdfDocument.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(0.35, 180 / base.width) });
      canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("O navegador não conseguiu criar o canvas da prévia.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      if (generation !== pdfGeneration) return;
      const blob = await canvasBlob(canvas, 0.7);
      const url = URL.createObjectURL(blob);
      pdfPreviewURLs.add(url);
      image.src = url;
      image.hidden = false;
      if (placeholder) placeholder.hidden = true;
    } catch (error) {
      if (generation === pdfGeneration) {
        if (placeholder) placeholder.textContent = "Prévia indisponível";
        notify(`Não foi possível gerar a prévia da página ${pageNumber}: ${error.message}`);
      }
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      page?.cleanup();
    }
  });
}

async function renderPdfPageImage(pageNumber, generation) {
  return queuePdfRender(async () => {
    if (generation !== pdfGeneration || !pdfDocument) throw new Error("O PDF foi fechado antes do fim da conversão.");
    const page = await pdfDocument.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const targetScale = Math.min(2.5, 2200 / Math.max(base.width, base.height));
    let canvas;
    try {
      for (let pass = 0; pass < 3; pass += 1) {
        const viewport = page.getViewport({ scale: targetScale * (0.82 ** pass) });
        canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("O navegador não conseguiu criar o canvas da página.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        for (const quality of [0.9, 0.84, 0.78]) {
          const blob = await canvasBlob(canvas, quality);
          if (blob.size <= MAX_PDF_IMAGE_SIZE) {
            return new File([blob], `pagina-${pageNumber}.jpg`, { type: "image/jpeg" });
          }
        }
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
      throw new Error(`A página ${pageNumber} excede o limite de 9 MB mesmo após a compressão.`);
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      page.cleanup();
    }
  });
}

async function loadPdf(file) {
  await clearPdfImport();
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) || file.size > MAX_PDF_SIZE) {
    pdfInput.value = "";
    pdfImportStatus.textContent = "Selecione um arquivo PDF com até 50 MB.";
    return;
  }

  const generation = pdfGeneration;
  pdfImportStatus.textContent = "Lendo PDF...";
  try {
    if (!pdfjsLib) pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerURL;
    const task = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
    pdfLoadingTask = task;
    const documentProxy = await task.promise;
    if (generation !== pdfGeneration) {
      await task.destroy();
      return;
    }
    pdfDocument = documentProxy;
    pdfPages = Array.from({ length: documentProxy.numPages }, (_, index) => ({
      number: index + 1,
      selected: false
    }));
    appendPdfPageBatch();
    updatePdfSelection();
    pdfImportStatus.textContent = `${documentProxy.numPages} páginas encontradas. Marque as páginas que deseja adicionar.`;
  } catch (error) {
    if (generation !== pdfGeneration) return;
    pdfImportStatus.textContent = `Não foi possível ler o PDF: ${error.message}`;
    notify(`Não foi possível ler o PDF: ${error.message}`);
    await clearPdfImport();
    pdfImportStatus.textContent = `Não foi possível ler o PDF: ${error.message}`;
  }
}

async function addSelectedPdfPages() {
  const selected = pdfPages.filter(page => page.selected);
  if (!selected.length || pdfProcessing) return;
  const generation = pdfGeneration;
  const convertedFiles = [];
  pdfProcessing = true;
  updatePdfSelection();
  try {
    for (const [index, page] of selected.entries()) {
      pdfImportStatus.textContent = `Convertendo página ${index + 1} de ${selected.length}...`;
      convertedFiles.push(await renderPdfPageImage(page.number, generation));
    }
    if (generation !== pdfGeneration) return;
    galleryItems.push(...convertedFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file)
    })));
    selected.forEach(page => { page.selected = false; });
    renderGallery();
    updatePdfSelection();
    pdfImportStatus.textContent = `${convertedFiles.length} página${convertedFiles.length === 1 ? "" : "s"} adicionada${convertedFiles.length === 1 ? "" : "s"} à galeria.`;
  } catch (error) {
    notify(`Não foi possível converter as páginas selecionadas: ${error.message}`);
    pdfImportStatus.textContent = `Falha na conversão: ${error.message}`;
  } finally {
    pdfProcessing = false;
    updatePdfSelection();
  }
}

function fileExtension(file) {
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
  if (!extensions[file.type] || file.size > MAX_IMAGE_SIZE) {
    throw new Error("Escolha imagens JPG, PNG, WebP ou AVIF com no máximo 10 MB.");
  }
  return extensions[file.type];
}

async function optimizeImage(file) {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap;
  let canvas;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    console.warn("Não foi possível redimensionar a imagem; o arquivo original será enviado:", error);
    return file;
  }
  try {
    const maxDimension = Math.max(bitmap.width, bitmap.height);
    const initialScale = Math.min(1, 2560 / maxDimension);
    if (initialScale === 1 && file.size <= 8 * 1024 * 1024) return file;
    canvas = document.createElement("canvas");
    for (let pass = 0; pass < 3; pass += 1) {
      const scale = initialScale * (0.85 ** pass);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.84, 0.78]) {
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(result => {
            if (result) resolve(result);
            else reject(new Error("O navegador não conseguiu comprimir a imagem."));
          }, "image/webp", quality);
        });
        if (blob.size < file.size && blob.size <= MAX_IMAGE_SIZE) {
          const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
          const extension = extensions[blob.type] || fileExtension(file);
          const name = file.name.replace(/\.[^.]+$/, "");
          return new File([blob], `${name}.${extension}`, { type: blob.type || file.type });
        }
      }
    }
    return file;
  } finally {
    bitmap.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

async function uploadImage(file, propertyId) {
  const optimizedFile = await optimizeImage(file);
  const path = `${propertyId}/${crypto.randomUUID()}.${fileExtension(optimizedFile)}`;
  const { error } = await supabase.storage.from("imoveis").upload(path, optimizedFile, {
    cacheControl: "3600",
    contentType: optimizedFile.type,
    upsert: false
  });
  if (error) throw error;
  return path;
}

function propertyPayload() {
  const values = new FormData(form);
  const optionalText = name => String(values.get(name) || "").trim() || null;
  return {
    titulo: String(values.get("titulo")).trim(),
    slug: slugify(String(values.get("slug"))),
    descricao: optionalText("descricao"),
    nome_empreendimento: optionalText("nome_empreendimento"),
    construtora: optionalText("construtora"),
    categoria: "Apartamento",
    padrao: values.get("padrao"),
    regiao: values.get("regiao"),
    bairro: String(values.get("bairro")).trim(),
    cidade: String(values.get("cidade")).trim(),
    estado: String(values.get("estado")).trim().toUpperCase(),
    endereco: optionalText("endereco"),
    preco: values.get("preco") ? Number(values.get("preco")) : null,
    area_m2: Number(values.get("area_m2")),
    quartos: values.get("quartos") ? Number(values.get("quartos")) : null,
    suites: values.get("suites") ? Number(values.get("suites")) : null,
    banheiros: values.get("banheiros") ? Number(values.get("banheiros")) : null,
    vagas: values.get("vagas") ? Number(values.get("vagas")) : null,
    data_entrega: values.get("data_entrega") || null,
    video_url: optionalText("video_url"),
    planta_url: optionalText("planta_url"),
    destaque: values.has("destaque"),
    status: values.get("status"),
    enquadramento_capa: normalizeCoverFraming(coverFraming)
  };
}

async function saveGallery(propertyId, uploadedPaths) {
  const existing = currentProperty?.imagens_imoveis || [];
  const selectedIds = new Set(galleryItems.filter(item => item.id).map(item => item.id));
  const maxOrder = existing.reduce((maximum, image) => Math.max(maximum, image.ordem), -1);
  for (const [index, image] of existing.entries()) {
    const { error } = await supabase.from("imagens_imoveis")
      .update({ ordem: maxOrder + index + 1 })
      .eq("id", image.id);
    if (error) throw error;
  }

  const gallery = [];
  const replacedPaths = [];
  for (const [ordem, item] of galleryItems.entries()) {
    let path;
    if (item.file) {
      path = await uploadImage(item.file, propertyId);
      uploadedPaths.push(path);
      if (item.id && item.url) replacedPaths.push(getStoragePath(item.url));
    } else {
      path = getStoragePath(item.url);
    }
    gallery.push({ ...(item.id ? { id: item.id } : {}), imovel_id: propertyId, url: getStorageURL(path), ordem });
  }
  if (gallery.length) {
    const { error } = await supabase.from("imagens_imoveis").upsert(gallery, { onConflict: "id" });
    if (error) throw error;
  }
  const removed = existing.filter(image => !selectedIds.has(image.id));
  if (removed.length) {
    const { error } = await supabase.from("imagens_imoveis").delete().in("id", removed.map(image => image.id));
    if (error) throw error;
  }
  return [...replacedPaths, ...removed.map(image => getStoragePath(image.url))];
}

async function saveProperty(event) {
  event.preventDefault();
  if (isSaving) return;
  if (pdfProcessing) {
    notify("Aguarde a conversão das páginas do PDF antes de salvar o imóvel.");
    return;
  }
  validateVideoURL();
  if (!form.reportValidity()) return;
  setSaveBusy(true);
  const saveButtonText = saveButton.textContent;
  saveButton.textContent = "Salvando...";
  const uploadedPaths = [];
  const oldCover = currentProperty?.imagem_capa;
  let propertySaved = false;
  let newCover = coverPath;
  const propertyId = currentProperty?.id || crypto.randomUUID();
  try {
    const coverFile = document.getElementById("coverInput").files[0];
    if (coverFile) {
      newCover = await uploadImage(coverFile, propertyId);
      uploadedPaths.push(newCover);
    }
    const values = propertyPayload();
    values.id = propertyId;
    const newCoverURL = newCover ? getStorageURL(newCover) : null;
    values.imagem_capa = newCoverURL;
    const query = currentProperty
      ? supabase.from("imoveis").update(values).eq("id", currentProperty.id)
      : supabase.from("imoveis").insert(values);
    const { data, error } = await query.select().single();
    if (error) throw error;
    propertySaved = true;

    const removedGalleryPaths = await saveGallery(data.id, uploadedPaths);
    const retainedPaths = new Set(galleryItems
      .filter(item => item.url && !item.file)
      .map(item => getStoragePath(item.url)));
    if (!coverFile && newCover) retainedPaths.add(newCover);
    const deletedPaths = [...removedGalleryPaths, ...(oldCover && oldCover !== newCoverURL ? [getStoragePath(oldCover)] : [])]
      .filter(path => path && path !== newCover && !retainedPaths.has(path));
    let cleanupMessage = "";
    if (deletedPaths.length) {
      const { error: removeError } = await supabase.storage.from("imoveis").remove([...new Set(deletedPaths)]);
      if (removeError) cleanupMessage = ` O imóvel foi salvo, mas não foi possível excluir algumas imagens antigas: ${removeError.message}`;
    }

    dialog.close();
    await resetForm();
    await loadProperties();
    notify(`Imóvel salvo com sucesso.${cleanupMessage}`);
  } catch (error) {
    if (uploadedPaths.length && !propertySaved) {
      const { error: cleanupError } = await supabase.storage.from("imoveis").remove(uploadedPaths);
      if (cleanupError) {
        notify(`${error.message} Também não foi possível limpar as imagens enviadas: ${cleanupError.message}`);
      } else {
        notify(error.message);
      }
    }
    if (!uploadedPaths.length || propertySaved) {
      notify(propertySaved
        ? `Os dados básicos foram salvos, mas houve um erro ao atualizar a galeria: ${error.message}`
        : `Não foi possível salvar o imóvel: ${error.message}`);
    }
    if (propertySaved) {
      try {
        const { data: latest, error: refreshError } = await supabase.from("imoveis")
          .select("*, imagens_imoveis(id, url, ordem, created_at)")
          .eq("id", propertyId)
          .single();
        if (refreshError) throw refreshError;
        currentProperty = latest;
        document.getElementById("propertyFormTitle").textContent = "Editar apartamento";
        await loadProperties();
      } catch (refreshError) {
        notify(`O imóvel foi salvo parcialmente, mas não foi possível recarregar seu estado atual: ${refreshError.message}`);
      }
    }
  } finally {
    setSaveBusy(false);
    saveButton.textContent = saveButtonText;
  }
}

async function deleteProperty(property) {
  if (!window.confirm(`Excluir "${property.nome_empreendimento || property.titulo}"? Essa ação não pode ser desfeita.`)) return;
  const { data: gallery, error: galleryError } = await supabase.from("imagens_imoveis")
    .select("url")
    .eq("imovel_id", property.id);
  if (galleryError) {
    notify(`Não foi possível carregar as imagens antes da exclusão: ${galleryError.message}`);
    return;
  }
  const { data, error } = await supabase.from("imoveis").delete().eq("id", property.id).select("id").maybeSingle();
  if (error) {
    notify(`Não foi possível excluir o imóvel: ${error.message}`);
    return;
  }
  if (!data) {
    notify("O imóvel não foi excluído. Confirme se a conta ainda tem permissão administrativa.");
    return;
  }
  const paths = [property.imagem_capa, ...(gallery || []).map(image => image.url)]
    .filter(Boolean).map(getStoragePath);
  let cleanupMessage = "";
  if (paths.length) {
    const { error: removeError } = await supabase.storage.from("imoveis").remove([...new Set(paths)]);
    if (removeError) cleanupMessage = ` O imóvel foi excluído, mas falhou a limpeza das imagens: ${removeError.message}`;
  }
  await loadProperties();
  notify(`Imóvel excluído.${cleanupMessage}`);
}

async function updateProperty(id, updates, message) {
  const { data, error } = await supabase.from("imoveis").update(updates).eq("id", id).select("id").maybeSingle();
  if (error) {
    notify(`Não foi possível atualizar o imóvel: ${error.message}`);
    return;
  }
  if (!data) {
    notify("Nenhum imóvel foi atualizado. Confirme se a conta ainda tem permissão administrativa.");
    return;
  }
  await loadProperties();
  notify(message);
}

async function start() {
  if (!await requireAdmin()) return;
  await loadProperties();
}

function refreshPropertyFilters(delay = 0) {
  currentPropertiesPage = 0;
  clearTimeout(propertySearchTimer);
  propertySearchTimer = setTimeout(() => {
    loadProperties().catch(error => showAdminError(error));
  }, delay);
}

document.getElementById("newProperty").addEventListener("click", async () => {
  try {
    await resetForm();
    dialog.showModal();
  } catch (error) {
    notify(`Não foi possível iniciar o cadastro: ${error.message}`);
  }
});
document.getElementById("closePropertyDialog").addEventListener("click", async () => {
  await clearPdfImport();
  dialog.close();
});
document.getElementById("cancelProperty").addEventListener("click", async () => {
  await clearPdfImport();
  dialog.close();
});
dialog.addEventListener("cancel", event => {
  if (pdfProcessing || isSaving) {
    event.preventDefault();
    notify(isSaving
      ? "Aguarde o salvamento do imóvel antes de fechar o formulário."
      : "Aguarde a conversão das páginas do PDF antes de fechar o formulário.");
    return;
  }
  clearPdfImport();
});
document.getElementById("propertySearch").addEventListener("input", () => refreshPropertyFilters(250));
document.getElementById("regionFilter").addEventListener("change", () => refreshPropertyFilters());
document.getElementById("statusFilter").addEventListener("change", () => refreshPropertyFilters());
document.getElementById("propertiesPrevious").addEventListener("click", () => {
  if (currentPropertiesPage === 0) return;
  currentPropertiesPage -= 1;
  loadProperties().catch(error => showAdminError(error));
});
document.getElementById("propertiesNext").addEventListener("click", () => {
  if (!hasNextPropertiesPage) return;
  currentPropertiesPage += 1;
  loadProperties().catch(error => showAdminError(error));
});
document.getElementById("propertyList").addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const property = properties.find(item => item.id === button.dataset.id);
  if (!property) return;
  try {
    if (button.dataset.action === "edit") await editProperty(property);
    if (button.dataset.action === "delete") await deleteProperty(property);
    if (button.dataset.action === "toggle") await updateProperty(property.id, {
      status: property.status === "publicado" ? "rascunho" : "publicado"
    }, property.status === "publicado" ? "Imóvel despublicado." : "Imóvel publicado.");
    if (button.dataset.action === "feature") await updateProperty(property.id, {
      destaque: !property.destaque
    }, property.destaque ? "Destaque removido." : "Imóvel marcado como destaque.");
  } catch (error) {
    notify(`Não foi possível concluir a ação: ${error.message}`);
  }
});
document.getElementById("coverInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    fileExtension(file);
    if (coverPreviewURL) URL.revokeObjectURL(coverPreviewURL);
    coverPreviewURL = URL.createObjectURL(file);
    coverPreview.src = coverPreviewURL;
    coverPreview.hidden = false;
    coverFraming = defaultCoverFraming();
    document.getElementById("coverActions").hidden = false;
    renderCoverFrames();
  } catch (error) {
    event.target.value = "";
    notify(error.message);
  }
});
document.getElementById("removeCover").addEventListener("click", () => {
  document.getElementById("coverInput").value = "";
  if (coverPreviewURL) URL.revokeObjectURL(coverPreviewURL);
  coverPreviewURL = null;
  coverPath = null;
  coverFraming = defaultCoverFraming();
  coverPreview.hidden = true;
  coverPreview.removeAttribute("src");
  document.getElementById("coverActions").hidden = true;
  renderCoverFrames();
});
document.querySelectorAll("[data-cover-zoom]").forEach(input => {
  input.addEventListener("input", event => {
    const view = event.target.dataset.coverZoom;
    coverFraming[view].zoom = Number(event.target.value);
    updateCoverFrame(view);
  });
});
document.querySelectorAll("[data-frame-reset]").forEach(button => {
  button.addEventListener("click", () => {
    const view = button.dataset.frameReset;
    coverFraming[view] = defaultCoverFraming()[view];
    updateCoverFrame(view);
  });
});
document.querySelectorAll("[data-cover-preview]").forEach(preview => {
  preview.addEventListener("pointerdown", event => {
    if (coverPreview.hidden) return;
    const view = preview.dataset.coverPreview;
    coverDrag = {
      view,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      frameX: coverFraming[view].x,
      frameY: coverFraming[view].y
    };
    preview.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  preview.addEventListener("pointermove", event => {
    if (!coverDrag || coverDrag.pointerId !== event.pointerId) return;
    const rect = preview.getBoundingClientRect();
    const frame = coverFraming[coverDrag.view];
    frame.x = Math.min(100, Math.max(0, coverDrag.frameX - (event.clientX - coverDrag.x) * 100 / rect.width));
    frame.y = Math.min(100, Math.max(0, coverDrag.frameY - (event.clientY - coverDrag.y) * 100 / rect.height));
    updateCoverFrame(coverDrag.view);
  });
  preview.addEventListener("pointerup", () => { coverDrag = null; });
  preview.addEventListener("pointercancel", () => { coverDrag = null; });
  preview.addEventListener("keydown", event => {
    const directions = {
      ArrowLeft: ["x", 1],
      ArrowRight: ["x", -1],
      ArrowUp: ["y", 1],
      ArrowDown: ["y", -1]
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const frame = coverFraming[preview.dataset.coverPreview];
    const amount = event.shiftKey ? 5 : 1;
    frame[direction[0]] = Math.min(100, Math.max(0, frame[direction[0]] + direction[1] * amount));
    updateCoverFrame(preview.dataset.coverPreview);
  });
});
document.getElementById("galleryInput").addEventListener("change", event => {
  const files = [...event.target.files];
  try {
    files.forEach(fileExtension);
    galleryItems.push(...files.map(file => ({ file, preview: URL.createObjectURL(file) })));
    event.target.value = "";
    renderGallery();
  } catch (error) {
    event.target.value = "";
    notify(error.message);
  }
});
galleryPreview.addEventListener("click", event => {
  const button = event.target.closest("[data-gallery-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.galleryAction === "replace") {
    galleryPreview.querySelector(`[data-gallery-file="${index}"]`)?.click();
    return;
  }
  if (button.dataset.galleryAction === "remove") {
    const [removed] = galleryItems.splice(index, 1);
    if (removed?.file && removed.preview) URL.revokeObjectURL(removed.preview);
  }
  if (button.dataset.galleryAction === "up" && index > 0) [galleryItems[index - 1], galleryItems[index]] = [galleryItems[index], galleryItems[index - 1]];
  if (button.dataset.galleryAction === "down" && index < galleryItems.length - 1) [galleryItems[index + 1], galleryItems[index]] = [galleryItems[index], galleryItems[index + 1]];
  renderGallery();
});
galleryPreview.addEventListener("change", event => {
  const input = event.target.closest("[data-gallery-file]");
  const file = input?.files[0];
  if (!file) return;
  const index = Number(input.dataset.galleryFile);
  try {
    fileExtension(file);
    const item = galleryItems[index];
    if (item.file && item.preview) URL.revokeObjectURL(item.preview);
    galleryItems[index] = { ...item, file, preview: URL.createObjectURL(file) };
    renderGallery();
  } catch (error) {
    input.value = "";
    notify(error.message);
  }
});
pdfInput.addEventListener("change", event => {
  loadPdf(event.target.files[0]).catch(error => notify(`Não foi possível abrir o PDF: ${error.message}`));
});
pdfPageGrid.addEventListener("change", event => {
  const checkbox = event.target.closest("[data-pdf-select]");
  if (!checkbox) return;
  const page = pdfPages.find(item => item.number === Number(checkbox.dataset.pdfSelect));
  if (page) page.selected = checkbox.checked;
  updatePdfSelection();
});
pdfPageGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-pdf-remove]");
  if (!button) return;
  const pageNumber = Number(button.dataset.pdfRemove);
  pdfPages = pdfPages.filter(page => page.number !== pageNumber);
  const item = pdfPageGrid.querySelector(`[data-pdf-page="${pageNumber}"]`);
  const imageURL = item?.querySelector("img")?.src;
  if (imageURL && pdfPreviewURLs.has(imageURL)) {
    URL.revokeObjectURL(imageURL);
    pdfPreviewURLs.delete(imageURL);
  }
  pdfRenderedPages.delete(pageNumber);
  item?.remove();
  updatePdfSelection();
  pdfLoadMoreButton.hidden = pdfRenderedPages.size >= pdfPages.length;
});
pdfLoadMoreButton.addEventListener("click", appendPdfPageBatch);
pdfAddSelectedButton.addEventListener("click", addSelectedPdfPages);
videoURLInput.addEventListener("input", validateVideoURL);
videoURLInput.addEventListener("change", validateVideoURL);
videoURLInput.addEventListener("invalid", validateVideoURL);
form.elements.namedItem("titulo").addEventListener("input", event => {
  if (!currentProperty || !form.elements.namedItem("slug").dataset.edited) {
    setFormValue("slug", slugify(event.target.value));
  }
});
form.elements.namedItem("slug").addEventListener("input", event => { event.target.dataset.edited = "true"; });
form.addEventListener("submit", saveProperty);

start().catch(error => showAdminError(error));
