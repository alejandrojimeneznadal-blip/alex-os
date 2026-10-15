#!/usr/bin/env bash
# Empaqueta Daily System para dárselo a otra persona: el código tal y como está en git (sin .env,
# sin node_modules y sin datos de nadie) más un CLAUDE.md para que su Claude Code sepa montarlo.
# Uso: scripts/empaquetar.sh [destino.zip]    (por defecto ~/Desktop/daily-system.zip)
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:-$HOME/Desktop/daily-system.zip}"
git diff --quiet HEAD -- || echo "Aviso: hay cambios sin commit; el paquete lleva lo último que está en git."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git archive --format=tar --prefix=daily-system/ HEAD | tar -x -C "$TMP"
cat > "$TMP/daily-system/CLAUDE.md" <<'EOF'
# Daily System

Panel personal de vida (Node + PostgreSQL) que se usa hablando con Claude por MCP. Esta carpeta es una instalación nueva y vacía: no trae datos de nadie.

- Si la persona quiere montarlo, o te dice «móntame el Daily System», sigue **MONTAR.md** de principio a fin: base de datos, `.env`, arrancar, su cuenta, conectarte a su panel por MCP y el onboarding.
- Lo importante es el onboarding: el panel tiene que salir de su vida, no ser una copia del de otra persona. El protocolo está en el apartado 5 de MONTAR.md. No configures nada sin su OK.
- Antes de cambiar o ampliar el código, lee el apartado 8 de MONTAR.md (cómo está hecho y qué reglas no romper). Prueba siempre contra una base de datos de pruebas, nunca con sus datos reales.
- Háblale claro y sin tecnicismos innecesarios: puede que no sea programador.
EOF
rm -f "$DEST"
(cd "$TMP" && zip -q -r -X "$DEST" daily-system)
echo "Paquete listo: $DEST ($(unzip -l "$DEST" | tail -1 | awk '{print $2}') ficheros)"
