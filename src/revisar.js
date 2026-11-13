// Una revisión HTTP de un sitio. Usa `fetch`, disponible igual en Workers y
// en Node 22, para que el cron y el revisor local midan lo mismo.

import {clasificarErrorRed, clasificarRecurso, clasificarRespuesta} from "./clasificar.js";
import {huella} from "./huella.js";

export const UA = "estado-gob/0.1 (+https://github.com/tocaltepetl/estado-gob; monitor ciudadano, 1 revision cada 5 min)";
const TIMEOUT_MS = 20000;
const MAX_BYTES = 2_000_000;

export async function revisar(sitio, firmas, {origen}) {
  const t0 = Date.now();
  const base = {sitio: sitio.id, ts: t0, origen};
  let res;
  try {
    res = await fetch(sitio.url, {
      headers: {"user-agent": UA, "accept": "text/html,*/*;q=0.8", "accept-language": "es-MX,es;q=0.9"},
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {...base, ms: Date.now() - t0, http: null, huella: null, titulo: null, ...clasificarErrorRed(err)};
  }
  let cuerpo = "";
  try {
    cuerpo = (await res.text()).slice(0, MAX_BYTES);
  } catch (err) {   // la conexión se cortó a media respuesta
    return {...base, ms: Date.now() - t0, http: res.status, huella: null, titulo: null, ...clasificarErrorRed(err)};
  }
  const ms = Date.now() - t0;
  const encabezados = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
  const c = clasificarRespuesta({status: res.status, encabezados, cuerpo}, sitio, firmas);
  // La huella solo describe páginas que respondieron 2xx: es la referencia de «sana».
  const h = res.ok ? await huella(cuerpo) : null;
  if (c.tipo === "ok") {
    for (const recurso of sitio.espera?.recursos || []) {
      const rr = await revisarRecurso(recurso);
      if (rr.tipo !== "ok") return {...base, ms, http: res.status, huella: h, titulo: c.titulo, ...rr};
    }
  }
  return {...base, ms, http: res.status, huella: h, ...c};
}

async function revisarRecurso(recurso) {
  try {
    const res = await fetch(recurso.url, {headers: {"user-agent": UA}, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS)});
    await res.body?.cancel();
    const encabezados = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
    return clasificarRecurso(recurso, {status: res.status, encabezados});
  } catch (error) {
    return clasificarRecurso(recurso, {error});
  }
}
