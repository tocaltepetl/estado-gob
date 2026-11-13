// Worker de estado-gob.
// - scheduled (cron, cada 5 min): revisa todos los sitios `http` y registra.
// - POST /api/resultado: recibe revisiones de otros orígenes (p. ej. el
//   revisor en México, scripts/revisar.mjs). Requiere `Authorization: Bearer`.
// - POST /api/solicitud: nuevo sitio o reporte con detalle; abre un issue
//   sin que la persona necesite cuenta de GitHub (src/solicitudes.js).
// - GET /api/estado: estado público de cada sitio + barras de 90 días.
// - GET /api/historial?sitio=ID: últimas revisiones y transiciones de un sitio.
// Todo lo demás lo sirve `public/` sin pasar por aquí (run_worker_first).

import sitiosCfg from "../config/sitios.json" with {type: "json"};
import firmasCfg from "../config/firmas.json" with {type: "json"};
import {revisar} from "./revisar.js";
import {siguiente, combinar} from "./transiciones.js";
import {TIPOS, describir} from "./clasificar.js";
import {abrirIssue, debeAvisar} from "./avisos.js";
import {recibirReporte, agregados} from "./reportes.js";
import {contactoPublico} from "./contacto.js";
import {recibirSolicitud} from "./solicitudes.js";

const SITIOS = sitiosCfg.sitios;
const FIRMAS = firmasCfg.firmas;
const DIA_MS = 86400000;
const DIAS_BARRA = 90;
const CACHE_S = 60;
const ORIGENES = /^[a-z]{2,8}$/;

export default {
  async scheduled(_evt, env, ctx) {
    const rs = await Promise.all(SITIOS.filter((s) => s.tipo === "http").map((s) => revisar(s, FIRMAS, {origen: "cf"})));
    for (const r of rs) await registrar(env, r);
    // Retención: el detalle por revisión se guarda 120 días.
    ctx.waitUntil(env.DB.prepare("DELETE FROM revisiones WHERE ts < ?").bind(Date.now() - 120 * DIA_MS).run());
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/resultado") return await recibir(req, env);
      if (url.pathname === "/api/reporte") return await recibirReporte(req, env, url, SITIOS);
      if (url.pathname === "/api/solicitud") return await recibirSolicitud(req, env, url, SITIOS);
      if (url.pathname === "/api/estado") return await estado(req, env, ctx, url);
      if (url.pathname === "/api/historial") return await historial(env, url);
      if (url.pathname === "/api/revisar" && env.DEV === "1") {   // solo local: dispara el cron a mano
        await this.scheduled(null, env, ctx);
        return json({ok: true});
      }
    } catch (e) {
      console.error(e);
      return json({error: "no disponible"}, 503);
    }
    if (url.pathname.startsWith("/api/")) return json({error: "no existe"}, 404);
    return env.ASSETS.fetch(req);
  },
};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json; charset=utf-8", ...headers}});

// Guarda la revisión, actualiza el estado del par (sitio, origen) y, si hubo
// transición, la registra y ejecuta la acción (abrir issue).
export async function registrar(env, r) {
  const db = env.DB;
  await db.prepare(`INSERT INTO revisiones (sitio, ts, origen, tipo, capa, atribucion, http, ms, detalle, firma, huella, titulo)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(r.sitio, r.ts, r.origen, r.tipo, r.capa, r.atribucion, r.http, r.ms, r.detalle, r.firma || null, r.huella, r.titulo || null).run();

  const previo = await db.prepare("SELECT * FROM estado WHERE sitio = ? AND origen = ?").bind(r.sitio, r.origen).first();
  const {estado: e, transicion, accion} = siguiente(previo, r);
  const desde = previo && previo.publico === e.publico ? previo.desde : r.ts;
  await db.prepare(`INSERT INTO estado (sitio, origen, ts, tipo, detalle, publico, desde, consecutivas, huella_ok)
                    VALUES (?,?,?,?,?,?,?,?,?)
                    ON CONFLICT (sitio, origen) DO UPDATE SET ts=excluded.ts, tipo=excluded.tipo, detalle=excluded.detalle,
                      publico=excluded.publico, desde=excluded.desde, consecutivas=excluded.consecutivas, huella_ok=excluded.huella_ok`)
    .bind(r.sitio, r.origen, r.ts, e.tipo, e.detalle, e.publico, desde, e.consecutivas, e.huella_ok || null).run();

  if (!transicion) return;
  let issue = null;
  const sitio = SITIOS.find((s) => s.id === r.sitio);
  if (debeAvisar(sitio, r, accion)) {
    issue = await abrirIssue(env, {sitio, r, previo, transicion}).catch((err) => { console.error(err); return null; });
  }
  await db.prepare("INSERT INTO transiciones (sitio, origen, ts, de, a, interpretacion, issue) VALUES (?,?,?,?,?,?,?)")
    .bind(r.sitio, r.origen, r.ts, transicion.de, transicion.a, transicion.interpretacion, issue).run();
}

async function recibir(req, env) {
  if (req.method !== "POST") return json({error: "usa POST"}, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.TOKEN_REVISOR || token !== env.TOKEN_REVISOR) return json({error: "token"}, 401);
  let lista;
  try { lista = await req.json(); } catch { return json({error: "json"}, 400); }
  if (!Array.isArray(lista) || lista.length > 200) return json({error: "se espera una lista"}, 400);
  let n = 0;
  for (const r of lista) {
    // Solo valores conocidos: el tipo define capa y atribución, no el cliente.
    if (!SITIOS.some((s) => s.id === r?.sitio) || !TIPOS[r.tipo] || !ORIGENES.test(r.origen) || r.origen === "cf") continue;
    const [capa, atribucion] = TIPOS[r.tipo];
    const ts = Number.isFinite(r.ts) && Math.abs(Date.now() - r.ts) < DIA_MS ? r.ts : Date.now();
    const corto = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : null);
    await registrar(env, {
      sitio: r.sitio, ts, origen: r.origen, tipo: r.tipo, capa, atribucion,
      http: Number.isInteger(r.http) ? r.http : null, ms: Number.isInteger(r.ms) ? r.ms : null,
      detalle: corto(r.detalle), firma: corto(r.firma, 60), huella: corto(r.huella, 32), titulo: corto(r.titulo),
    });
    n++;
  }
  return json({ok: true, registradas: n});
}

async function estado(req, env, ctx, url) {
  const cache = caches.default;
  const llave = new Request(url.origin + "/api/estado", req);
  const hit = env.DEV === "1" ? null : await cache.match(llave);
  if (hit) return hit;

  const ahora = Date.now();
  const desde = ahora - DIAS_BARRA * DIA_MS;
  const [filas, dias, ult, rep] = await Promise.all([
    env.DB.prepare("SELECT * FROM estado").all(),
    // Por día (UTC-6, hora de Jalisco): revisiones totales y con falla atribuida al sitio.
    env.DB.prepare(`SELECT sitio, CAST((ts - 21600000) / 86400000 AS INTEGER) AS dia,
                           COUNT(*) AS n, SUM(atribucion = 'sitio') AS fallas, AVG(CASE WHEN tipo='ok' THEN ms END) AS ms
                    FROM revisiones WHERE ts >= ? GROUP BY sitio, dia`).bind(desde).all(),
    env.DB.prepare(`SELECT sitio, ts, de, a, interpretacion FROM transiciones
                    WHERE interpretacion IN ('falla_sitio','recuperado','cambio_falla') ORDER BY ts DESC LIMIT 30`).all(),
    agregados(env, ahora),
  ]);

  const porSitio = {};
  for (const f of filas.results) (porSitio[f.sitio] ||= []).push(f);
  const actual = Object.fromEntries(SITIOS.map((s) => [s.id, combinar(porSitio[s.id] || [], ahora)]));

  const sitios = SITIOS.map((s) => {
    let st = actual[s.id];
    // Bloqueo conocido (catálogo): se dice como dato, no como «posible geobloqueo».
    if (st.nota === "geobloqueo_probable" && s.bloquea?.length) st = {...st, nota: "bloqueo_conocido"};
    let tipo = st.tipo, publico = st.publico;
    // Dependencias: el contenedor carga pero algo incrustado está caído.
    if (publico === "operando" && s.depende?.some((d) => actual[d]?.publico === "caido")) {
      publico = "degradado"; tipo = "dependencia_caida";
    }
    const barras = dias.results.filter((d) => d.sitio === s.id)
      .map((d) => ({dia: d.dia, n: d.n, fallas: d.fallas, ms: d.ms ? Math.round(d.ms) : null}));
    const total = barras.reduce((a, b) => a + b.n, 0);
    const fallas = barras.reduce((a, b) => a + b.fallas, 0);
    return {
      id: s.id, nombre: s.nombre, dependencia: s.dependencia,
      estado: s.estado || null, municipio: s.municipio || null, temas: s.temas || [], url: s.enlace || s.url, login: Boolean(s.login), depende: s.depende || [],
      contacto: contactoPublico(s.contacto),
      publico, tipo: tipo ?? null, motivo: tipo && tipo !== "ok" ? describir(tipo) : null, detalle: st.detalle || null,
      desde: st.desde || null, ts: st.ts || null, nota: st.nota || null,
      disponibilidad: total ? 1 - fallas / total : null, barras,
      reportes: rep[s.id] || {recientes: 0, dia: 0, tipos: {}},
    };
  });
  const res = json({generado: ahora, sitios, incidentes: ult.results}, 200,
    {"cache-control": `public, max-age=${CACHE_S}`, "access-control-allow-origin": "*"});
  ctx.waitUntil(cache.put(llave, res.clone()));
  return res;
}

async function historial(env, url) {
  const id = url.searchParams.get("sitio");
  if (!SITIOS.some((s) => s.id === id)) return json({error: "sitio"}, 404);
  const [rev, tr] = await Promise.all([
    env.DB.prepare("SELECT ts, origen, tipo, capa, atribucion, http, ms, detalle FROM revisiones WHERE sitio = ? ORDER BY ts DESC LIMIT 300").bind(id).all(),
    env.DB.prepare("SELECT ts, origen, de, a, interpretacion FROM transiciones WHERE sitio = ? ORDER BY ts DESC LIMIT 100").bind(id).all(),
  ]);
  return json({sitio: id, revisiones: rev.results, transiciones: tr.results}, 200, {"cache-control": "public, max-age=60"});
}
