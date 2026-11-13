import {test} from "node:test";
import assert from "node:assert/strict";
import sitiosCfg from "../config/sitios.json" with {type: "json"};

test("cada sitio tiene estado y temas bien formados", () => {
  for (const s of sitiosCfg.sitios) {
    assert.ok(typeof s.estado === "string" && s.estado.trim(), `${s.id}: falta estado`);
    if (s.municipio != null) assert.ok(typeof s.municipio === "string" && s.municipio.trim(), `${s.id}: municipio vacío`);
    assert.ok(Array.isArray(s.temas) && s.temas.length, `${s.id}: falta temas`);
    for (const t of s.temas) assert.match(t, /^[a-zñ]+(-[a-zñ]+)*$/, `${s.id}: tema «${t}» debe ir en minúsculas, sin acentos ni espacios`);
    assert.equal(new Set(s.temas).size, s.temas.length, `${s.id}: temas repetidos`);
  }
});
