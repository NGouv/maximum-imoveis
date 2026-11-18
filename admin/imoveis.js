import { requireAdmin, showAdminError } from "../src/lib/admin.js";
import { escapeHTML, getImageURL, getStoragePath, getStorageURL, supabase } from "../src/lib/supabase.js";

const form = document.getElementById("propertyForm");
const dialog = document.getElementById("propertyDialog");
const galleryPreview = document.getElementById("galleryPreview");
const coverPreview = document.getElementById("coverPreview");
const saveButton = document.getElementById("saveProperty");
const videoURLInput = form.elements.namedItem("video_url");
let properties = [];
let currentProperty = null;
let galleryItems = [];
let coverPath = null;
let coverPreviewURL = null;
const latestDelivery = new Date();
latestDelivery.setMonth(latestDelivery.getMonth() + 36);
const deliveryDateInput = form.elements.namedItem("data_entrega");
deliveryDateInput.max = new Date(latestDelivery.getTime() - latestDelivery.getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

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
  const { data, error } = await supabase
    .from("imoveis")
    .select("*, imagens_imoveis(id, url, ordem, created_at)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  properties = data || [];
  renderProperties();
}

async function renderProperties() {
  const query = document.getElementById("propertySearch").value.trim().toLocaleLowerCase("pt-BR");
  const region = document.getElementById("regionFilter").value;
  const status = document.getElementById("statusFilter").value;
  const filtered = properties.filter(property => {
    const matchesText = !query || `${property.titulo} ${property.nome_empreendimento}`.toLocaleLowerCase("pt-BR").includes(query);
    return matchesText && (!region || property.regiao === region) && (!status || property.status === status);
  });
  const list = document.getElementById("propertyList");
  if (!filtered.length) {
    list.innerHTML = '<p class="admin-empty-message">Nenhum imóvel encontrado.</p>';
    return;
  }
  list.innerHTML = await Promise.all(filtered.map(async property => {
    let image = "";
    if (property.imagem_capa) {
      try {
        image = await getImageURL(property.imagem_capa);
      } catch (error) {
        console.error("Erro ao carregar miniatura do imóvel:", error);
      }
    }
    return `<article class="property-list-item">
      ${image ? `<img src="${image}" alt="" class="property-list-image">` : '<div class="property-list-image property-list-placeholder"></div>'}
      <div class="property-list-info"><h2>${escapeHTML(property.nome_empreendimento)}</h2><p>${escapeHTML(property.bairro)} · ${escapeHTML(property.regiao)} · ${escapeHTML(property.area_m2)} m²</p><span class="property-status ${property.status}">${property.status === "publicado" ? "Publicado" : "Rascunho"}</span>${property.destaque ? '<span class="property-featured">Destaque</span>' : ""}</div>
      <div class="property-actions">
        <button type="button" class="admin-secondary" data-action="toggle" data-id="${property.id}">${property.status === "publicado" ? "Despublicar" : "Publicar"}</button>
        <button type="button" class="admin-secondary" data-action="feature" data-id="${property.id}">${property.destaque ? "Remover destaque" : "Destacar"}</button>
        <button type="button" class="admin-secondary" data-action="edit" data-id="${property.id}">Editar</button>
        <button type="button" class="admin-danger" data-action="delete" data-id="${property.id}">Excluir</button>
      </div>
    </article>`;
  })).then(items => items.join(""));
}

function setFormValue(name, value) {
  form.elements.namedItem(name).value = value ?? "";
}

function resetForm() {
  form.reset();
  validateVideoURL();
  currentProperty = null;
  galleryItems = [];
  coverPath = null;
  form.elements.namedItem("slug").dataset.edited = "";
  coverPreview.hidden = true;
  coverPreview.removeAttribute("src");
  if (coverPreviewURL) URL.revokeObjectURL(coverPreviewURL);
  coverPreviewURL = null;
  document.getElementById("propertyFormTitle").textContent = "Novo apartamento";
  renderGallery();
}

async function editProperty(property) {
  resetForm();
  currentProperty = property;
  coverPath = property.imagem_capa ? getStoragePath(property.imagem_capa) : null;
  for (const [name, value] of Object.entries(property)) {
    if (["id", "created_at", "updated_at", "imagem_capa", "imagens_imoveis"].includes(name)) continue;
    if (name === "destaque") form.elements.namedItem(name).checked = value;
    else setFormValue(name, value);
  }
  if (coverPath) {
    try {
      coverPreview.src = await getImageURL(property.imagem_capa);
      coverPreview.hidden = false;
    } catch (error) {
      notify(`Não foi possível carregar a imagem de capa: ${error.message}`);
    }
  }
  galleryItems = await Promise.all((property.imagens_imoveis || [])
    .sort((a, b) => a.ordem - b.ordem)
    .map(async image => ({ id: image.id, url: image.url, preview: await getImageURL(image.url) })));
  document.getElementById("propertyFormTitle").textContent = "Editar apartamento";
  renderGallery();
  dialog.showModal();
}

function renderGallery() {
  galleryPreview.innerHTML = galleryItems.map((item, index) => `<div class="gallery-preview-item">
    <img src="${item.preview}" alt="Imagem ${index + 1} da galeria">
    <span>${index + 1}</span>
    <button type="button" data-gallery-action="up" data-index="${index}" aria-label="Mover imagem para cima" ${index === 0 ? "disabled" : ""}>↑</button>
    <button type="button" data-gallery-action="down" data-index="${index}" aria-label="Mover imagem para baixo" ${index === galleryItems.length - 1 ? "disabled" : ""}>↓</button>
    <button type="button" data-gallery-action="remove" data-index="${index}" aria-label="Remover imagem">×</button>
  </div>`).join("");
}

function fileExtension(file) {
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
  if (!extensions[file.type] || file.size > 10 * 1024 * 1024) {
    throw new Error("Escolha imagens JPG, PNG, WebP ou AVIF com no máximo 10 MB.");
  }
  return extensions[file.type];
}

async function uploadImage(file, propertyId) {
  const path = `${propertyId}/${crypto.randomUUID()}.${fileExtension(file)}`;
  const { error } = await supabase.storage.from("imoveis").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false
  });
  if (error) throw error;
  return path;
}

function propertyPayload() {
  const values = new FormData(form);
  return {
    titulo: values.get("titulo").trim(),
    slug: slugify(values.get("slug")),
    descricao: values.get("descricao").trim(),
    nome_empreendimento: values.get("nome_empreendimento").trim(),
    construtora: values.get("construtora").trim(),
    categoria: "Apartamento",
    padrao: values.get("padrao"),
    regiao: values.get("regiao"),
    bairro: values.get("bairro").trim(),
    cidade: values.get("cidade").trim(),
    estado: values.get("estado").trim().toUpperCase(),
    endereco: values.get("endereco").trim(),
    preco: values.get("preco") ? Number(values.get("preco")) : null,
    area_m2: Number(values.get("area_m2")),
    quartos: Number(values.get("quartos")),
    suites: Number(values.get("suites")),
    banheiros: Number(values.get("banheiros")),
    vagas: Number(values.get("vagas")),
    data_entrega: values.get("data_entrega") || null,
    video_url: String(values.get("video_url") || "").trim() || null,
    planta_url: values.get("planta_url") || null,
    destaque: values.has("destaque"),
    status: values.get("status")
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
  for (const [ordem, item] of galleryItems.entries()) {
    const path = item.file ? await uploadImage(item.file, propertyId) : getStoragePath(item.url);
    if (item.file) uploadedPaths.push(path);
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
  return removed.map(image => getStoragePath(image.url));
}

async function saveProperty(event) {
  event.preventDefault();
  validateVideoURL();
  if (!form.reportValidity()) return;
  saveButton.disabled = true;
  const uploadedPaths = [];
  const oldCover = currentProperty?.imagem_capa;
  let propertySaved = false;
  let newCover = coverPath;
  try {
    const coverFile = document.getElementById("coverInput").files[0];
    const propertyId = currentProperty?.id || crypto.randomUUID();
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
    const deletedPaths = [...removedGalleryPaths, ...(oldCover && oldCover !== newCoverURL ? [getStoragePath(oldCover)] : [])]
      .filter(path => path !== newCover && !galleryItems.some(item => item.url && getStoragePath(item.url) === path));
    if (deletedPaths.length) {
      const { error: removeError } = await supabase.storage.from("imoveis").remove([...new Set(deletedPaths)]);
      if (removeError) notify(`Imóvel salvo, mas houve erro ao excluir imagens removidas: ${removeError.message}`);
    }

    dialog.close();
    resetForm();
    await loadProperties();
    notify("Imóvel salvo com sucesso.");
  } catch (error) {
    if (uploadedPaths.length && !propertySaved) {
      const { error: cleanupError } = await supabase.storage.from("imoveis").remove(uploadedPaths);
      if (cleanupError) {
        notify(`${error.message} Também não foi possível limpar as imagens enviadas: ${cleanupError.message}`);
        saveButton.disabled = false;
        return;
      }
    }
    notify(propertySaved
      ? `Os dados básicos foram salvos, mas houve um erro ao atualizar a galeria: ${error.message}`
      : `Não foi possível salvar o imóvel: ${error.message}`);
    if (propertySaved) await loadProperties();
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteProperty(property) {
  if (!window.confirm(`Excluir "${property.nome_empreendimento}"? Essa ação não pode ser desfeita.`)) return;
  const { error } = await supabase.from("imoveis").delete().eq("id", property.id);
  if (error) {
    notify(`Não foi possível excluir o imóvel: ${error.message}`);
    return;
  }
  const paths = [property.imagem_capa, ...(property.imagens_imoveis || []).map(image => image.url)]
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
  const { error } = await supabase.from("imoveis").update(updates).eq("id", id);
  if (error) {
    notify(`Não foi possível atualizar o imóvel: ${error.message}`);
    return;
  }
  await loadProperties();
  notify(message);
}

async function start() {
  if (!await requireAdmin()) return;
  await loadProperties();
}

document.getElementById("newProperty").addEventListener("click", () => {
  resetForm();
  dialog.showModal();
});
document.getElementById("closePropertyDialog").addEventListener("click", () => dialog.close());
document.getElementById("cancelProperty").addEventListener("click", () => dialog.close());
document.getElementById("propertySearch").addEventListener("input", renderProperties);
document.getElementById("regionFilter").addEventListener("change", renderProperties);
document.getElementById("statusFilter").addEventListener("change", renderProperties);
document.getElementById("propertyList").addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const property = properties.find(item => item.id === button.dataset.id);
  if (!property) return;
  if (button.dataset.action === "edit") await editProperty(property);
  if (button.dataset.action === "delete") await deleteProperty(property);
  if (button.dataset.action === "toggle") await updateProperty(property.id, {
    status: property.status === "publicado" ? "rascunho" : "publicado"
  }, property.status === "publicado" ? "Imóvel despublicado." : "Imóvel publicado.");
  if (button.dataset.action === "feature") await updateProperty(property.id, {
    destaque: !property.destaque
  }, property.destaque ? "Destaque removido." : "Imóvel marcado como destaque.");
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
  } catch (error) {
    event.target.value = "";
    notify(error.message);
  }
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
  if (button.dataset.galleryAction === "remove") galleryItems.splice(index, 1);
  if (button.dataset.galleryAction === "up" && index > 0) [galleryItems[index - 1], galleryItems[index]] = [galleryItems[index], galleryItems[index - 1]];
  if (button.dataset.galleryAction === "down" && index < galleryItems.length - 1) [galleryItems[index + 1], galleryItems[index]] = [galleryItems[index], galleryItems[index + 1]];
  renderGallery();
});
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
