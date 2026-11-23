import { createClient } from "@supabase/supabase-js";

const {
  VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_SUPABASE_ANON_KEY
} = import.meta.env;
const supabaseKey = VITE_SUPABASE_PUBLISHABLE_KEY || VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(
  VITE_SUPABASE_URL && supabaseKey
);

export const supabase = supabaseConfigured
  ? createClient(VITE_SUPABASE_URL, supabaseKey, {
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
const signedImageURLs = new Map();

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

export async function getImageURL(value, transform = null) {
  if (!value || !supabase) return "";
  const path = getStoragePath(value);
  const cacheKey = `${path}:${transform ? JSON.stringify(transform) : "original"}`;
  const cached = signedImageURLs.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise || cached.url;

  const expiresIn = 60 * 60;
  const request = (async () => {
    const bucket = supabase.storage.from("imoveis");
    let result = await bucket.createSignedUrl(path, expiresIn, transform ? { transform } : undefined);
    if (result.error && transform) {
      console.warn("A transformação de imagem do Storage falhou; usando a imagem original:", result.error);
      result = await bucket.createSignedUrl(path, expiresIn);
    }
    if (result.error) throw result.error;
    return result.data.signedUrl;
  })();
  const cacheEntry = { promise: request, expiresAt: Number.POSITIVE_INFINITY };
  signedImageURLs.set(cacheKey, cacheEntry);
  try {
    const url = await request;
    cacheEntry.url = url;
    cacheEntry.promise = null;
    cacheEntry.expiresAt = Date.now() + (expiresIn - 60) * 1000;
    return url;
  } catch (error) {
    signedImageURLs.delete(cacheKey);
    throw error;
  }
}
