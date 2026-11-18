import { escapeHTML, getImageURL, supabase, supabaseConfigured } from "./src/lib/supabase.js";

const catalogRows = document.getElementById("catalogRows");
const catalogMessage = document.getElementById("catalogMessage");
const propertyDetail = document.getElementById("propertyDetail");
const imageURLs = new Map();
let properties = [];
let institutionalSettings = null;

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

function propertyLocation(property) {
  return `${property.bairro} · ${property.regiao}, ${property.cidade}`;
}

function favoriteButton(property) {
  const active = localStorage.getItem(favoriteKey(property.slug)) === "true";
  return `<button class="favorite ${active ? "active" : ""}" type="button" data-favorite="${escapeHTML(property.slug)}" aria-label="${active ? "Remover dos favoritos" : "Adicionar aos favoritos"}">${active ? "♥" : "♡"}</button>`;
}

async function cardTemplate(property) {
  const cover = property.imagem_capa || property.imagens_imoveis?.[0]?.url;
  const src = cover ? await imageURL(cover) : "";
  const image = src
    ? `<img src="${src}" alt="${escapeHTML(property.nome_empreendimento)} — ${escapeHTML(property.bairro)}" loading="lazy">`
    : "";
  return `<article class="property-card" data-slug="${escapeHTML(property.slug)}" tabindex="0" aria-label="Conhecer ${escapeHTML(property.nome_empreendimento)}">
    <div class="card-image">
      ${image}<div class="card-overlay"></div>
      <span class="tag">${escapeHTML(property.padrao)}</span>
      ${favoriteButton(property)}
      <div class="card-content">
        <h3>${escapeHTML(property.nome_empreendimento)}</h3>
        <p class="card-location">${escapeHTML(propertyLocation(property))}</p>
        <div class="card-specs"><span>${escapeHTML(property.area_m2)} m²</span><span>${escapeHTML(property.quartos)} dorm.</span><span>${escapeHTML(property.suites)} suítes</span><span>${escapeHTML(property.vagas)} vagas</span></div>
        <div class="card-price"><strong>${formattedPrice(property.preco)}</strong><span>Conhecer imóvel →</span></div>
      </div>
    </div>
  </article>`;
}

async function renderCatalog() {
  const regions = [...new Set(properties.map(property => property.regiao))];
  const rows = [
    { id: "destaques", title: "Destaques da Maximum", kicker: "Seleção Maximum", items: properties.filter(property => property.destaque) },
    ...regions.map((region, index) => ({
      id: `regiao-${index}`,
      title: `Apartamentos na ${region}`,
      kicker: region,
      items: properties.filter(property => property.regiao === region)
    }))
  ].filter(row => row.items.length);

  catalogRows.innerHTML = (await Promise.all(rows.map(async row => `<section class="property-row" id="${row.id}">
    <div class="row-heading"><div><p>${escapeHTML(row.kicker)}</p><h2>${escapeHTML(row.title)}</h2></div><div class="row-controls"><button type="button" data-scroll="-1" data-row="${row.id}" aria-label="Anterior">‹</button><button type="button" data-scroll="1" data-row="${row.id}" aria-label="Próximo">›</button></div></div>
    <div class="carousel" id="carousel-${row.id}">${(await Promise.all(row.items.map(cardTemplate))).join("")}</div>
  </section>`))).join("");
  catalogMessage.hidden = true;
  updateFavoriteCount();
  observeReveal();
}

function applySettings(settings) {
  if (!settings) return;
  institutionalSettings = settings;
  const phone = settings.telefone || "";
  const whatsapp = (settings.whatsapp || "").replace(/\D/g, "");
  const instagram = settings.instagram || "";
  const email = settings.email || "";
  const name = settings.nome || "Maximum Imóveis";
  if (settings.logotipo) {
    document.querySelectorAll("[data-company-logo]").forEach(image => {
      image.src = settings.logotipo;
      image.alt = name;
    });
  }
  document.querySelectorAll("[data-company-name]").forEach(node => { node.textContent = name; });
  document.querySelectorAll("[data-contact-address]").forEach(node => { node.textContent = settings.endereco || ""; });
  document.title = `${name} | Seleção Exclusiva`;
  if (whatsapp) {
    document.querySelectorAll("[data-contact-whatsapp], .specialist-button, .mobile-whatsapp, .contact-inner .button, .whatsapp-float").forEach(link => {
      link.href = `https://wa.me/${whatsapp}`;
    });
  }
  document.querySelectorAll("[data-contact-phone]").forEach(node => { node.textContent = phone; });
  document.querySelectorAll("[data-contact-email]").forEach(link => { link.href = `mailto:${email}`; });
  document.querySelectorAll("[data-contact-email-text]").forEach(node => { node.textContent = email; });
  if (instagram) {
    document.querySelectorAll("[data-contact-instagram]").forEach(link => { link.href = instagram.startsWith("http") ? instagram : `https://instagram.com/${instagram.replace(/^@/, "")}`; });
    document.querySelectorAll("[data-contact-instagram-text]").forEach(node => { node.textContent = instagram.startsWith("@") ? instagram : `@${instagram}`; });
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

async function openProperty(slug, updateHistory = true) {
  const property = properties.find(item => item.slug === slug);
  if (!property) return;
  const gallery = [property.imagem_capa, ...(property.imagens_imoveis || []).map(image => image.url)]
    .filter((path, index, paths) => path && paths.indexOf(path) === index);
  let coverURL = "";
  try {
    coverURL = await imageURL(gallery[0]);
  } catch (error) {
    console.error("Erro ao carregar a imagem de capa:", error);
  }
  const message = encodeURIComponent(`Olá! Gostaria de receber mais informações sobre o empreendimento ${property.nome_empreendimento} que encontrei no site da Maximum Imóveis.`);
  const whatsapp = document.querySelector("[data-contact-whatsapp]")?.href.match(/wa\.me\/(\d+)/)?.[1] || "5511995493953";
  const galleryMarkup = await Promise.all(gallery.slice(1).map(async (path, index) => {
    try {
      return `<img src="${await imageURL(path)}" alt="${escapeHTML(property.nome_empreendimento)} — imagem ${index + 2}" loading="lazy">`;
    } catch (error) {
      console.error("Erro ao carregar imagem da galeria:", error);
      return "";
    }
  }));
  const video = property.video_url ? `<p><a href="${escapeHTML(property.video_url)}" target="_blank" rel="noopener">Assistir ao vídeo do empreendimento</a></p>` : "";
  const plan = property.planta_url ? `<p><a href="${escapeHTML(property.planta_url)}" target="_blank" rel="noopener">Consultar planta</a></p>` : "";
  propertyDetail.innerHTML = `<div class="detail-head"><a href="#inicio" aria-label="Maximum Imóveis"><img src="${escapeHTML(institutionalSettings?.logotipo || "assets/logo trans.png")}" alt="${escapeHTML(institutionalSettings?.nome || "Maximum Imóveis")}" data-company-logo></a><button class="detail-close" type="button" aria-label="Fechar detalhes">×</button></div>
    <div class="detail-hero">${coverURL ? `<img src="${coverURL}" alt="${escapeHTML(property.nome_empreendimento)}">` : ""}<div class="detail-title"><p>${escapeHTML(propertyLocation(property))}</p><h1>${escapeHTML(property.nome_empreendimento)}</h1></div></div>
    ${galleryMarkup.some(Boolean) ? `<div class="detail-gallery">${galleryMarkup.join("")}</div>` : ""}
    <div class="detail-body"><div><h2>${escapeHTML(property.nome_empreendimento)}</h2><p class="detail-description">${escapeHTML(property.descricao)}</p><div class="detail-specs"><div><strong>${escapeHTML(property.area_m2)} m²</strong><span>Área privativa</span></div><div><strong>${escapeHTML(property.quartos)}</strong><span>Quartos</span></div><div><strong>${escapeHTML(property.suites)}</strong><span>Suítes</span></div><div><strong>${escapeHTML(property.vagas)}</strong><span>Vagas</span></div></div><p class="detail-description">Construtora: ${escapeHTML(property.construtora)} · ${escapeHTML(property.banheiros)} banheiros</p>${video}${plan}</div><aside class="detail-aside"><p class="eyebrow">Consulte disponibilidade</p><h3>${formattedPrice(property.preco)}</h3><p>${escapeHTML(property.area_m2)} m² · ${escapeHTML(property.quartos)} quartos · ${escapeHTML(property.suites)} suítes</p><a class="button button-gold" href="https://wa.me/${whatsapp}?text=${message}" target="_blank" rel="noopener">Tenho interesse neste imóvel</a></aside></div>`;
  propertyDetail.classList.add("open");
  propertyDetail.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  if (updateHistory) history.pushState({}, "", `#/imovel/${encodeURIComponent(property.slug)}`);
  propertyDetail.querySelector(".detail-close").addEventListener("click", closeProperty);
}

function closeProperty() {
  propertyDetail.classList.remove("open");
  propertyDetail.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  history.pushState({}, "", "#imoveis");
}

document.addEventListener("click", event => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    event.stopPropagation();
    const key = favoriteKey(favorite.dataset.favorite);
    const active = localStorage.getItem(key) !== "true";
    localStorage.setItem(key, String(active));
    favorite.classList.toggle("active", active);
    favorite.textContent = active ? "♥" : "♡";
    favorite.setAttribute("aria-label", active ? "Remover dos favoritos" : "Adicionar aos favoritos");
    updateFavoriteCount();
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
  if (event.key === "Escape" && propertyDetail.classList.contains("open")) closeProperty();
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
