import { supabase, supabaseConfigured } from "./supabase.js";

export async function requireAdmin() {
  const notice = document.getElementById("adminNotice");
  if (!supabaseConfigured) {
    if (notice) {
      notice.hidden = false;
      notice.textContent = "Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para conectar o painel.";
    }
    return false;
  }

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session) {
    location.replace("login.html");
    return false;
  }

  if (session.user.app_metadata?.role !== "admin") {
    if (notice) {
      notice.hidden = false;
      notice.textContent = "Esta conta não tem autorização administrativa.";
    }
    await supabase.auth.signOut();
    return false;
  }

  document.querySelectorAll(".admin-logout").forEach(link => {
    link.addEventListener("click", async event => {
      event.preventDefault();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        if (notice) {
          notice.hidden = false;
          notice.textContent = `Não foi possível encerrar a sessão: ${signOutError.message}`;
        }
        return;
      }
      location.replace("login.html");
    });
  });
  return true;
}

export function showAdminError(error, elementId = "adminNotice") {
  const element = document.getElementById(elementId);
  if (element) {
    element.hidden = false;
    element.textContent = error?.message || "Ocorreu um erro ao acessar o Supabase.";
  }
}
