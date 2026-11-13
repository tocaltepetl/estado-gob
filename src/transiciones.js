// Detector de transiciones. Código puro: recibe el estado guardado de un
// sitio (por origen de revisión) y el resultado nuevo; devuelve el estado
// siguiente, la transición (si la hay) y qué hacer.
//
// Regla de fondo (docs/decisiones.md, «Clasificación de fallas»):
// - Fallas de red, TLS, 5xx, WAF/CDN → del sitio; se publican tras CONFIRMAR
//   revisiones seguidas, para no publicar un tropiezo aislado.
// - Fallas de contenido con HTTP 200 (marcador/selector) → primero se asume que
//   la revisión quedó obsoleta: «en revisión», no «caído», y se avisa a
//   quien mantiene el proyecto.
// - Retos/bloqueos a la revisión → «bloqueado», no se publican como caída.

export const CONFIRMAR = 2;

const DEGRADA = new Set(["iframe_vacio", "dependencia_caida", "recurso_roto"]);

export function siguiente(previo, r) {
  const p = previo || {tipo: null, publico: "sin_datos", consecutivas: 0, huella_ok: null};
  const e = {...p, tipo: r.tipo, detalle: r.detalle ?? null};
  let accion = null;
  let interpretacion = null;

  if (r.tipo === "ok") {
    e.publico = "operando";
    e.consecutivas = 0;
    if (r.huella) {
      if (p.huella_ok && p.huella_ok !== r.huella) interpretacion = "cambio_estructura";
      e.huella_ok = r.huella;
    }
    if (p.publico !== "operando" && p.publico !== "sin_datos") interpretacion = "recuperado";
  } else if (r.atribucion === "sitio") {
    const seguiaFallando = p.tipo && p.tipo !== "ok" && TIPO_SITIO(p);
    e.consecutivas = seguiaFallando ? p.consecutivas + 1 : 1;
    if (e.consecutivas >= CONFIRMAR || p.publico === "caido" || p.publico === "degradado") {
      e.publico = DEGRADA.has(r.tipo) ? "degradado" : "caido";
      if (p.publico !== e.publico) { interpretacion = "falla_sitio"; accion = "publicar"; }
      else if (p.tipo !== r.tipo) interpretacion = "cambio_falla";   // p. ej. tcp_timeout → http_5xx
    } else {
      e.publico = "verificando";
      interpretacion = p.tipo !== r.tipo ? "posible_falla" : null;
    }
  } else if (r.atribucion === "nosotros") {
    e.publico = "en_revision";
    e.consecutivas = 0;
    if (p.publico !== "en_revision" || p.tipo !== r.tipo) {
      // Si la estructura también cambió, lo más probable es un rediseño.
      interpretacion = r.huella && p.huella_ok && r.huella !== p.huella_ok ? "rediseno_probable" : "revision_obsoleta";
      accion = "revisar";
    }
  } else if (r.atribucion === "bloqueo") {
    e.publico = "bloqueado";
    e.consecutivas = 0;
    if (p.publico !== "bloqueado") { interpretacion = "bloqueo"; accion = "bloqueo"; }
  }

  const transicion = interpretacion ? {de: p.tipo, a: r.tipo, interpretacion} : null;
  return {estado: e, transicion, accion};
}

// El tipo previo ¿era una falla atribuible al sitio? (se guarda la atribución
// junto al estado; si falta, se asume que sí cuando estaba verificando/caído).
function TIPO_SITIO(p) {
  return ["verificando", "caido", "degradado"].includes(p.publico);
}

// Combina el estado de varios orígenes (mx: revisor en México; cf: cron de
// Cloudflare, que puede salir con IP extranjera). Devuelve el estado público.
export const FRESCO_MS = 30 * 60 * 1000;
const ORDEN = ["caido", "degradado", "verificando", "en_revision", "bloqueado", "operando", "sin_datos"];

export function combinar(porOrigen, ahora = Date.now()) {
  const frescos = porOrigen.filter((s) => ahora - s.ts < FRESCO_MS);
  const usar = frescos.length ? frescos : porOrigen;
  if (!usar.length) return {publico: "sin_datos"};
  const mx = usar.find((s) => s.origen === "mx");
  const fuera = usar.find((s) => s.origen !== "mx");
  // Falla vista solo desde fuera de México mientras en México funciona: posible geobloqueo.
  if (mx?.publico === "operando" && fuera && ["caido", "verificando", "bloqueado"].includes(fuera.publico)) {
    return {...mx, nota: "geobloqueo_probable"};
  }
  // El más grave; a igual gravedad, el de México: Node distingue mejor el error
  // (p. ej. «cierra sin responder») que el `fetch` de Workers («connection lost»).
  return [...usar].sort((a, b) => ORDEN.indexOf(a.publico) - ORDEN.indexOf(b.publico) ||
                                  (b.origen === "mx") - (a.origen === "mx"))[0];
}
