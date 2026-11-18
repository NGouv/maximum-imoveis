import { requireAdmin, showAdminError } from "../src/lib/admin.js";
import { supabase } from "../src/lib/supabase.js";

const form = document.getElementById("settingsForm");
const saveButton = document.getElementById("saveSettings");

async function loadSettings() {
  if (!await requireAdmin()) return;
  const { data, error } = await supabase.from("configuracoes").select("*").eq("id", 1).maybeSingle();
  if (error) {
    showAdminError(error);
    return;
  }
  if (!data) return;
  for (const field of ["nome", "logotipo", "telefone", "whatsapp", "email", "instagram", "endereco"]) {
    form.elements.namedItem(field).value = data[field] || "";
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  saveButton.disabled = true;
  const values = new FormData(form);
  const { error } = await supabase.from("configuracoes").upsert({
    id: 1,
    nome: values.get("nome").trim(),
    logotipo: values.get("logotipo") || null,
    telefone: values.get("telefone").trim(),
    whatsapp: values.get("whatsapp").replace(/\D/g, ""),
    email: values.get("email").trim(),
    instagram: values.get("instagram").trim(),
    endereco: values.get("endereco").trim()
  }, { onConflict: "id" });
  saveButton.disabled = false;
  if (error) {
    showAdminError(error);
    return;
  }
  const notice = document.getElementById("adminNotice");
  notice.hidden = false;
  notice.textContent = "Configurações salvas com sucesso.";
});

loadSettings().catch(error => showAdminError(error));
