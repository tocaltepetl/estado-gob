// Casos reales observados el 12–13 nov 2026 (ver docs/decisiones.md).
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {clasificarErrorRed, clasificarRespuesta} from "../src/clasificar.js";
import firmasCfg from "../config/firmas.json" with {type: "json"};

const F = firmasCfg.firmas;
const fetchFallido = (code, message) => Object.assign(new TypeError("fetch failed"), {cause: Object.assign(new Error(message), {code})});

test("RPPC: el servidor cierra la conexión sin responder", () => {
  const r = clasificarErrorRed(fetchFallido("UND_ERR_SOCKET", "other side closed"));
  assert.equal(r.tipo, "cierre_sin_respuesta");
  assert.equal(r.atribucion, "sitio");
});

test("Catastro GDL: sin respuesta al conectar", () => {
  assert.equal(clasificarErrorRed(fetchFallido("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error")).tipo, "tcp_timeout");
});

test("SIAPA no adeudo: 503 del WAF de Check Point es waf_upstream, no un 5xx genérico", () => {
  const cuerpo = readFileSync(new URL("./fixtures/siapa-waf-503.html", import.meta.url), "utf8");
  const r = clasificarRespuesta({status: 503, encabezados: {server: "AmazonS3"}, cuerpo}, {espera: {status: 200}}, F);
  assert.equal(r.tipo, "waf_upstream");
  assert.equal(r.firma, "checkpoint-upstream");
  assert.equal(r.atribucion, "sitio");
});

test("TLS y DNS", () => {
  assert.equal(clasificarErrorRed(fetchFallido("ECONNRESET", "Client network socket disconnected before secure TLS connection was established")).tipo, "tls_eof");
  assert.equal(clasificarErrorRed(fetchFallido("CERT_HAS_EXPIRED", "certificate has expired")).tipo, "tls_cert_expirado");
  assert.equal(clasificarErrorRed(fetchFallido("ENOTFOUND", "getaddrinfo ENOTFOUND x.gob.mx")).tipo, "dns_nxdomain");
  assert.equal(clasificarErrorRed(new DOMException("The operation was aborted due to timeout", "TimeoutError")).tipo, "timeout");
});

test("200 sin el marcador esperado se atribuye a nosotros", () => {
  const r = clasificarRespuesta({status: 200, cuerpo: "<title>Nuevo portal</title><h1>Hola</h1>"}, {espera: {status: 200, contiene: "Gobierno de Jalisco"}}, F);
  assert.equal(r.tipo, "falta_marcador");
  assert.equal(r.atribucion, "nosotros");
});

test("Página de error de ASP.NET con 200 es falla del sitio", () => {
  const r = clasificarRespuesta({status: 200, cuerpo: "<title>Runtime Error</title>Server Error in '/RegistroWeb' Application."}, {espera: {status: 200}}, F);
  assert.equal(r.tipo, "pagina_error_app");
});

test("403 y reto de Cloudflare se tratan como bloqueo", () => {
  assert.equal(clasificarRespuesta({status: 403, cuerpo: ""}, {}, F).atribucion, "bloqueo");
  const r = clasificarRespuesta({status: 403, encabezados: {server: "cloudflare"}, cuerpo: "<title>Just a moment...</title>"}, {}, F);
  assert.equal(r.tipo, "waf_reto");
});

test("404 sugiere que la URL se movió (nosotros)", () => {
  assert.equal(clasificarRespuesta({status: 404, cuerpo: ""}, {}, F).atribucion, "nosotros");
});

test("Códigos 52x de Cloudflare (origen cf): mismo diagnóstico que desde México", () => {
  // Observado en producción el 13 nov 2026: RPPC → 520, Catastro GDL → 522.
  assert.equal(clasificarRespuesta({status: 520, cuerpo: ""}, {}, F).tipo, "cierre_sin_respuesta");
  assert.equal(clasificarRespuesta({status: 522, cuerpo: ""}, {}, F).tipo, "tcp_timeout");
  assert.equal(clasificarRespuesta({status: 503, cuerpo: ""}, {}, F).tipo, "http_5xx");
});
