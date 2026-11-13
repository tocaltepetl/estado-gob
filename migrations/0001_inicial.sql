-- Historial de revisiones, estado por sitio y origen, y transiciones.
-- Ver src/transiciones.js y docs/decisiones.md («Clasificación de fallas»).

CREATE TABLE revisiones (
  id         INTEGER PRIMARY KEY,
  sitio      TEXT    NOT NULL,          -- id de config/sitios.json
  ts         INTEGER NOT NULL,          -- ms desde 1970 (UTC)
  origen     TEXT    NOT NULL,          -- 'cf' (cron de Cloudflare) | 'mx' (revisor en México)
  tipo       TEXT    NOT NULL,          -- 'ok' o tipo de falla (src/clasificar.js, TIPOS)
  capa       TEXT,                      -- dns | red | tls | http | intermediario | contenido | navegador | dependencia
  atribucion TEXT,                      -- sitio | nosotros | bloqueo | NULL si ok
  http       INTEGER,                   -- código HTTP, si hubo respuesta
  ms         INTEGER,                   -- tiempo total
  detalle    TEXT,                      -- código de error o firma reconocida (texto corto)
  firma      TEXT,                      -- id de config/firmas.json, si coincidió
  huella     TEXT,                      -- huella estructural, solo con respuesta 2xx
  titulo     TEXT
);
CREATE INDEX revisiones_sitio_ts ON revisiones (sitio, ts);
CREATE INDEX revisiones_ts ON revisiones (ts);

-- Último estado por sitio y origen (una fila por par).
CREATE TABLE estado (
  sitio        TEXT    NOT NULL,
  origen       TEXT    NOT NULL,
  ts           INTEGER NOT NULL,        -- última revisión
  tipo         TEXT,
  detalle      TEXT,
  publico      TEXT    NOT NULL,        -- operando | verificando | caido | degradado | en_revision | bloqueado
  desde        INTEGER NOT NULL,        -- desde cuándo está en `publico`
  consecutivas INTEGER NOT NULL DEFAULT 0,
  huella_ok    TEXT,                    -- huella de la última respuesta sana
  PRIMARY KEY (sitio, origen)
);

-- Cambios de estado o de tipo de falla, con su interpretación.
CREATE TABLE transiciones (
  id             INTEGER PRIMARY KEY,
  sitio          TEXT    NOT NULL,
  origen         TEXT    NOT NULL,
  ts             INTEGER NOT NULL,
  de             TEXT,
  a              TEXT    NOT NULL,
  interpretacion TEXT    NOT NULL,      -- falla_sitio | cambio_falla | posible_falla | recuperado | rediseno_probable | revision_obsoleta | bloqueo | cambio_estructura
  issue          INTEGER                -- número de issue abierto por el aviso, si lo hubo
);
CREATE INDEX transiciones_sitio_ts ON transiciones (sitio, ts);
