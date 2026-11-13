// Reportes ciudadanos anónimos («¿No te funciona?» en cada tarjeta).
// - Solo valores de listas cerradas: sitio y tipo de falla. Sin texto libre,
//   cookies, IP ni identificadores. La IP solo es la llave en memoria del
//   límite de peticiones (binding LIMITE).
// - Solo el dominio de producción (y localhost) guarda: las vistas previas
//   de los PR comparten la base.
// - Se publican conteos solo a partir de MIN_PUBLICAR reportes en la ventana.
// Ver docs/decisiones.md («Reportes ciudadanos»).

export const TIPOS_REPORTE = ["no_carga", "parte_no_aparece", "login", "pago_descarga", "lenta", "otro"];
export const PROD_HOST = "estado.tocaltepetl.org";
export const MIN_PUBLICAR = 3;
export const VENTANA_MS = 2 * 3600 * 1000;      // «reportes recientes»
const DIA_MS = 86400000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json; charset=utf-8"}});

export async function recibirReporte(req, env, url, sitios) {
  if (req.method !== "POST") return json({error: "usa POST"}, 405);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return json({error: "origen"}, 403);
  if (env.LIMITE) {
    const {success} = await env.LIMITE.limit({key: req.headers.get("cf-connecting-ip") || "?"});
    if (!success) return json({error: "demasiadas"}, 429);
  }
  let b;
  try { b = JSON.parse(await req.text()); } catch { return json({error: "json"}, 400); }
  const k = b?.k;
  if (!sitios.some((s) => s.id === b?.sitio) || !Number.isInteger(k) || k < 0 || k >= TIPOS_REPORTE.length) {
    return json({error: "valores"}, 400);
  }
  const guardar = url.hostname === PROD_HOST || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (guardar) await env.DB.prepare("INSERT INTO reportes (ts, sitio, k) VALUES (?,?,?)").bind(Date.now(), b.sitio, k).run();
  return json({ok: true, guardado: guardar});
}

// Agregados por sitio para /api/estado. Conteos por debajo de MIN_PUBLICAR → 0.
export async function agregados(env, ahora = Date.now()) {
  const {results} = await env.DB.prepare(
    `SELECT sitio, k, SUM(ts >= ?) AS recientes, COUNT(*) AS dia FROM reportes WHERE ts >= ? GROUP BY sitio, k`,
  ).bind(ahora - VENTANA_MS, ahora - DIA_MS).all();
  const por = {};
  for (const r of results) {
    const a = (por[r.sitio] ||= {recientes: 0, dia: 0, tipos: {}});
    a.recientes += r.recientes; a.dia += r.dia;
    a.tipos[TIPOS_REPORTE[r.k]] = r.recientes;
  }
  for (const a of Object.values(por)) {
    if (a.recientes < MIN_PUBLICAR) { a.recientes = 0; a.tipos = {}; }
    else for (const [t, n] of Object.entries(a.tipos)) if (n < MIN_PUBLICAR) delete a.tipos[t];
    if (a.dia < MIN_PUBLICAR) a.dia = 0;
  }
  return por;
}
