// Solicitudes desde la página, sin cuenta de GitHub: «Solicitar una página» y
// «Reportar con detalle». El Worker valida, verifica Cloudflare Turnstile y
// abre el issue a nombre del bot (GITHUB_TOKEN), con los mismos campos que las
// plantillas de .github/ISSUE_TEMPLATE.
// - El texto libre va dentro de un bloque de código: GitHub no convierte ahí
//   @menciones, #referencias ni enlaces, así que nadie usa al bot para avisar
//   a terceros o publicar enlaces con formato.
// - No se guarda nada en D1 ni se pide correo: el seguimiento es en el issue.
// - Solo producción abre issues; en vistas previas y local se valida y se
//   responde sin publicar.
// Ver docs/decisiones.md («Solicitudes sin cuenta de GitHub»).

import {TIPOS_REPORTE, PROD_HOST} from "./reportes.js";
import {gh, REPO} from "./avisos.js";

export const LOGIN = ["No", "Sí, para la parte importante", "No sé"];
export const TIPOS_FALLA = ["No carga / se queda en blanco", "Un formulario o parte de la página no aparece",
  "Error al iniciar sesión", "Error al pagar o al descargar un documento", "Muy lenta", "Otro"];
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json; charset=utf-8"}});

// Texto de una línea o párrafo: recorta, quita caracteres de control y limita.
function texto(v, max, {lineas = false} = {}) {
  if (typeof v !== "string") return "";
  let s = v.replace(lineas ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ").trim();
  return s.length > max ? null : s;
}

function urlValida(v) {
  if (typeof v !== "string" || v.length > 500) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch { return null; }
}

// Devuelve {datos} normalizados o {error: "campo"}.
export function validar(b, sitios) {
  if (!b || typeof b !== "object") return {error: "json"};
  if (b.datos !== true) return {error: "datos"};
  if (b.tipo === "nuevo-sitio") {
    const url = urlValida(b.url);
    if (!url) return {error: "url"};
    const dependencia = texto(b.dependencia, 120);
    if (!dependencia) return {error: "dependencia"};
    const para_que = texto(b.para_que, 1000, {lineas: true});
    if (!para_que) return {error: "para_que"};
    const sana = texto(b.sana ?? "", 500, {lineas: true});
    if (sana === null) return {error: "sana"};
    if (!LOGIN.includes(b.login)) return {error: "login"};
    return {datos: {tipo: b.tipo, url, dependencia, para_que, sana, login: b.login}};
  }
  if (b.tipo === "reporte") {
    let sitio = null, url = null;
    if (b.sitio === "otra") {
      url = urlValida(b.url);
      if (!url) return {error: "url"};
    } else {
      sitio = sitios.find((s) => s.id === b.sitio);
      if (!sitio) return {error: "sitio"};
    }
    if (!Number.isInteger(b.k) || b.k < 0 || b.k >= TIPOS_REPORTE.length) return {error: "k"};
    const cuando = texto(b.cuando, 120);
    if (!cuando) return {error: "cuando"};
    const detalle = texto(b.detalle ?? "", 2000, {lineas: true});
    if (detalle === null) return {error: "detalle"};
    return {datos: {tipo: b.tipo, sitio, url, k: b.k, cuando, detalle}};
  }
  return {error: "tipo"};
}

// Bloque de código que no puede cerrarse desde dentro.
export function bloque(s) {
  if (!s) return "_(sin respuesta)_";
  const largo = Math.max(3, ...[...s.matchAll(/`+/g)].map((m) => m[0].length + 1));
  const cerca = "`".repeat(largo);
  return `${cerca}text\n${s}\n${cerca}`;
}

// Para títulos: sin @ ni # que GitHub pueda enlazar, una línea, corto.
const titulo = (s) => s.replace(/[@#]/g, "").slice(0, 80);

export function armarIssue(d) {
  const pie = "\n\n---\n_Enviado desde la página, sin cuenta de GitHub. Quien lo envió no recibe avisos: responde aquí y actualiza la página._";
  if (d.tipo === "nuevo-sitio") {
    const host = new URL(d.url).host;
    return {
      title: titulo(`Nuevo sitio: ${host}`),
      labels: ["nuevo-sitio", "via-web"],
      body: [
        "### Dirección (URL)", bloque(d.url),
        "### Dependencia u orden de gobierno", bloque(d.dependencia),
        "### ¿Para qué se usa?", bloque(d.para_que),
        "### ¿Cómo se ve cuando funciona?", bloque(d.sana),
        "### ¿Requiere iniciar sesión?", d.login,
      ].join("\n\n") + pie,
    };
  }
  const nombre = d.sitio ? d.sitio.nombre : new URL(d.url).host;
  return {
    title: titulo(`Falla: ${nombre}`),
    labels: ["reporte", "via-web", ...(d.sitio ? [`sitio:${d.sitio.id}`] : [])],
    body: [
      "### Página", d.sitio ? `${d.sitio.nombre} (\`${d.sitio.id}\`)` : bloque(d.url),
      "### ¿Qué pasó?", TIPOS_FALLA[d.k],
      "### ¿Cuándo?", bloque(d.cuando),
      "### Detalle", bloque(d.detalle),
    ].join("\n\n") + pie,
  };
}

export async function verificarTurnstile(env, token, ip, fetchFn = fetch) {
  if (!env.TURNSTILE_SECRET) return env.DEV === "1";     // en local sin secreto, pasa
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetchFn(TURNSTILE_URL, {method: "POST", body: form});
  if (!res.ok) return false;
  const r = await res.json();
  return r.success === true;
}

export async function recibirSolicitud(req, env, url, sitios, fetchFn = fetch) {
  if (req.method !== "POST") return json({error: "usa POST"}, 405);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return json({error: "origen"}, 403);
  const ip = req.headers.get("cf-connecting-ip") || "";
  if (env.LIMITE_SOLICITUD) {
    const {success} = await env.LIMITE_SOLICITUD.limit({key: ip || "?"});
    if (!success) return json({error: "demasiadas"}, 429);
  }
  const crudo = await req.text();
  if (crudo.length > 10000) return json({error: "grande"}, 413);
  let b;
  try { b = JSON.parse(crudo); } catch { return json({error: "json"}, 400); }
  // Campo trampa: invisible para personas; si viene lleno, se finge éxito.
  if (b?.web) return json({ok: true, issue: null});
  const {datos, error} = validar(b, sitios);
  if (error) return json({error}, 400);
  if (!(await verificarTurnstile(env, b.turnstile, ip, fetchFn))) return json({error: "verificacion"}, 403);

  const issue = armarIssue(datos);
  if (url.hostname !== PROD_HOST || !env.GITHUB_TOKEN) return json({ok: true, issue: null, publicado: false});
  const r = await gh(env, `/repos/${REPO}/issues`, {method: "POST", body: JSON.stringify(issue)}, fetchFn);
  return json({ok: true, issue: r.number, url: r.html_url, publicado: true});
}
