# Decisiones

Registro de decisiones del proyecto, por etapa. Etapas acordadas:
1. Local: revisiones HTTP, clasificación de fallas, historial y página.
2. Publicar en `estado.tocaltepetl.org` (Cloudflare) con las plantillas de issues; reportes ciudadanos anónimos.
3. Revisiones con navegador (Playwright): iframes, login parcial, capturas.
4. Datos abiertos documentados.

---

## Etapa 1 — local (2026-11-13)

### Mismo esquema que camiones-basura-gdl
**Opciones:** Upptime (GitHub Actions + Pages, historial comiteado) · Gatus en
un servidor · **Worker de Cloudflare + D1 (elegida)**.
Igual que en `camiones-basura-gdl`: `public/` estático, un Worker solo para
`/api/*` (`run_worker_first`) y D1. Comitear el historial cada 5 min ensucia el
repo y no deja agregar con SQL; Gatus exige un servidor que mantener.

### Origen de las revisiones
- **`cf`**: Cron Trigger del Worker cada 5 min. Gratis, sin infraestructura,
  pero puede salir con IP extranjera y su `fetch` da errores poco precisos
  (RPPC aparece como «Network connection lost.»).
- **`mx`**: `scripts/revisar.mjs` en una máquina en México (de inicio, la
  laptop; después un equipo fijo con un timer de systemd), que manda sus
  resultados a `POST /api/resultado` con `TOKEN_REVISOR`. Node da el código de
  error exacto (`UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`…).
- Estado público (`combinar` en `src/transiciones.js`): el más grave de los
  orígenes con datos de los últimos 30 min; a igual gravedad, el diagnóstico de
  `mx`. Si `cf` falla y `mx` funciona, se publica «operando» con la nota
  *posible geobloqueo*.

### Clasificación de fallas: sitio vs. scraper
Cada revisión guarda un **tipo** de falla normalizado, su **capa** (dns, red,
tls, http, intermediario, contenido, navegador, dependencia) y una
**atribución**:

| Atribución | Tipos | Qué se publica |
|---|---|---|
| `sitio` | red, TLS, 5xx, WAF/CDN sin servidor detrás, páginas de error o mantenimiento | «Caído»/«degradado» tras **2 revisiones seguidas** (antes: «verificando») |
| `nosotros` | HTTP 200 sin el marcador esperado, 404, otros 4xx | «En revisión»: probablemente cambió el sitio y nuestra revisión quedó obsoleta. Se abre un issue `scraper-roto` |
| `bloqueo` | 403/429, retos de WAF (captcha) | «Revisión bloqueada». Issue `revision-bloqueada` |

Regla de fondo: no acusar públicamente a una dependencia de estar caída
cuando solo cambiaron un `id` o nos bloquearon.

- **Firmas** (`config/firmas.json`): reconocen intermediarios y páginas de
  error por título, texto y encabezados. Ej.: el 503 de SIAPA es la página de
  Check Point CloudGuard WAF («invalid response from the host server») →
  `waf_upstream`, no un 5xx genérico.
- **Huella** (`src/huella.js`): hash de la estructura de la última respuesta
  sana (etiquetas con id, scripts externos sin `?v=`, destinos de formularios,
  iframes), sin texto. Si falta el marcador **y** cambió la huella →
  `rediseno_probable`; si la huella es igual → `revision_obsoleta`.
- **Transiciones** (tabla `transiciones`): además de caer/recuperarse, se
  registra cuando cambia el tipo de falla (`cambio_falla`, p. ej.
  `tcp_timeout` → `http_5xx`): suele indicar que alguien está trabajando en el
  sitio o que se movió la infraestructura.
- **Dependencias**: `siapa-recibo` incrusta en un iframe a `siapa-no-adeudo`;
  si la dependencia está caída, el contenedor se publica «degradado»
  (`dependencia_caida`) sin necesidad de navegador.

### Casos reales con los que se probó (12–13 nov 2026)
Desde una conexión residencial en Guadalajara:

| Sitio | Observado | Tipo |
|---|---|---|
| `rppc.jalisco.gob.mx` | Certificado válido (DigiCert, hasta abr 2027); el servidor cierra la conexión a los ~3 s sin responder (curl: `unexpected eof`; Node: `UND_ERR_SOCKET other side closed`) | `cierre_sin_respuesta` |
| `catastro.guadalajara.gob.mx` | DNS resuelve (177.240.17.43); 80 y 443 sin respuesta | `tcp_timeout` |
| `servicios.siapa.gob.mx/RegistroWeb` | 503 de CloudFront + Check Point WAF; el servidor de atrás no responde | `waf_upstream` |
| `www.siapa.gob.mx/reciboenlinea` | 200, pero su iframe es el sitio anterior | `dependencia_caida` |

Quedan como pruebas en `test/clasificar.test.mjs` (la página del WAF, sin las
fuentes incrustadas, en `test/fixtures/`).

### Carga sobre los sitios
Una petición cada 5 min por sitio y origen, sin reintentos inmediatos, con
User-Agent que identifica el proyecto y enlaza al repo. Sin pruebas de carga.
Las revisiones con navegador (etapa 3) irán a 15–30 min.

### Privacidad
Esta etapa no guarda nada de visitantes. Los reportes ciudadanos (etapa 2)
seguirán el modelo de camiones: listas cerradas, sin texto libre ni IP.

### Pendiente para la etapa 2
- `wrangler d1 create estado-gob` y poner el id en `wrangler.jsonc`.
- Secretos `TOKEN_REVISOR` y `GITHUB_TOKEN` (fine-grained, solo Issues: write).
- Dominio `estado.tocaltepetl.org`; workflows de publicación copiados de camiones.
- Crear las etiquetas `scraper-roto`, `revision-bloqueada`, `nuevo-sitio`,
  `reporte` y `sitio:<id>`.
- Reportes anónimos de fallas desde la página (sin cuenta de GitHub).

### Cómo revertir
Nada fuera de este repo depende de él.
