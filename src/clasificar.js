// Clasificación de fallas. Código puro: lo usan el Worker (cron) y el
// revisor local en Node (scripts/revisar.mjs), y lo prueban los tests.
//
// Entrada: lo que se observó en una revisión (error de red o respuesta HTTP).
// Salida: {capa, tipo, atribucion, detalle}.
//   atribucion = 'sitio'   → falla del sitio; se puede publicar como incidente.
//                'nosotros' → probablemente cambió el sitio y la revisión
//                             (marcador/selector) quedó obsoleta; no se publica.
//                'bloqueo'  → el sitio nos retó o bloqueó; no se publica.
//                null       → todo bien.
// Ver docs/decisiones.md («Clasificación de fallas: sitio vs. scraper»).

export const CAPAS = ["dns", "red", "tls", "http", "intermediario", "contenido", "navegador", "dependencia"];

// tipo → [capa, atribución, texto para la ciudadanía]
export const TIPOS = {
  ok:                   [null, null, "Funciona"],
  dns_nxdomain:         ["dns", "sitio", "El dominio no existe o no resuelve"],
  dns_timeout:          ["dns", "sitio", "El DNS no respondió"],
  tcp_timeout:          ["red", "sitio", "El servidor no responde"],
  tcp_refused:          ["red", "sitio", "El servidor rechaza la conexión"],
  tcp_reset:            ["red", "sitio", "El servidor corta la conexión"],
  cierre_sin_respuesta: ["red", "sitio", "El servidor cierra la conexión sin responder"],
  red_error:            ["red", "sitio", "Error de red al conectar"],
  tls_eof:              ["tls", "sitio", "El servidor corta la conexión segura antes de responder"],
  tls_cert_expirado:    ["tls", "sitio", "El certificado de seguridad venció"],
  tls_cert_nombre:      ["tls", "sitio", "El certificado no corresponde al dominio"],
  tls_cert_invalido:    ["tls", "sitio", "Certificado de seguridad inválido"],
  tls_error:            ["tls", "sitio", "Error en la conexión segura"],
  timeout:              ["red", "sitio", "La página tardó demasiado en responder"],
  http_5xx:             ["http", "sitio", "Error del servidor"],
  http_404:             ["http", "nosotros", "La dirección ya no existe (¿se movió?)"],
  http_403:             ["http", "bloqueo", "Acceso denegado a la revisión automática"],
  http_4xx:             ["http", "nosotros", "Respuesta inesperada del servidor"],
  redirect_loop:        ["http", "sitio", "Redirecciones en bucle"],
  waf_upstream:         ["intermediario", "sitio", "El firewall responde, pero el servidor de atrás no"],
  cdn_error:            ["intermediario", "sitio", "La red de distribución no alcanza al servidor"],
  waf_reto:             ["intermediario", "bloqueo", "El sitio pidió verificación (captcha) a la revisión automática"],
  pagina_mantenimiento: ["contenido", "sitio", "Aviso de mantenimiento"],
  pagina_error_app:     ["contenido", "sitio", "La aplicación muestra una página de error"],
  falta_marcador:       ["contenido", "nosotros", "No se encontró el contenido esperado"],
  iframe_vacio:         ["navegador", "sitio", "Un componente incrustado no carga"],
  selector_ausente:     ["navegador", "nosotros", "No se encontró el elemento esperado"],
  login_rechazado:      ["navegador", "nosotros", "No se pudo iniciar sesión con la cuenta de prueba"],
  dependencia_caida:    ["dependencia", "sitio", "Carga, pero un servicio del que depende está caído"],
  recurso_roto:         ["dependencia", "sitio", "Carga, pero una parte de la página no funciona"],
};

const resultado = (tipo, detalle = null) => {
  const [capa, atribucion] = TIPOS[tipo];
  return {tipo, capa, atribucion, detalle};
};

// Errores de red en Node (`err.code`, también en `err.cause.code` con fetch)
// y en Workers (solo mensaje, menos preciso).
export function clasificarErrorRed(err) {
  const code = err?.code || err?.cause?.code || "";
  // fetch envuelve el error real: «fetch failed» + cause {code, message}.
  const msg = [err?.message, err?.cause?.message].filter(Boolean).join(": ") || String(err || "");
  const t = `${code} ${msg}`;
  if (/ENOTFOUND|EAI_NONAME|NXDOMAIN/.test(t)) return resultado("dns_nxdomain", code || msg);
  if (/EAI_AGAIN/.test(t)) return resultado("dns_timeout", code);
  if (/CERT_HAS_EXPIRED|certificate has expired/i.test(t)) return resultado("tls_cert_expirado", code || msg);
  if (/ERR_TLS_CERT_ALTNAME_INVALID|altname|hostname.*mismatch/i.test(t)) return resultado("tls_cert_nombre", code || msg);
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return resultado("tls_cert_invalido", code);
  // Conexión cerrada justo tras (o durante) el saludo TLS: «unexpected eof» / ECONNRESET con socket TLS.
  if (/unexpected eof|before secure TLS connection|socket disconnected before secure/i.test(t)) return resultado("tls_eof", msg);
  if (/ECONNREFUSED/.test(t)) return resultado("tcp_refused", code);
  if (/UND_ERR_SOCKET|other side closed|socket hang up/i.test(t)) return resultado("cierre_sin_respuesta", code || msg);
  if (/ECONNRESET|connection lost|connection reset/i.test(t)) return resultado("tcp_reset", code || msg);
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|ConnectTimeout|connect timeout/i.test(t)) return resultado("tcp_timeout", code || msg);
  if (/redirect count exceeded|too many redirects/i.test(t)) return resultado("redirect_loop", msg);
  if (/TimeoutError|aborted|timed out|timeout/i.test(t)) return resultado("timeout", msg);
  if (/SSL|TLS/i.test(t)) return resultado("tls_error", msg);
  return resultado("red_error", (code ? code + " " : "") + msg.slice(0, 200));
}

const CLOUDFLARE_5XX = {
  520: "cierre_sin_respuesta",  // respuesta vacía o inesperada del origen
  521: "tcp_refused",           // el origen rechazó la conexión
  522: "tcp_timeout",           // no se pudo conectar a tiempo
  523: "red_error",             // origen inalcanzable
  524: "timeout",               // conectó, pero no respondió a tiempo
  525: "tls_error",             // falló el saludo TLS con el origen
  526: "tls_cert_invalido",     // certificado del origen inválido
};

const tituloDe = (html) => (html.match(/<title[^>]*>([^<]*)/i)?.[1] || "").trim().replace(/\s+/g, " ");

function coincideFirma(f, {titulo, cuerpo, encabezados}) {
  if (f.titulo && !new RegExp(f.titulo, "i").test(titulo)) return false;
  if (f.cuerpo && !new RegExp(f.cuerpo, "i").test(cuerpo)) return false;
  for (const [k, v] of Object.entries(f.encabezados || {})) {
    if (!(encabezados[k.toLowerCase()] || "").toLowerCase().includes(v.toLowerCase())) return false;
  }
  return Boolean(f.titulo || f.cuerpo || f.encabezados);
}

// Respuesta HTTP recibida. `sitio` es la entrada de config/sitios.json.
// `encabezados`: objeto con llaves en minúsculas.
export function clasificarRespuesta({status, encabezados = {}, cuerpo = ""}, sitio, firmas) {
  const titulo = tituloDe(cuerpo);
  // Quita los estilos y datos incrustados (fuentes en base64) antes de buscar texto.
  const texto = cuerpo.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/data:[^"')\s]+/g, "");
  const firma = firmas.find((f) => coincideFirma(f, {titulo, cuerpo: texto, encabezados}));
  if (firma) return {...resultado(firma.tipo, firma.descripcion), firma: firma.id, titulo};

  // Códigos propios de Cloudflare: los genera su red (o el `fetch` de Workers)
  // cuando no alcanza el servidor de origen. Dicen lo mismo que el error de red.
  const cf = CLOUDFLARE_5XX[status];
  if (cf) return {...resultado(cf, `HTTP ${status} (Cloudflare)`), titulo};
  if (status >= 500) return {...resultado("http_5xx", `HTTP ${status}`), titulo};
  if (status === 404 || status === 410) return {...resultado("http_404", `HTTP ${status}`), titulo};
  if (status === 403 || status === 429) return {...resultado("http_403", `HTTP ${status}`), titulo};
  if (status >= 400) return {...resultado("http_4xx", `HTTP ${status}`), titulo};

  const esperado = sitio?.espera || {};
  if (esperado.status && status !== esperado.status) return {...resultado("http_4xx", `HTTP ${status}, se esperaba ${esperado.status}`), titulo};
  if (esperado.contiene && !new RegExp(esperado.contiene, "i").test(texto)) {
    return {...resultado("falta_marcador", `Sin «${esperado.contiene}»`), titulo};
  }
  return {...resultado("ok"), titulo};
}

// Recurso del que depende la página (p. ej. las teselas del mapa base), en
// `espera.recursos`. Un recurso de terceros puede responder 200 y aun así
// venir roto: Carto, sin API key, entrega una marca de agua con etag «wm-…».
// `sin_encabezado`: {encabezado: regex} que NO debe coincidir.
export function clasificarRecurso(recurso, {status, encabezados = {}, error} = {}) {
  const nombre = recurso.nombre || recurso.url;
  if (error) return resultado("recurso_roto", `${nombre}: ${clasificarErrorRed(error).detalle || "error de red"}`);
  if (status < 200 || status >= 300) return resultado("recurso_roto", `${nombre}: HTTP ${status}`);
  for (const [k, re] of Object.entries(recurso.sin_encabezado || {})) {
    const v = encabezados[k.toLowerCase()];
    if (v != null && new RegExp(re, "i").test(v)) return resultado("recurso_roto", recurso.motivo ? `${nombre}: ${recurso.motivo}` : `${nombre}: ${k} «${v}»`);
  }
  return resultado("ok");
}

export const describir = (tipo) => TIPOS[tipo]?.[2] || tipo;
