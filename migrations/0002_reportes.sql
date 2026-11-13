-- Reportes ciudadanos anónimos de fallas, hechos desde la página.
-- Sin IP, sin identificadores, sin texto libre. Ver src/reportes.js.
CREATE TABLE reportes (
  id    INTEGER PRIMARY KEY,
  ts    INTEGER NOT NULL,   -- ms desde 1970 (UTC)
  sitio TEXT    NOT NULL,   -- id de config/sitios.json
  k     INTEGER NOT NULL    -- tipo de falla, índice de TIPOS_REPORTE (src/reportes.js)
);
CREATE INDEX reportes_sitio_ts ON reportes (sitio, ts);
