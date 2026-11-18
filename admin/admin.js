import { supabase, supabaseConfigured } from "../src/lib/supabase.js";

const form = document.getElementById("loginForm");
const notice = document.getElementById("loginNotice");
const submit = document.getElementById("loginSubmit");

document.getElementById("togglePassword")?.addEventListener("click", event => {
  const password = document.getElementById("password");
  password.type = password.type === "text" ? "password" : "text";
  event.currentTarget.textContent = password.type === "text" ? "Ocultar" : "Mostrar";
});

function showNotice(message) {
  notice.hidden = false;
  notice.textContent = message;
}

if (form) {
  if (!supabaseConfigured) showNotice("Configure as variáveis do Supabase para habilitar o login.");

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!supabaseConfigured) return;
    submit.disabled = true;
    notice.hidden = true;

    const { data, error } = await supabase.auth.signInWithPassword({
      email: form.elements.email.value.trim(),
      password: form.elements.password.value
    });

    if (error) {
      showNotice(`Não foi possível entrar: ${error.message}`);
      submit.disabled = false;
      return;
    }

    if (data.user.app_metadata?.role !== "admin") {
      const { error: signOutError } = await supabase.auth.signOut();
      showNotice(signOutError
        ? `Conta sem autorização administrativa. Não foi possível encerrar a sessão: ${signOutError.message}`
        : "Esta conta não tem autorização administrativa.");
      submit.disabled = false;
      return;
    }

    location.replace("dashboard.html");
  });
}
