# Estado de páginas de gobierno

> **English:** unofficial status page for Mexican government websites (starting
> with Jalisco). It tells apart "the site is down" from "our check is outdated".
> Contributions welcome — issues and PRs in English are fine.

Página ciudadana, **no oficial**, con el estado actual e histórico de páginas y
trámites en línea de gobierno en Jalisco. Revisa cada página cada 5 minutos.

## Qué muestra
- Estado actual de cada página: operando, degradado, caído, o «en revisión»
  cuando la página cambió y nuestra revisión debe actualizarse.
- **Por qué falla**, en lenguaje claro: «el servidor no responde», «el firewall
  responde pero el servidor de atrás no», «carga, pero el formulario incrustado
  está caído»…
- Barras de los últimos 90 días, disponibilidad y el historial de cambios.

## Cómo funciona
- `src/clasificar.js`: convierte lo que pasó (error de red o respuesta HTTP)
  en un tipo de falla normalizado, con su capa y a quién se atribuye: al sitio,
  a nuestra revisión, o a un bloqueo. Usa las firmas de `config/firmas.json`.
- `src/huella.js`: huella de la estructura de la página sana, para detectar
  rediseños.
- `src/transiciones.js`: decide qué se publica. Una falla del sitio se publica
  tras 2 revisiones seguidas; un cambio de contenido abre un issue en lugar de
  marcar «caído».
- `src/worker.js`: Cloudflare Worker con cron (origen `cf`) y API; historial en D1.
- `scripts/revisar.mjs`: las mismas revisiones desde México (origen `mx`),
  para distinguir caídas de geobloqueos.

Detalles y razones: [`docs/decisiones.md`](docs/decisiones.md).

## Uso local
Requiere Node 22.

```sh
npm test                                   # pruebas
npm run revisar                            # revisa los sitios y lo imprime
printf 'DEV=1\nTOKEN_REVISOR=local\n' > .dev.vars
npm run migrar:local
npm run dev -- --port 8791                 # http://localhost:8791
curl "localhost:8791/__scheduled?cron=*/5+*+*+*+*"     # dispara el cron
TOKEN_REVISOR=local node scripts/revisar.mjs --enviar http://localhost:8791
```

## API
- `GET /api/estado`: estado de cada sitio, motivo y barras diarias (90 días).
- `GET /api/historial?sitio=ID`: últimas revisiones y transiciones.

## Agregar una página
Abre un issue con la plantilla **Nuevo sitio**, o un PR que edite
`config/sitios.json`. Si la página necesita iniciar sesión, se revisa solo la
parte pública y se marca como «monitoreo parcial».

## Licencia
[MIT](LICENSE).
