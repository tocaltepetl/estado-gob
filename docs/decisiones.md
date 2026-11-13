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

### Cómo revertir
Nada fuera de este repo depende de él.

---

## Etapa 2 — publicación y reportes ciudadanos (2026-11-13)

### Reportes ciudadanos anónimos
**Opciones:** solo GitHub Issues · **botón en la página + Issues para detalle (elegida)**.
Pedir una cuenta de GitHub deja fuera a casi todos. Mismo modelo que el conteo
de `camiones-basura-gdl`:
- `POST /api/reporte` con `{sitio, k}`: sitio del catálogo y tipo de falla de
  una lista cerrada (`TIPOS_REPORTE` en `src/reportes.js`). Sin texto libre,
  cookies, IP ni identificadores; la IP solo es la llave en memoria del
  límite de 10/min (binding `LIMITE`). Solo acepta `Origin` del propio sitio.
- Solo el dominio de producción (y `localhost`) guarda: las vistas previas de
  los PR comparten la base.
- `/api/estado` publica conteos de las últimas 2 h y 24 h **solo a partir de
  3 reportes** (y por tipo, también a partir de 3).
- La página evita reportes repetidos de la misma persona con `localStorage`
  (1 h por sitio). No es una barrera real; el umbral y el límite por IP sí.
- Los reportes **no cambian el estado** de un sitio: se muestran junto a él
  («N personas reportaron fallas en las últimas 2 h»). Sirven para ver fallas
  que la revisión automática no detecta (p. ej. tras iniciar sesión) y para
  desempatar cuando una revisión queda «en revisión».
- La plantilla «Reportar una falla» de GitHub queda para quien quiera dar detalles.

### Publicación
Igual que camiones: `release.yml` calcula la versión con los títulos de los PR
y espera aprobación en el ambiente `production`; `desplegar.yml` vuelve a
publicar una versión anterior; vistas previas por PR (`preview_urls`).
Dominio `estado.tocaltepetl.org` (Custom Domain del Worker).

### Revisor en México
`scripts/systemd/`: servicio y timer de usuario (cada 5 min con 30 s de
variación). Mientras el equipo esté apagado, solo queda el origen `cf`.

### Etiquetas
`scripts/etiquetas.sh` crea `nuevo-sitio`, `reporte`, `scraper-roto`,
`revision-bloqueada` y `sitio:<id>` por cada sitio del catálogo.

### Primeras horas en producción (2026-11-13)
- Desde Cloudflare, RPPC responde **520** y Catastro **522**: son códigos que
  genera la red de Cloudflare cuando no alcanza el origen. Se mapean al mismo
  tipo que da Node desde México (`cierre_sin_respuesta`, `tcp_timeout`).
- **SIAPA bloquea las IPs de Cloudflare** (403 en los tres sitios, incluido el
  portal que desde México funciona). La regla funcionó: se publica «revisión
  bloqueada», no «caído». Para SIAPA el revisor en México es indispensable.

### Canales de contacto por sitio (2026-11-13)
Investigación: ninguna de las dependencias monitoreadas publica un canal
específico para fallas de sus páginas (ni página de estado). SIAPA tiene
SIAPA Bot (WhatsApp, con folio), 073 y @siapagdl; Guadalajara, conmutador y
correo general; RPPC y el portal de Jalisco, nada encontrado.
- Campo `contacto` con tipos cerrados (`src/contacto.js`); el Worker arma el
  enlace y la página solo lo muestra. Valores inválidos no se publican (p. ej.
  `javascript:` o `http:`), y los tests validan el catálogo.
- `especifico` distingue un canal de soporte de la página de uno de atención
  general; si todos son generales, la página lo dice para no prometer de más.
- Se muestra en sitios caídos o degradados y dentro de «¿No te funciona?».
  Sin canal publicado, la página lo dice e invita a proponer uno.

### Issues automáticos y bloqueos conocidos (2026-11-13)
Con `GITHUB_TOKEN` (fine-grained, solo «Issues: write» sobre este repo) el
Worker abre issues `scraper-roto` y `revision-bloqueada`. El bloqueo de SIAPA a
Cloudflare ya es conocido: abriría un issue por sitio que no dice nada nuevo.
- Campo `bloquea` en el catálogo (p. ej. `["cf"]`): ese bloqueo desde ese
  origen no abre issue. Un bloqueo desde otro origen (p. ej. `mx`) o un
  rediseño sí avisan.
- En la página, en lugar de «posible geobloqueo», la tarjeta dice «revisado
  desde México».
