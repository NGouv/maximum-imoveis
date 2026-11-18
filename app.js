import { escapeHTML, getImageURL, supabase, supabaseConfigured } from "./src/lib/supabase.js";

const catalogRows = document.getElementById("catalogRows");
const catalogMessage = document.getElementById("catalogMessage");
const propertyDetail = document.getElementById("propertyDetail");
const imageURLs = new Map();
let properties = [];
let institutionalSettings = null;
let activeGallery = [];
let lightboxIndex = 0;
let lightboxReturnFocus = null;

function favoriteKey(slug) {
  return `maximum-favorite-${slug}`;
}

function getFavorites() {
  return properties.filter(property => localStorage.getItem(favoriteKey(property.slug)) === "true").length;
}

function updateFavoriteCount() {
  const count = document.getElementById("favoritesCount");
  if (count) count.textContent = getFavorites();
}

async function imageURL(path) {
  if (!path) return "";
  if (!imageURLs.has(path)) imageURLs.set(path, await getImageURL(path));
  return imageURLs.get(path);
}

function formattedPrice(price) {
  return price === null || price === undefined
    ? "Consulte valores"
    : Number(price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formattedNumber(value) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formattedQuantity(value, singular, plural) {
  return `${formattedNumber(value)} ${Number(value) === 1 ? singular : plural}`;
}

function propertyLocation(property) {
  return `${property.bairro} · ${property.regiao}, ${property.cidade}`;
}

function propertyGallery(property) {
  return [...new Set([property.imagem_capa, ...(property.imagens_imoveis || []).map(image => image.url)].filter(Boolean))];
}

function isCoverage(property) {
  return [property.titulo, property.nome_empreendimento, property.descricao]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes("cobertura");
}

function favoriteButton(property) {
  const active = localStorage.getItem(favoriteKey(property.slug)) === "true";
  return `<button class="favorite ${active ? "active" : ""}" type="button" data-favorite="${escapeHTML(property.slug)}" aria-label="${active ? "Remover dos favoritos" : "Adicionar aos favoritos"}">${active ? "♥" : "♡"}</button>`;
}

async function cardTemplate(property) {
  const cover = property.imagem_capa || property.imagens_imoveis?.[0]?.url;
  let src = "";
  if (cover) {
    try {
      src = await imageURL(cover);
    } catch (error) {
      console.error("Erro ao carregar imagem do imóvel:", error);
    }
  }
  const image = src
    ? `<img src="${src}" alt="${escapeHTML(property.nome_empreendimento)} — ${escapeHTML(property.bairro)}" loading="lazy">`
    : '<div class="card-image-placeholder" aria-hidden="true"></div>';
  const slug = escapeHTML(property.slug);
  const label = property.destaque ? "Seleção Maximum" : property.padrao;
  return `<article class="property-card" data-slug="${escapeHTML(property.slug)}" tabindex="0" aria-label="Conhecer ${escapeHTML(property.nome_empreendimento)}">
    <div class="card-image">
      ${image}<div class="card-overlay"></div>
      <span class="tag">${escapeHTML(label)}</span>
      ${favoriteButton(property)}
      <div class="card-content">
        <p class="card-standard">${escapeHTML(property.padrao)}</p>
        <h3>${escapeHTML(property.nome_empreendimento)}</h3>
        <p class="card-location">${escapeHTML(propertyLocation(property))}</p>
        <div class="card-specs"><span>${formattedNumber(property.area_m2)} m²</span><span>${formattedQuantity(property.quartos, "quarto", "quartos")}</span><span>${formattedQuantity(property.suites, "suíte", "suítes")}</span><span>${formattedQuantity(property.vagas, "vaga", "vagas")}</span></div>
        <div class="card-price"><strong>${formattedPrice(property.preco)}</strong></div>
        <a class="card-cta" href="#/imovel/${encodeURIComponent(property.slug)}" data-open-property="${slug}">Conhecer imóvel <span aria-hidden="true">→</span></a>
      </div>
    </div>
  </article>`;
}

async function renderCatalog() {
  const regions = [...new Set(properties.map(property => property.regiao))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const rows = [
    { id: "selecao-maximum", title: "Seleção Maximum", kicker: "Imóveis em destaque", items: properties.filter(property => property.destaque) },
    { id: "destaques-zona-sul", title: "Destaques da Zona Sul", kicker: "Zona Sul", items: properties.filter(property => property.destaque && property.regiao === "Zona Sul") },
    { id: "destaques-zona-oeste", title: "Destaques da Zona Oeste", kicker: "Zona Oeste", items: properties.filter(property => property.destaque && property.regiao === "Zona Oeste") },
    { id: "alto-padrao", title: "Coberturas e alto padrão", kicker: "Alto padrão", items: properties.filter(property => property.padrao === "Alto padrão" || isCoverage(property)) },
    { id: "altissimo-padrao", title: "Altíssimo padrão", kicker: "Seleção especial", items: properties.filter(property => property.padrao === "Altíssimo padrão") },
    ...regions.map(region => ({
      id: `regiao-${region.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: `Apartamentos na ${region}`,
      kicker: "Por região",
      items: properties.filter(property => property.regiao === region)
    }))
  ].filter(row => row.items.length);

  catalogRows.innerHTML = (await Promise.all(rows.map(async row => `<section class="property-row" id="${row.id}">
    <div class="row-heading"><div><p>${escapeHTML(row.kicker)}</p><h2>${escapeHTML(row.title)}</h2></div><div class="row-controls"><button type="button" data-scroll="-1" data-row="${row.id}" aria-label="Imóveis anteriores">‹</button><button type="button" data-scroll="1" data-row="${row.id}" aria-label="Próximos imóveis">›</button></div></div>
    <div class="carousel" id="carousel-${row.id}">${(await Promise.all(row.items.map(cardTemplate))).join("")}</div>
  </section>`))).join("");
  catalogMessage.hidden = true;
  updateFavoriteCount();
  observeReveal();
}

function whatsappNumber() {
  return (institutionalSettings?.whatsapp || "").replace(/\D/g, "");
}

function contactHref(message = "Olá! Gostaria de conversar sobre os apartamentos disponíveis.") {
  const whatsapp = whatsappNumber();
  if (whatsapp) return `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`;
  const phone = (institutionalSettings?.telefone || "").replace(/[^\d+]/g, "");
  if (phone) return `tel:${phone.startsWith("+") ? phone : `+${phone}`}`;
  if (institutionalSettings?.email) return `mailto:${institutionalSettings.email}`;
  return "#contato";
}

function applySettings(settings) {
  institutionalSettings = settings || null;
  const phone = institutionalSettings?.telefone || "";
  const whatsapp = whatsappNumber();
  const instagram = institutionalSettings?.instagram || "";
  const email = institutionalSettings?.email || "";
  const name = institutionalSettings?.nome || "Maximum Imóveis";
  if (institutionalSettings?.logotipo) {
    document.querySelectorAll("[data-company-logo]").forEach(image => {
      image.src = institutionalSettings.logotipo;
      image.alt = name;
    });
  }
  document.querySelectorAll("[data-company-name]").forEach(node => { node.textContent = name; });
  document.querySelectorAll("[data-contact-address]").forEach(node => { node.textContent = institutionalSettings?.endereco || ""; });
  document.title = `${name} | Seleção Exclusiva`;
  document.querySelectorAll("[data-contact-phone]").forEach(node => { node.textContent = phone; });
  document.querySelectorAll("[data-contact-whatsapp]").forEach(link => {
    link.hidden = !whatsapp;
    link.href = whatsapp ? `https://wa.me/${whatsapp}` : "#contato";
  });
  document.querySelectorAll(".whatsapp-float").forEach(link => {
    link.hidden = !whatsapp;
    link.href = whatsapp ? `https://wa.me/${whatsapp}` : "#contato";
  });
  document.querySelectorAll(".specialist-button, .mobile-whatsapp, .contact-inner .button").forEach(link => {
    link.href = contactHref();
    link.target = whatsapp ? "_blank" : "";
    if (link.classList.contains("mobile-whatsapp")) {
      link.textContent = whatsapp ? "Fale pelo WhatsApp" : "Fale com a Maximum";
    }
  });
  document.querySelectorAll("[data-contact-email]").forEach(link => {
    link.hidden = !email;
    link.href = email ? `mailto:${email}` : "#contato";
  });
  document.querySelectorAll("[data-contact-email-text]").forEach(node => { node.textContent = email; });
  if (instagram) {
    document.querySelectorAll("[data-contact-instagram]").forEach(link => { link.href = instagram.startsWith("http") ? instagram : `https://instagram.com/${instagram.replace(/^@/, "")}`; });
    document.querySelectorAll("[data-contact-instagram-text]").forEach(node => { node.textContent = instagram.startsWith("@") ? instagram : `@${instagram}`; });
  } else {
    document.querySelectorAll("[data-contact-instagram]").forEach(link => { link.hidden = true; });
  }
}

async function loadCatalog() {
  if (!supabaseConfigured) {
    catalogMessage.textContent = "O catálogo está indisponível: configure as variáveis do Supabase para carregar os imóveis publicados.";
    return;
  }
  const [{ data, error }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from("imoveis").select("*, imagens_imoveis(id, url, ordem)").eq("status", "publicado").order("created_at", { ascending: false }),
    supabase.from("configuracoes").select("*").eq("id", 1).maybeSingle()
  ]);
  if (error) {
    catalogMessage.textContent = `Não foi possível carregar o catálogo: ${error.message}`;
    return;
  }
  if (settingsError) console.error("Erro ao carregar as configurações institucionais:", settingsError);
  applySettings(settings);
  properties = (data || []).map(property => ({
    ...property,
    imagens_imoveis: (property.imagens_imoveis || []).sort((a, b) => a.ordem - b.ordem)
  }));
  if (!properties.length) {
    catalogMessage.textContent = "Novos apartamentos selecionados serão apresentados em breve.";
    return;
  }
  try {
    await renderCatalog();
  } catch (renderError) {
    console.error("Erro ao carregar imagens do catálogo:", renderError);
    catalogMessage.hidden = false;
    catalogMessage.textContent = "Não foi possível carregar as imagens dos imóveis. Verifique as permissões do bucket no Supabase.";
  }
}

function detailSpec(icon, value, label) {
  const icons = {
    area: '<path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M8 12h8"/>',
    rooms: '<path d="M3 19v-8h18v8M3 15h18M6 11V7a2 2 0 0 1 2-2h3v6M13 11V8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/>',
    suites: '<path d="M4 12h16v7H4zM6 12V8a2 2 0 0 1 2-2h3v6M13 12V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"/>',
    baths: '<path d="M4 12h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM6 12V6a2 2 0 0 1 4 0M8 20v2M16 20v2"/>',
    parking: '<path d="M5 19V5h7a5 5 0 0 1 0 10H5M5 10h7a1 1 0 0 1 0 2H5"/>'
  };
  return `<div class="detail-spec"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg><strong>${escapeHTML(value)}</strong><span>${escapeHTML(label)}</span></div>`;
}

function videoMarkup(value) {
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
  } catch {
    return "";
  }

  let embedURL = "";
  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    const id = url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/)?.[1];
    if (id && /^[\w-]{11}$/.test(id)) embedURL = `https://www.youtube-nocookie.com/embed/${id}`;
  } else if (url.hostname === "youtu.be") {
    const id = url.pathname.slice(1);
    if (/^[\w-]{11}$/.test(id)) embedURL = `https://www.youtube-nocookie.com/embed/${id}`;
  } else if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname)) {
    const id = url.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
    if (id) embedURL = `https://player.vimeo.com/video/${id}`;
  } else if (["instagram.com", "www.instagram.com"].includes(url.hostname)) {
    const match = url.pathname.match(/^\/(reel|p|tv)\/([\w-]+)/);
    if (match) embedURL = `https://www.instagram.com/${match[1]}/${match[2]}/embed`;
  }

  if (embedURL) {
    return `<div class="video-frame"><iframe src="${escapeHTML(embedURL)}" title="Vídeo do empreendimento" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if (/\.(mp4|webm|ogg)(?:$|[?#])/i.test(url.href)) {
    return `<video class="property-video" controls preload="metadata"><source src="${escapeHTML(url.href)}"></video>`;
  }
  return `<a class="detail-resource" href="${escapeHTML(url.href)}" target="_blank" rel="noopener">Assistir ao vídeo do empreendimento ↗</a>`;
}

async function similarPropertyCards(property) {
  const similar = properties
    .filter(candidate => candidate.id !== property.id)
    .map(candidate => ({
      candidate,
      score: (candidate.regiao === property.regiao ? 2 : 0) + (candidate.padrao === property.padrao ? 1 : 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(item => item.candidate);
  if (!similar.length) return "";
  return `<section class="similar-properties" aria-labelledby="similarTitle"><div class="detail-section-heading"><p class="eyebrow">Continue explorando</p><h2 id="similarTitle">Imóveis semelhantes que você pode gostar</h2></div><div class="similar-carousel">${(await Promise.all(similar.map(cardTemplate))).join("")}</div></section>`;
}

async function showLightboxPhoto(index) {
  if (!activeGallery.length) return;
  lightboxIndex = (index + activeGallery.length) % activeGallery.length;
  const lightbox = propertyDetail.querySelector("[data-lightbox]");
  const image = lightbox?.querySelector("[data-lightbox-image]");
  const counter = lightbox?.querySelector("[data-lightbox-counter]");
  if (!lightbox || !image || !counter) return;
  counter.textContent = `${lightboxIndex + 1} / ${activeGallery.length}`;
  try {
    image.src = await imageURL(activeGallery[lightboxIndex]);
    image.alt = `Imagem ${lightboxIndex + 1} de ${activeGallery.length} do empreendimento`;
  } catch (error) {
    console.error("Erro ao carregar imagem da galeria:", error);
    image.removeAttribute("src");
    image.alt = "Não foi possível carregar esta imagem.";
  }
}

async function openProperty(slug, updateHistory = true) {
  const property = properties.find(item => item.slug === slug);
  if (!property) return;
  const gallery = propertyGallery(property);
  activeGallery = gallery;
  const photos = await Promise.all(gallery.slice(0, 5).map(async (path, index) => {
    try {
      return { index, src: await imageURL(path) };
    } catch (error) {
      console.error("Erro ao carregar imagem da galeria:", error);
      return null;
    }
  }));
  const visiblePhotos = photos.filter(Boolean);
  const message = `Olá! Gostaria de agendar uma visita ao empreendimento ${property.nome_empreendimento}.`;
  const description = property.descricao?.trim();
  const companyLogo = institutionalSettings?.logotipo || "assets/logo trans.png";
  const companyName = institutionalSettings?.nome || "Maximum Imóveis";
  const deliveryDate = property.data_entrega
    ? new Date(`${property.data_entrega}T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    : "";
  const galleryMarkup = visiblePhotos.length
    ? `<section class="detail-gallery-section" aria-label="Galeria do empreendimento">
        <div class="gallery-mosaic gallery-count-${visiblePhotos.length}">${visiblePhotos.map((photo, position) => `<button class="gallery-photo ${position === 0 ? "gallery-photo-main" : ""}" type="button" data-lightbox-index="${photo.index}" aria-label="Abrir foto ${photo.index + 1} de ${gallery.length}"><img src="${photo.src}" alt="${escapeHTML(property.nome_empreendimento)} — foto ${photo.index + 1}" ${position > 1 ? 'loading="lazy"' : ""}></button>`).join("")}</div>
        <button class="all-photos-button" type="button" data-open-lightbox>Ver todas as fotos <span>${gallery.length}</span></button>
      </section>`
    : "";
  const differentiators = [
    property.construtora && `<div><span>Construtora</span><strong>${escapeHTML(property.construtora)}</strong></div>`,
    property.categoria && `<div><span>Categoria</span><strong>${escapeHTML(property.categoria)}</strong></div>`,
    property.endereco && `<div><span>Endereço</span><strong>${escapeHTML(property.endereco)}</strong></div>`,
    deliveryDate && `<div><span>Previsão de entrega cadastrada</span><strong>${escapeHTML(deliveryDate)}</strong></div>`
  ].filter(Boolean);
  const video = videoMarkup(property.video_url);
  const plan = property.planta_url
    ? `<a class="detail-resource" href="${escapeHTML(property.planta_url)}" target="_blank" rel="noopener">Consultar planta ↗</a>`
    : "";
  const similar = await similarPropertyCards(property);
  const whatsappAvailable = Boolean(whatsappNumber());
  const visitLink = contactHref(message);
  const favorite = favoriteButton(property).replace('class="favorite ', 'class="favorite detail-favorite ');

  propertyDetail.innerHTML = `<div class="detail-head"><a href="#inicio" aria-label="${escapeHTML(companyName)}"><img src="${escapeHTML(companyLogo)}" alt="${escapeHTML(companyName)}" data-company-logo></a><button class="detail-close" type="button" aria-label="Fechar detalhes">×</button></div>
    <div class="detail-page">
      <header class="property-intro">
        <p class="detail-breadcrumb">Maximum Imóveis <span>/</span> ${escapeHTML(property.regiao)} <span>/</span> ${escapeHTML(property.bairro)}</p>
        <div class="property-intro-main">
          <div><span class="property-standard">${escapeHTML(property.padrao)}</span><h1>${escapeHTML(property.nome_empreendimento)}</h1><p class="property-title">${escapeHTML(property.titulo)}</p><p class="property-location">${escapeHTML(propertyLocation(property))}</p></div>
          <div class="detail-actions">${favorite}<button class="share-button" type="button" data-share-property>Compartilhar</button></div>
        </div>
      </header>
      ${galleryMarkup}
      <div class="detail-content-grid">
        <main class="detail-content">
          ${description ? `<section class="detail-section"><p class="eyebrow">O projeto</p><h2>Sobre o empreendimento</h2><p class="detail-description">${escapeHTML(description)}</p></section>` : ""}
          <section class="detail-section">
            <p class="eyebrow">Informações do imóvel</p><h2>Especificações</h2>
            <div class="detail-specs">${detailSpec("area", `${formattedNumber(property.area_m2)} m²`, "Área privativa")}${detailSpec("rooms", formattedNumber(property.quartos), Number(property.quartos) === 1 ? "Quarto" : "Quartos")}${detailSpec("suites", formattedNumber(property.suites), "Suítes")}${detailSpec("baths", formattedNumber(property.banheiros), "Banheiros")}${detailSpec("parking", formattedNumber(property.vagas), "Vagas")}</div>
          </section>
          ${differentiators.length ? `<section class="detail-section"><p class="eyebrow">Dados cadastrados</p><h2>Diferenciais da unidade</h2><div class="differentiator-grid">${differentiators.join("")}</div></section>` : ""}
          ${video || plan ? `<section class="detail-section"><p class="eyebrow">Materiais do empreendimento</p><h2>Vídeo e planta</h2>${video}${plan}</section>` : ""}
        </main>
        <aside class="detail-aside">
          <p class="eyebrow">Atendimento Maximum</p><h2>${formattedPrice(property.preco)}</h2>
          <p class="aside-location">${escapeHTML(property.bairro)} · ${escapeHTML(property.regiao)}</p>
          <div class="aside-specs"><span>${formattedNumber(property.area_m2)} m²</span><span>${formattedQuantity(property.quartos, "quarto", "quartos")}</span><span>${formattedQuantity(property.suites, "suíte", "suítes")}</span></div>
          <a class="button button-gold" href="${escapeHTML(visitLink)}" ${whatsappAvailable ? 'target="_blank" rel="noopener"' : ""}>Agendar visita</a>
          ${institutionalSettings?.telefone ? `<a class="aside-phone" href="tel:${escapeHTML(institutionalSettings.telefone.replace(/[^\d+]/g, ""))}">${escapeHTML(institutionalSettings.telefone)}</a>` : ""}
          <p class="simulation-note">Valores e disponibilidade devem ser confirmados com a Maximum Imóveis.</p>
        </aside>
      </div>
      ${similar}
    </div>
    <div class="lightbox" data-lightbox aria-hidden="true" role="dialog" aria-modal="true" aria-label="Galeria de fotos">
      <button class="lightbox-close" type="button" data-lightbox-close aria-label="Fechar galeria">×</button>
      <button class="lightbox-nav lightbox-prev" type="button" data-lightbox-prev aria-label="Foto anterior">‹</button>
      <figure><img data-lightbox-image alt=""><figcaption data-lightbox-counter></figcaption></figure>
      <button class="lightbox-nav lightbox-next" type="button" data-lightbox-next aria-label="Próxima foto">›</button>
    </div>
    <p class="share-feedback" data-share-feedback aria-live="polite"></p>`;
  propertyDetail.dataset.slug = property.slug;
  propertyDetail.classList.add("open");
  propertyDetail.setAttribute("aria-hidden", "false");
  propertyDetail.scrollTop = 0;
  document.body.style.overflow = "hidden";
  if (updateHistory) history.pushState({}, "", `#/imovel/${encodeURIComponent(property.slug)}`);
  propertyDetail.querySelector(".detail-close").addEventListener("click", closeProperty);
}

function closeProperty() {
  closeLightbox();
  propertyDetail.classList.remove("open");
  propertyDetail.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  history.pushState({}, "", "#imoveis");
}

async function openLightbox(index = 0) {
  if (!activeGallery.length) return;
  const lightbox = propertyDetail.querySelector("[data-lightbox]");
  if (!lightbox) return;
  lightboxReturnFocus = document.activeElement;
  lightbox.classList.add("open");
  lightbox.setAttribute("aria-hidden", "false");
  await showLightboxPhoto(index);
  lightbox.querySelector("[data-lightbox-close]")?.focus();
}

function closeLightbox() {
  const lightbox = propertyDetail.querySelector("[data-lightbox]");
  if (!lightbox?.classList.contains("open")) return;
  lightbox.classList.remove("open");
  lightbox.setAttribute("aria-hidden", "true");
  if (lightboxReturnFocus?.isConnected) lightboxReturnFocus.focus();
  lightboxReturnFocus = null;
}

document.addEventListener("click", event => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    event.stopPropagation();
    const key = favoriteKey(favorite.dataset.favorite);
    const active = localStorage.getItem(key) !== "true";
    localStorage.setItem(key, String(active));
    document.querySelectorAll("[data-favorite]").forEach(button => {
      if (button.dataset.favorite !== favorite.dataset.favorite) return;
      button.classList.toggle("active", active);
      button.textContent = active ? "♥" : "♡";
      button.setAttribute("aria-label", active ? "Remover dos favoritos" : "Adicionar aos favoritos");
    });
    updateFavoriteCount();
    return;
  }
  const propertyLink = event.target.closest("[data-open-property]");
  if (propertyLink) {
    event.preventDefault();
    openProperty(propertyLink.dataset.openProperty);
    return;
  }
  const photo = event.target.closest("[data-lightbox-index]");
  if (photo) {
    openLightbox(Number(photo.dataset.lightboxIndex));
    return;
  }
  if (event.target.closest("[data-open-lightbox]")) {
    openLightbox();
    return;
  }
  if (event.target.closest("[data-lightbox-close]")) {
    closeLightbox();
    return;
  }
  if (event.target.closest("[data-lightbox-prev]")) {
    showLightboxPhoto(lightboxIndex - 1);
    return;
  }
  if (event.target.closest("[data-lightbox-next]")) {
    showLightboxPhoto(lightboxIndex + 1);
    return;
  }
  const lightbox = event.target.closest("[data-lightbox]");
  if (lightbox && event.target === lightbox) {
    closeLightbox();
    return;
  }
  if (event.target.closest("[data-share-property]")) {
    const feedback = propertyDetail.querySelector("[data-share-feedback]");
    const property = properties.find(item => item.slug === propertyDetail.dataset.slug);
    const url = location.href;
    if (navigator.share && property) {
      navigator.share({ title: property.nome_empreendimento, text: property.titulo, url })
        .catch(error => {
          if (error.name !== "AbortError" && feedback) feedback.textContent = "Não foi possível compartilhar este imóvel.";
        });
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        if (feedback) feedback.textContent = "Link do imóvel copiado.";
      }).catch(() => {
        if (feedback) feedback.textContent = "Não foi possível copiar o link neste navegador.";
      });
    } else if (feedback) {
      feedback.textContent = "O compartilhamento não está disponível neste navegador.";
    }
    return;
  }
  const card = event.target.closest(".property-card");
  if (card) openProperty(card.dataset.slug);
  const scrollButton = event.target.closest("[data-scroll]");
  if (scrollButton) {
    const carousel = document.getElementById(`carousel-${scrollButton.dataset.row}`);
    carousel?.scrollBy({ left: Number(scrollButton.dataset.scroll) * carousel.clientWidth * .75, behavior: "smooth" });
  }
});

document.addEventListener("keydown", event => {
  const card = event.target.closest(".property-card");
  if (card && (event.key === "Enter" || event.key === " ")) openProperty(card.dataset.slug);
  const lightbox = propertyDetail.querySelector("[data-lightbox]");
  if (event.key === "Escape" && lightbox?.classList.contains("open")) closeLightbox();
  else if (event.key === "Escape" && propertyDetail.classList.contains("open")) closeProperty();
  if (lightbox?.classList.contains("open") && event.key === "ArrowLeft") showLightboxPhoto(lightboxIndex - 1);
  if (lightbox?.classList.contains("open") && event.key === "ArrowRight") showLightboxPhoto(lightboxIndex + 1);
});

const header = document.getElementById("header");
addEventListener("scroll", () => header?.classList.toggle("scrolled", scrollY > 30), { passive: true });
const menuButton = document.getElementById("menuButton");
const mobileMenu = document.getElementById("mobileMenu");
const menuScrim = document.getElementById("menuScrim");
function toggleMenu(open) {
  mobileMenu?.classList.toggle("open", open);
  menuScrim?.classList.toggle("open", open);
  mobileMenu?.setAttribute("aria-hidden", String(!open));
  menuButton?.setAttribute("aria-expanded", String(open));
  document.body.style.overflow = open ? "hidden" : "";
}
menuButton?.addEventListener("click", () => toggleMenu(true));
document.getElementById("closeMenu")?.addEventListener("click", () => toggleMenu(false));
menuScrim?.addEventListener("click", () => toggleMenu(false));
document.querySelectorAll(".mobile-menu a").forEach(link => link.addEventListener("click", () => toggleMenu(false)));

function observeReveal() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".reveal").forEach(element => element.classList.add("visible"));
    return;
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  }), { threshold: .12 });
  document.querySelectorAll(".reveal").forEach(element => observer.observe(element));
}

async function routeDetail() {
  const match = location.hash.match(/#\/imovel\/([^/]+)/);
  if (match) await openProperty(decodeURIComponent(match[1]), false);
  else if (propertyDetail.classList.contains("open")) closeProperty();
}

addEventListener("hashchange", routeDetail);
observeReveal();
loadCatalog().then(routeDetail).catch(error => {
  console.error("Erro ao inicializar o catálogo:", error);
  catalogMessage.hidden = false;
  catalogMessage.textContent = "Ocorreu um erro ao conectar ao catálogo de imóveis.";
});
