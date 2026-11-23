import { requireAdmin, showAdminError } from "../src/lib/admin.js";
import { escapeHTML, supabase } from "../src/lib/supabase.js";

async function loadDashboard() {
  if (!await requireAdmin()) return;
  const { data: properties, error } = await supabase
    .from("imoveis")
    .select("id, titulo, nome_empreendimento, regiao, bairro, status, destaque, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    showAdminError(error);
    return;
  }

  document.getElementById("totalProperties").textContent = properties.length;
  document.getElementById("publishedProperties").textContent = properties.filter(property => property.status === "publicado").length;
  document.getElementById("draftProperties").textContent = properties.filter(property => property.status === "rascunho").length;
  document.getElementById("featuredProperties").textContent = properties.filter(property => property.destaque).length;

  const recent = properties.slice(0, 5);
  const list = document.getElementById("recentProperties");
  list.innerHTML = recent.length
    ? recent.map(property => `<article class="admin-recent-item">
        <div><h3>${escapeHTML(property.nome_empreendimento || property.titulo)}</h3><p>${escapeHTML([property.bairro, property.regiao].filter(Boolean).join(" · "))} · ${property.status === "publicado" ? "Publicado" : "Rascunho"}</p></div>
        <time datetime="${escapeHTML(property.created_at)}">${new Date(property.created_at).toLocaleDateString("pt-BR")}</time>
      </article>`).join("")
    : '<p class="admin-empty-message">Nenhum imóvel cadastrado.</p>';
}

loadDashboard().catch(error => showAdminError(error));
