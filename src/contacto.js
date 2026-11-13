// Canales de contacto oficiales de cada sitio («¿A quién avisar?»).
// En config/sitios.json, cada sitio puede tener `contacto`: una lista de
//   {tipo, valor, etiqueta?, nota?, especifico?}
// - tipo: una de TIPOS_CONTACTO (plataforma, teléfono, correo, web…).
// - valor: usuario (sin @), número, correo o URL, según el tipo.
// - etiqueta: nombre que se muestra (p. ej. «SIAPA Bot»); si falta, se arma.
// - nota: aclaración corta (p. ej. «para reportes de agua»).
// - especifico: true solo si el canal atiende fallas de la página/trámite en
//   línea. La mayoría de los canales oficiales son de atención general.
// El Worker arma el enlace (`href`) aquí; la página solo lo muestra.

const digitos = (v) => String(v).replace(/[^\d+]/g, "");
const usuario = (v) => String(v).trim().replace(/^@/, "");

export const TIPOS_CONTACTO = {
  x:         {nombre: "X (Twitter)", href: (v) => `https://x.com/${encodeURIComponent(usuario(v))}`, texto: (v) => "@" + usuario(v), valido: (v) => /^@?\w{1,15}$/.test(v)},
  facebook:  {nombre: "Facebook",    href: (v) => `https://www.facebook.com/${encodeURIComponent(usuario(v))}`, texto: (v) => usuario(v), valido: (v) => /^[\w.-]{1,80}$/.test(usuario(v))},
  instagram: {nombre: "Instagram",   href: (v) => `https://www.instagram.com/${encodeURIComponent(usuario(v))}`, texto: (v) => "@" + usuario(v), valido: (v) => /^@?[\w.]{1,30}$/.test(v)},
  tiktok:    {nombre: "TikTok",      href: (v) => `https://www.tiktok.com/@${encodeURIComponent(usuario(v))}`, texto: (v) => "@" + usuario(v), valido: (v) => /^@?[\w.]{1,30}$/.test(v)},
  youtube:   {nombre: "YouTube",     href: (v) => `https://www.youtube.com/${encodeURIComponent(usuario(v))}`, texto: (v) => usuario(v), valido: (v) => /^@?[\w.-]{1,100}$/.test(v)},
  // WhatsApp: número con lada de país (+52 …); wa.me solo acepta dígitos.
  whatsapp:  {nombre: "WhatsApp",    href: (v) => `https://wa.me/${digitos(v).replace(/^\+/, "")}`, texto: (v) => v, valido: (v) => /^\+\d{10,15}$/.test(digitos(v))},
  telefono:  {nombre: "Teléfono",    href: (v) => `tel:${digitos(v)}`, texto: (v) => v, valido: (v) => /^\+?\d{3,15}$/.test(digitos(v))},
  correo:    {nombre: "Correo",      href: (v) => `mailto:${v}`, texto: (v) => v, valido: (v) => /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(v)},
  web:       {nombre: "Sitio web",   href: (v) => v, texto: (v) => v.replace(/^https?:\/\//, "").replace(/\/$/, ""), valido: (v) => /^https:\/\/[^\s"<>]+$/.test(v)},
  // Cualquier otra plataforma: valor = URL https.
  otro:      {nombre: "Otro",        href: (v) => v, texto: (v) => v.replace(/^https?:\/\//, ""), valido: (v) => /^https:\/\/[^\s"<>]+$/.test(v)},
};

// Devuelve la lista de errores de un `contacto` (vacía si es válido).
export function validarContacto(lista) {
  if (lista === undefined) return [];
  if (!Array.isArray(lista)) return ["contacto debe ser una lista"];
  const errores = [];
  lista.forEach((c, i) => {
    const t = TIPOS_CONTACTO[c?.tipo];
    if (!t) return errores.push(`[${i}] tipo desconocido: ${c?.tipo}`);
    if (typeof c.valor !== "string" || !t.valido(c.valor.trim())) errores.push(`[${i}] valor inválido para ${c.tipo}: ${c.valor}`);
    for (const k of ["etiqueta", "nota"]) if (c[k] !== undefined && (typeof c[k] !== "string" || c[k].length > 80)) errores.push(`[${i}] ${k} debe ser texto ≤ 80`);
    if (c.especifico !== undefined && typeof c.especifico !== "boolean") errores.push(`[${i}] especifico debe ser true/false`);
    const extra = Object.keys(c).filter((k) => !["tipo", "valor", "etiqueta", "nota", "especifico"].includes(k));
    if (extra.length) errores.push(`[${i}] campos desconocidos: ${extra.join(", ")}`);
  });
  return errores;
}

// Forma pública para /api/estado: agrega href, texto y nombre de la plataforma.
export function contactoPublico(lista = []) {
  return lista.filter((c) => TIPOS_CONTACTO[c.tipo]?.valido(c.valor.trim())).map((c) => {
    const t = TIPOS_CONTACTO[c.tipo];
    const v = c.valor.trim();
    return {
      tipo: c.tipo, plataforma: t.nombre, href: t.href(v), texto: t.texto(v),
      etiqueta: c.etiqueta || null, nota: c.nota || null, especifico: Boolean(c.especifico),
    };
  });
}
