import {test} from "node:test";
import assert from "node:assert/strict";
import {validar, armarIssue, bloque, recibirSolicitud, verificarTurnstile} from "../src/solicitudes.js";
import sitiosCfg from "../config/sitios.json" with {type: "json"};

const SITIOS = sitiosCfg.sitios;
const NUEVO = {tipo: "nuevo-sitio", url: "https://tramites.zapopan.gob.mx/x", dependencia: "Zapopan",
  para_que: "Pagar predial", sana: "", login: "No", datos: true};
const REPORTE = {tipo: "reporte", sitio: SITIOS[0].id, k: 0, cuando: "ayer 10am", detalle: "", datos: true};

test("valida nuevo sitio y reporte", () => {
  assert.ok(validar(NUEVO, SITIOS).datos);
  assert.ok(validar(REPORTE, SITIOS).datos);
  assert.equal(validar({...REPORTE, sitio: "otra", url: "https://x.gob.mx"}, SITIOS).datos.url, "https://x.gob.mx/");
});

test("rechaza valores inválidos", () => {
  assert.equal(validar({...NUEVO, datos: false}, SITIOS).error, "datos");
  assert.equal(validar({...NUEVO, url: "javascript:alert(1)"}, SITIOS).error, "url");
  assert.equal(validar({...NUEVO, login: "quizá"}, SITIOS).error, "login");
  assert.equal(validar({...NUEVO, para_que: "x".repeat(1001)}, SITIOS).error, "para_que");
  assert.equal(validar({...REPORTE, sitio: "inventado"}, SITIOS).error, "sitio");
  assert.equal(validar({...REPORTE, k: 99}, SITIOS).error, "k");
  assert.equal(validar({...REPORTE, sitio: "otra"}, SITIOS).error, "url");
  assert.equal(validar({tipo: "otro", datos: true}, SITIOS).error, "tipo");
});

test("el texto libre no puede salir del bloque de código", () => {
  const b = bloque("hola\n```\n@alguien [x](https://spam)\n```");
  const cerca = b.split("\n")[0].replace("text", "");
  assert.ok(cerca.length >= 4);
  assert.ok(b.endsWith("\n" + cerca));
  assert.ok(!b.slice(cerca.length + 4, -cerca.length - 1).includes(cerca));
});

test("arma el issue con etiquetas y sin menciones en el título", () => {
  const n = armarIssue(validar(NUEVO, SITIOS).datos);
  assert.equal(n.title, "Nuevo sitio: tramites.zapopan.gob.mx");
  assert.deepEqual(n.labels, ["nuevo-sitio", "via-web"]);
  const r = armarIssue(validar({...REPORTE, detalle: "@octocat ayuda"}, SITIOS).datos);
  assert.deepEqual(r.labels, ["reporte", "via-web", `sitio:${SITIOS[0].id}`]);
  assert.match(r.body, /```text\n@octocat ayuda\n```/);
  assert.ok(!armarIssue(validar({...REPORTE, sitio: "otra", url: "https://a.gob.mx/@x#1"}, SITIOS).datos).title.match(/[@#]/));
});

test("Turnstile: sin secreto solo pasa en local", async () => {
  assert.equal(await verificarTurnstile({DEV: "1"}, ""), true);
  assert.equal(await verificarTurnstile({}, "t"), false);
  const ok = async () => new Response(JSON.stringify({success: true}));
  const no = async () => new Response(JSON.stringify({success: false}));
  assert.equal(await verificarTurnstile({TURNSTILE_SECRET: "s"}, "t", "1.2.3.4", ok), true);
  assert.equal(await verificarTurnstile({TURNSTILE_SECRET: "s"}, "t", "", no), false);
  assert.equal(await verificarTurnstile({TURNSTILE_SECRET: "s"}, "", "", ok), false);
});

const pedir = (body, host = "estado.tocaltepetl.org") => [
  new Request(`https://${host}/api/solicitud`, {method: "POST", body: JSON.stringify(body)}),
  new URL(`https://${host}/api/solicitud`),
];

test("en producción verifica y abre el issue", async () => {
  const llamadas = [];
  const fetchFn = async (u, init) => {
    llamadas.push(String(u));
    if (String(u).includes("turnstile")) return new Response(JSON.stringify({success: true}));
    return new Response(JSON.stringify({number: 42, html_url: "https://github.com/x/42"}));
  };
  const env = {TURNSTILE_SECRET: "s", GITHUB_TOKEN: "g"};
  const [req, url] = pedir({...NUEVO, turnstile: "t"});
  const r = await recibirSolicitud(req, env, url, SITIOS, fetchFn);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).issue, 42);
  assert.ok(llamadas.some((u) => u.endsWith("/repos/tocaltepetl/estado-gob/issues")));
});

test("rechaza si Turnstile falla, y finge éxito con el campo trampa", async () => {
  const fetchFn = async () => new Response(JSON.stringify({success: false}));
  const env = {TURNSTILE_SECRET: "s", GITHUB_TOKEN: "g"};
  let [req, url] = pedir({...NUEVO, turnstile: "t"});
  assert.equal((await recibirSolicitud(req, env, url, SITIOS, fetchFn)).status, 403);
  [req, url] = pedir({...NUEVO, web: "spam"});
  const r = await recibirSolicitud(req, env, url, SITIOS, () => { throw new Error("no debe llamar"); });
  assert.deepEqual(await r.json(), {ok: true, issue: null});
});

test("fuera de producción no publica", async () => {
  const fetchFn = async () => new Response(JSON.stringify({success: true}));
  const [req, url] = pedir({...NUEVO, turnstile: "t"}, "preview.estado-gob.workers.dev");
  const r = await recibirSolicitud(req, {TURNSTILE_SECRET: "s", GITHUB_TOKEN: "g"}, url, SITIOS, fetchFn);
  assert.equal((await r.json()).publicado, false);
});
