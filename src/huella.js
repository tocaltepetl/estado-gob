// Huella estructural de una página sana: sirve para distinguir «el sitio se
// cayó» de «el sitio cambió y nuestra revisión quedó obsoleta».
// Ignora texto y contenido de scripts (cambian con cada noticia); conserva la
// forma: etiquetas con id, scripts externos y destinos de formularios.

export function rasgos(html) {
  const sinRuido = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/gi, "<$1$2></$1>");
  const ids = [...sinRuido.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\sid=["']([^"']+)["']/gi)]
    .map((m) => `${m[1].toLowerCase()}#${m[2].replace(/\d{3,}/g, "N")}`);  // ids con números largos suelen ser generados
  const scripts = [...sinRuido.matchAll(/<script\b[^>]*\ssrc=["']([^"']+)["']/gi)]
    .map((m) => m[1].replace(/[?#].*$/, ""));     // sin ?v=123
  const forms = [...sinRuido.matchAll(/<form\b[^>]*\saction=["']([^"']*)["']/gi)]
    .map((m) => m[1].replace(/[?#].*$/, ""));
  const iframes = [...sinRuido.matchAll(/<iframe\b[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  return {ids, scripts, forms, iframes};
}

export async function huella(html) {
  const r = rasgos(html);
  const texto = JSON.stringify([r.ids, r.scripts, r.forms, r.iframes]);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
