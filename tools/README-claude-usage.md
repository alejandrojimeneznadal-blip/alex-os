# Uso de Claude Code en Alex OS (área Claude)

`claude-usage-sync.mjs` corre en **tu ordenador** (donde usas Claude Code), no en el servidor. Lee los historiales de
`~/.claude/projects`, agrega los tokens por día y modelo y los sube a tu cuenta. La app solo enseña lo que llega.

## Primera vez

1. En la app: Configuración → Conectar con otras IAs → nuevo token (copia el `osmcp_…`).
2. Guarda la config en `~/.config/alex-os/claude-usage.json`:

```json
{ "url": "https://tu-instancia", "token": "osmcp_…" }
```

3. Prueba: `node tools/claude-usage-sync.mjs --dry` (solo resumen) y luego sin `--dry` para subir.

## Automático en Mac (cada 10 min)

Crea `~/Library/LaunchAgents/com.alex-os.claude-usage.plist` cambiando las rutas:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.alex-os.claude-usage</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/RUTA/A/alex-os/tools/claude-usage-sync.mjs</string>
  </array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/TU_USUARIO/Library/Logs/alex-os-claude-usage.log</string>
  <key>StandardErrorPath</key><string>/Users/TU_USUARIO/Library/Logs/alex-os-claude-usage.log</string>
</dict></plist>
```

Activar: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.alex-os.claude-usage.plist`.
Parar: `launchctl bootout gui/$(id -u)/com.alex-os.claude-usage`.

## Qué mide

- Por respuesta de Claude: entrada, salida (con cuántos son pensamiento), caché escrita y caché leída.
- Coste ≈ tarifa pública de la API (tabla `PRECIOS` en el script). Con suscripción no pagas por token: es una
  referencia de cuánto valdría, no una factura.
- Los mensajes repetidos en el historial (una línea por bloque) se cuentan una sola vez.
