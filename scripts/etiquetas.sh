#!/usr/bin/env bash
# Crea (o actualiza) las etiquetas que usan las plantillas y los avisos automáticos.
# Uso: GH_REPO=tocaltepetl/estado-gob scripts/etiquetas.sh
set -euo pipefail
cd "$(dirname "$0")/.."
e() { gh label create "$1" --color "$2" --description "$3" --force; }
e nuevo-sitio        2F6B4F "Propuesta de una página para revisar"
e reporte            B5532C "Reporte ciudadano de una falla"
e scraper-roto       8a7a3c "La revisión quedó obsoleta: el sitio cambió (aviso automático)"
e revision-bloqueada 8a7a3c "El sitio bloqueó la revisión automática (aviso automático)"
for id in $(node -e 'import("./config/sitios.json",{with:{type:"json"}}).then(m=>console.log(m.default.sitios.map(s=>s.id).join(" ")))'); do
  e "sitio:$id" 3F86A8 "Página: $id"
done
