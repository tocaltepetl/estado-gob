import {test} from "node:test";
import assert from "node:assert/strict";
import {siguiente, combinar, CONFIRMAR} from "../src/transiciones.js";
import {huella} from "../src/huella.js";

const ok = (h = "aaa") => ({tipo: "ok", atribucion: null, huella: h});
const falla = (tipo, atribucion = "sitio", h = null) => ({tipo, atribucion, huella: h});

function correr(...rs) {
  let e = null; const tr = [];
  for (const r of rs) { const s = siguiente(e, r); e = s.estado; tr.push(s); }
  return {e, tr};
}

test("una falla aislada queda en verificando; se publica al confirmarse", () => {
  const {e, tr} = correr(ok(), falla("tcp_timeout"));
  assert.equal(e.publico, "verificando");
  const s = siguiente(e, falla("tcp_timeout"));
  assert.equal(CONFIRMAR, 2);
  assert.equal(s.estado.publico, "caido");
  assert.equal(s.accion, "publicar");
  assert.equal(tr[1].transicion.interpretacion, "posible_falla");
});

test("cambio de tipo de falla del sitio se registra como cambio_falla", () => {
  const {tr, e} = correr(ok(), falla("tcp_timeout"), falla("tcp_timeout"), falla("waf_upstream"));
  assert.equal(e.publico, "caido");
  assert.equal(tr[3].transicion.interpretacion, "cambio_falla");
  assert.equal(tr[3].accion, null);
});

test("200 sin marcador y con huella distinta: rediseño probable, no caída", () => {
  const {e, tr} = correr(ok("aaa"), falla("falta_marcador", "nosotros", "bbb"));
  assert.equal(e.publico, "en_revision");
  assert.equal(tr[1].transicion.interpretacion, "rediseno_probable");
  assert.equal(tr[1].accion, "revisar");
  // No se repite el aviso mientras siga igual.
  assert.equal(siguiente(e, falla("falta_marcador", "nosotros", "bbb")).accion, null);
});

test("200 sin marcador con la misma huella: revisión obsoleta", () => {
  const {tr} = correr(ok("aaa"), falla("falta_marcador", "nosotros", "aaa"));
  assert.equal(tr[1].transicion.interpretacion, "revision_obsoleta");
});

test("reto del WAF: bloqueado, no caído", () => {
  const {e, tr} = correr(ok(), falla("waf_reto", "bloqueo"));
  assert.equal(e.publico, "bloqueado");
  assert.equal(tr[1].accion, "bloqueo");
});

test("recuperación", () => {
  const {e, tr} = correr(falla("http_5xx"), falla("http_5xx"), ok());
  assert.equal(e.publico, "operando");
  assert.equal(tr[2].transicion.interpretacion, "recuperado");
});

test("combinar: falla solo desde fuera de México → geobloqueo probable", () => {
  const ahora = Date.now();
  const r = combinar([{origen: "cf", publico: "caido", ts: ahora}, {origen: "mx", publico: "operando", ts: ahora}], ahora);
  assert.equal(r.publico, "operando");
  assert.equal(r.nota, "geobloqueo_probable");
});

test("combinar: caído en ambos orígenes", () => {
  const ahora = Date.now();
  assert.equal(combinar([{origen: "cf", publico: "caido", ts: ahora}, {origen: "mx", publico: "caido", ts: ahora}], ahora).publico, "caido");
});

test("huella ignora texto y versiones de scripts, detecta cambios de estructura", async () => {
  const a = await huella('<div id="menu">Hola</div><script src="/app.js?v=1"></script>');
  const b = await huella('<div id="menu">Adiós</div><script src="/app.js?v=2"></script>');
  const c = await huella('<div id="nav">Hola</div><script src="/app.js?v=1"></script>');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("combinar: a igual gravedad, prefiere el diagnóstico de México", () => {
  const ahora = Date.now();
  const r = combinar([{origen: "cf", publico: "caido", tipo: "tcp_reset", ts: ahora}, {origen: "mx", publico: "caido", tipo: "cierre_sin_respuesta", ts: ahora}], ahora);
  assert.equal(r.tipo, "cierre_sin_respuesta");
});
