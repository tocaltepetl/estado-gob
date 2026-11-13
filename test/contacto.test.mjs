import {test} from "node:test";
import assert from "node:assert/strict";
import {validarContacto, contactoPublico} from "../src/contacto.js";
import sitiosCfg from "../config/sitios.json" with {type: "json"};

test("el catálogo tiene contactos válidos", () => {
  for (const s of sitiosCfg.sitios) assert.deepEqual(validarContacto(s.contacto), [], s.id);
});

test("arma el enlace según la plataforma", () => {
  const [x, wa, tel, mail, fb, web] = contactoPublico([
    {tipo: "x", valor: "@siapagdl"},
    {tipo: "whatsapp", valor: "+52 33 5164 4440", etiqueta: "SIAPA Bot"},
    {tipo: "telefono", valor: "073"},
    {tipo: "correo", valor: "contacto@guadalajara.gob.mx"},
    {tipo: "facebook", valor: "siapagdl"},
    {tipo: "web", valor: "https://ejemplo.gob.mx/soporte", especifico: true},
  ]);
  assert.equal(x.href, "https://x.com/siapagdl");
  assert.equal(x.texto, "@siapagdl");
  assert.equal(wa.href, "https://wa.me/523351644440");
  assert.equal(wa.etiqueta, "SIAPA Bot");
  assert.equal(tel.href, "tel:073");
  assert.equal(mail.href, "mailto:contacto@guadalajara.gob.mx");
  assert.equal(fb.href, "https://www.facebook.com/siapagdl");
  assert.equal(web.especifico, true);
  assert.equal(x.especifico, false);
});

test("rechaza valores inválidos o campos desconocidos", () => {
  assert.equal(validarContacto([{tipo: "whatsapp", valor: "33 5164 4440"}]).length, 1);   // sin lada de país
  assert.equal(validarContacto([{tipo: "web", valor: "javascript:alert(1)"}]).length, 1);
  assert.equal(validarContacto([{tipo: "correo", valor: "no-es-correo"}]).length, 1);
  assert.equal(validarContacto([{tipo: "telegram", valor: "x"}]).length, 1);
  assert.equal(validarContacto([{tipo: "x", valor: "a", url: "y"}]).length, 1);
  assert.deepEqual(contactoPublico([{tipo: "web", valor: "http://inseguro"}]), []);    // inválidos no se publican
});
