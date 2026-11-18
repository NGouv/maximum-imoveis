import { createClient } from "@supabase/supabase-js";

const { VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY } = import.meta.env;

export const supabaseConfigured = Boolean(
  VITE_SUPABASE_URL && VITE_SUPABASE_PUBLISHABLE_KEY
);

export const supabase = supabaseConfigured
  ? createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    })
  : null;

const storageURLPrefix = supabaseConfigured
  ? `${VITE_SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/authenticated/imoveis/`
  : "";
const storagePathPrefix = "/storage/v1/object/authenticated/imoveis/";

export function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

export function getStoragePath(value) {
  if (!value || !supabaseConfigured) return "";
  const configuredOrigin = new URL(VITE_SUPABASE_URL).origin;
  const url = new URL(value, VITE_SUPABASE_URL);
  if (url.origin !== configuredOrigin || !url.pathname.startsWith(storagePathPrefix) || url.search || url.hash) {
    throw new Error("URL de imagem inválida para o bucket de imóveis.");
  }
  return url.pathname.slice(storagePathPrefix.length).split("/").map(decodeURIComponent).join("/");
}

export function getStorageURL(path) {
  if (!path || !supabaseConfigured) throw new Error("Supabase não está configurado.");
  return `${storageURLPrefix}${path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function getImageURL(value) {
  if (!value || !supabase) return "";
  const path = getStoragePath(value);
  const { data, error } = await supabase.storage.from("imoveis").download(path);
  if (error) throw error;
  return URL.createObjectURL(data);
}
