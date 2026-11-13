// Avisos a quien mantiene el proyecto: abre un issue cuando una revisión
// probablemente quedó obsoleta (rediseño, URL movida) o nos bloquearon.
// Requiere el secreto GITHUB_TOKEN (fine-grained, solo «Issues: write» sobre
// este repo). Sin token no hace nada: en local solo queda la transición en D1.

import {describir} from "./clasificar.js";

export const REPO = "tocaltepetl/estado-gob";

const TITULOS = {
  rediseno_probable: "Revisión obsoleta (probable rediseño)",
  revision_obsoleta: "Revisión obsoleta",
  bloqueo: "Revisión bloqueada",
};

// ¿Se abre issue para esta transición? Un bloqueo ya conocido y declarado en
// el catálogo (`bloquea: ["cf"]`) no es novedad: no abre issue.
export function debeAvisar(sitio, r, accion) {
  if (accion === "revisar") return true;
  if (accion === "bloqueo") return !(sitio?.bloquea || []).includes(r.origen);
  return false;
}

export async function abrirIssue(env, {sitio, r, previo, transicion}) {
  if (!env.GITHUB_TOKEN || !sitio) return null;
  const etiqueta = transicion.interpretacion === "bloqueo" ? "revision-bloqueada" : "scraper-roto";
  const titulo = `${TITULOS[transicion.interpretacion] || "Revisión"}: ${sitio.nombre}`;

  // No duplicar: si ya hay uno abierto para este sitio y etiqueta, no se abre otro.
  const q = encodeURIComponent(`repo:${REPO} is:issue is:open label:${etiqueta} label:sitio:${sitio.id}`);
  const busqueda = await gh(env, `/search/issues?q=${q}`);
  if (busqueda.total_count > 0) return busqueda.items[0].number;

  const cuerpo = [
    `El sitio **${sitio.nombre}** (${sitio.url}) cambió de \`${transicion.de || "—"}\` a \`${r.tipo}\`.`,
    "",
    `- Qué se vio: ${describir(r.tipo)}${r.detalle ? ` (${r.detalle})` : ""}`,
    `- HTTP: ${r.http ?? "sin respuesta"} · origen: \`${r.origen}\` · ${new Date(r.ts).toISOString()}`,
    `- Huella anterior (sana): \`${previo?.huella_ok || "—"}\` · actual: \`${r.huella || "—"}\``,
    `- Título de la página: ${r.titulo || "—"}`,
    "",
    "La página pública muestra el sitio como **en revisión**, no como caído.",
    "Revisa si cambió la página y ajusta `espera` en `config/sitios.json`, o confirma que es una falla real.",
  ].join("\n");
  const issue = await gh(env, `/repos/${REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({title: titulo, body: cuerpo, labels: [etiqueta, `sitio:${sitio.id}`]}),
  });
  return issue.number;
}

export async function gh(env, ruta, init = {}, fetchFn = fetch) {
  const res = await fetchFn("https://api.github.com" + ruta, {
    ...init,
    headers: {
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "accept": "application/vnd.github+json",
      "user-agent": "estado-gob",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}
