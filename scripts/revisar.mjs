#!/usr/bin/env node
// Revisor desde México (origen `mx`). Corre las mismas revisiones que el cron
// del Worker, pero desde una conexión en México, para distinguir caídas reales
// de geobloqueos a IPs extranjeras. Ver docs/decisiones.md («Origen de las revisiones»).
//
// Uso:
//   node scripts/revisar.mjs                    # solo imprime
//   node scripts/revisar.mjs --enviar URL       # además manda a URL/api/resultado
//     (requiere la variable TOKEN_REVISOR)
//   node scripts/revisar.mjs --sitio rppc-jalisco
// Para cada 5 min: un timer de systemd o cron en una máquina en México.

import tls from "node:tls";
// Como Chrome y Firefox, no ofrecemos DHE: el SAT lo prefiere con una clave de
// 1024 bits que OpenSSL rechaza («dh key too small»); los navegadores negocian ECDHE.
tls.DEFAULT_CIPHERS += ":!kEDH";

import sitiosCfg from "../config/sitios.json" with {type: "json"};
import firmasCfg from "../config/firmas.json" with {type: "json"};
import {revisar} from "../src/revisar.js";
import {describir} from "../src/clasificar.js";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const destino = opt("--enviar");
const solo = opt("--sitio");
const origen = opt("--origen") || "mx";

const sitios = sitiosCfg.sitios.filter((s) => s.tipo === "http" && (!solo || s.id === solo));
const rs = await Promise.all(sitios.map((s) => revisar(s, firmasCfg.firmas, {origen})));

for (const r of rs) {
  const marca = r.tipo === "ok" ? "✓" : r.atribucion === "sitio" ? "✗" : "?";
  console.log(`${marca} ${r.sitio.padEnd(24)} ${r.tipo.padEnd(22)} ${String(r.http ?? "—").padEnd(4)} ${String(r.ms).padStart(6)} ms  ${r.tipo === "ok" ? "" : describir(r.tipo)}`);
}

if (destino) {
  const token = process.env.TOKEN_REVISOR;
  if (!token) { console.error("Falta TOKEN_REVISOR"); process.exit(2); }
  const res = await fetch(new URL("/api/resultado", destino), {
    method: "POST",
    headers: {"content-type": "application/json", "authorization": `Bearer ${token}`},
    body: JSON.stringify(rs),
  });
  console.log(`→ ${destino}: ${res.status} ${await res.text()}`);
  if (!res.ok) process.exit(1);
}
