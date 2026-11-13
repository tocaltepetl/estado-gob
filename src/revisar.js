// Una revisión HTTP de un sitio. Usa `fetch`, disponible igual en Workers y
// en Node 22, para que el cron y el revisor local midan lo mismo.

import {clasificarErrorRed, clasificarRespuesta} from "./clasificar.js";
import {huella} from "./huella.js";

export const UA = "estado-gob/0.1 (+https://github.com/tocaltepetl/estado-gob; monitor ciudadano, 1 revision cada 5 min)";
const TIMEOUT_MS = 20000;
const MAX_BYTES = 2_000_000;

export async function revisar(sitio, firmas, {origen}) {
  const t0 = Date.now();
  const base = {sitio: sitio.id, ts: t0, origen};
  const headers = {"user-agent": UA, "accept": "text/html,*/*;q=0.8", "accept-language": "es-MX,es;q=0.9"};
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res;
  try {
    // `previa`: página que hay que visitar antes para obtener la sesión (cookies).
    // Sin ella, algunos sitios (p. ej. el login del SAT) responden 200 en blanco.
    if (sitio.previa) {
      const r0 = await fetch(sitio.previa, {headers, redirect: "follow", signal});
      await r0.arrayBuffer();
      const cookie = r0.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      if (cookie) headers.cookie = cookie;
    }
    res = await fetch(sitio.url, {headers, redirect: "follow", signal});
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
  return {...base, ms, http: res.status, huella: h, ...c};
}
