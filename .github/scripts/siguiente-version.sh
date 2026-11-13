#!/usr/bin/env bash
# Calcula la siguiente versión a partir de los commits (Conventional Commits)
# desde el último tag vX.Y.Z y escribe las notas del Release.
#
# Uso: siguiente-version.sh <archivo-de-notas> [ref]   (ref por defecto: HEAD)
# Imprime la versión nueva (vX.Y.Z) o nada si no hay cambios que publicar.
#
#   feat           → 0.X.0 (o X.0.0 desde 1.0.0)
#   fix, perf, revert → 0.0.X
#   cambio con «!» o «BREAKING CHANGE» → 0.X.0 mientras sea 0.x; X.0.0 después
#   docs, ci, chore, refactor, style, test, build → no publican
set -euo pipefail

notas=${1:?falta el archivo de notas}
ref=${2:-HEAD}
repo_url="https://github.com/${GITHUB_REPOSITORY:-tocaltepetl/estado-gob}"

ultimo=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname --merged "$ref" | head -1)
if [ -n "$ultimo" ]; then rango="$ultimo..$ref"; else rango="$ref"; ultimo="v0.0.0"; fi
IFS=. read -r major minor patch <<<"${ultimo#v}"

re='^([a-z]+)(\([a-z0-9-]+\))?(!)?: (.+)$'
nivel=0  # 0 nada, 1 patch, 2 minor, 3 major
declare -A secciones=()
orden=(feat fix perf revert docs)
declare -A titulos=([feat]="Novedades" [fix]="Correcciones" [perf]="Rendimiento" [revert]="Reversiones" [docs]="Documentación")

while IFS=$'\x1f' read -r sha asunto cuerpo; do
  [[ "$asunto" =~ $re ]] || continue
  tipo=${BASH_REMATCH[1]}; rompe=${BASH_REMATCH[3]}; desc=${BASH_REMATCH[4]}
  [[ "$cuerpo" == *"BREAKING CHANGE"* ]] && rompe="!"
  n=0
  case $tipo in
    feat) n=2 ;;
    fix|perf|revert) n=1 ;;
  esac
  if [ -n "$rompe" ]; then
    if [ "$major" -eq 0 ]; then n=2; else n=3; fi
  fi
  (( n > nivel )) && nivel=$n
  if [ -n "${titulos[$tipo]:-}" ]; then
    # «(#12)» al final del título → enlace al PR.
    desc=$(sed -E "s|\(#([0-9]+)\)$|([#\1]($repo_url/pull/\1))|" <<<"$desc")
    secciones[$tipo]+="* ${rompe:+**incompatible:** }$desc ([${sha:0:7}]($repo_url/commit/$sha))"$'\n'
  fi
done < <(git log --no-merges --format='%H%x1f%s%x1f%b%x1e' "$rango" | tr '\n' ' ' | tr '\036' '\n' | sed 's/^ //')

case $nivel in
  0) exit 0 ;;
  1) patch=$((patch + 1)) ;;
  2) minor=$((minor + 1)); patch=0 ;;
  3) major=$((major + 1)); minor=0; patch=0 ;;
esac
version="v$major.$minor.$patch"

{
  for tipo in "${orden[@]}"; do
    [ -n "${secciones[$tipo]:-}" ] || continue
    printf '### %s\n\n%s\n' "${titulos[$tipo]}" "${secciones[$tipo]}"
  done
  [ "$ultimo" = "v0.0.0" ] || printf '**Cambios completos:** %s/compare/%s...%s\n' "$repo_url" "$ultimo" "$version"
} >"$notas"

echo "$version"
