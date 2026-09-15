# Alex OS — guía para montar tu propia instancia

Este documento está pensado para pasárselo a una sesión de Claude Code que tenga este repo clonado. Explica qué es la app, cómo arranca, qué hay que personalizar para que sea de otra persona (no de Alex) y qué reglas de diseño no hay que romper.

---

## 1. Qué es

Panel personal de vida en una sola app, **multiusuario**: cada cuenta tiene sus propios datos, chat y memoria, y un administrador gestiona las cuentas desde `/admin.html`. Registras tu día hablando con un chat (Claude) y el chat estructura y guarda los datos. El panel calcula un **score diario 0-100 con matemática fija** a partir de "hábitos" (internamente `senales`) y dibuja una **equity curve acumulada**. Tiene áreas de Sueño, Gym, Nutrición, Proyectos, Contenido, Tareas y Finanzas (esta última oculta en el sidebar).

Principios de diseño acordados, no negociables sin hablarlo:

- **El chat es la entrada única.** Los módulos son vistas de lo que el chat guarda. Los formularios manuales son la excepción (chips clicables, checklist de hábitos).
- **El score lo calcula el servidor**, nunca la IA. Pesos por hábito, crédito parcial en los de horas (`min(valor/umbral, 1)`). Ver `computeScore` en `server.js`.
- **Un JSONB por usuario** (`user_state.data`) con merge superficial por claves top-level. Nunca se machaca lo que no envías.
- **Nunca testear escribiendo en el estado real del usuario.** Solo simulación en cliente o una BD de pruebas. Hubo una pérdida de datos por esto.

---

## 2. Stack y estructura

Sin framework, sin build step. Node 20+.

```
server.js        Express + pg + Anthropic SDK. Esquema, score, dashboard, chat con tools, API.
sync.js          Sync bancario (Airwallex / Mercury) portado de otra app. Opcional, Finanzas está oculta.
public/
  index.html     Panel: saludo, KPIs, checklist de hábitos, charts score/acumulado.
  chat.html      Chat con Claude (historial, imágenes adjuntas).
  areas.html     Todas las áreas (sueño, gym, nutrición, proyectos, contenido, tareas, finanzas). Navega por hash.
  config.html    Cuenta (nombre, contexto del asistente, contraseña), tema, integraciones bancarias, memoria.
  bienvenida.html Onboarding de cuentas nuevas (sin sidebar).
  admin.html     Solo admin: crear cuentas, ver una cuenta, reset de contraseña, quitar/devolver acceso.
  login.html     Login con cookie de sesión.
  ui.js          Sidebar compartido inyectado en todas las páginas + caché sessionStorage.
  theme.js       4 temas (claro / crema / azul / negro) + tokens CSS. Va al principio del body, pre-paint.
  icons.js       Iconos Tabler inlineados (window.OSIcons). Sin CDN.
  sw.js, manifest.json, icon-*.png   PWA instalable.
Dockerfile       node:22-alpine, expone 3200, `node server.js`.
```

Dependencias: `express`, `pg`, `@anthropic-ai/sdk`. Nada más.

---

## 3. Arranque local

**Postgres** (Docker, cualquier puerto libre):

```bash
docker run -d --name mi-os-db -p 5448:5432 \
  -e POSTGRES_USER=os -e POSTGRES_PASSWORD=os -e POSTGRES_DB=os \
  postgres:16-alpine
```

**`.env`** en la raíz (está en `.gitignore`, nunca se commitea):

```env
DATABASE_URL=postgres://os:os@localhost:5448/os
AUTH_USER=juanca
AUTH_PASS=una-contraseña-larga
ANTHROPIC_API_KEY=sk-ant-...
PORT=3200
SESSION_SECRET=otra-cadena-larga-aleatoria
OWNER_NAME=Juanca
OWNER_CONTEXT=Dos frases sobre ti: a qué te dedicas, qué hábitos quieres trackear, qué tono prefieres.
```

**Arrancar:**

```bash
npm install
node --env-file=.env server.js
```

Abre `http://localhost:3200`, entra con `AUTH_USER` / `AUTH_PASS`. El esquema se crea solo la primera vez (`initSchema`). Con la tabla de usuarios vacía, el primer arranque crea la cuenta **admin** a partir de `AUTH_USER` / `AUTH_PASS` / `OWNER_*`; a partir de ahí las cuentas viven en la BD y esas variables ya no se leen para autenticar.

### Variables de entorno

| Variable | Obligatoria | Qué hace |
|---|---|---|
| `DATABASE_URL` | Sí | Postgres. El server aborta si falta. |
| `AUTH_PASS` | Sí | Contraseña del primer admin (solo se usa en el bootstrap). También firma las sesiones si no hay `SESSION_SECRET`. |
| `AUTH_USER` | No (default `alex`) | Usuario del primer admin (solo bootstrap). |
| `SESSION_SECRET` | Recomendada | Firma de las cookies de sesión. Si falta se usa `AUTH_PASS`. |
| `ANTHROPIC_API_KEY` | No | Sin ella la app funciona pero el chat está apagado. |
| `MODEL` | No (default `claude-opus-5`) | Modelo del chat. |
| `EFFORT` | No (default `low`) | `output_config.effort` del chat. `low` para respuestas rápidas. |
| `PORT` | No (default `3200`) | Puerto. |
| `OWNER_NAME` | No (default: `AUTH_USER` capitalizado) | Nombre del primer admin (solo bootstrap; luego se edita en Configuración → Cuenta). |
| `OWNER_CONTEXT` | No | Contexto del primer admin para el asistente (solo bootstrap; luego se edita en Configuración → Cuenta). |
| `YOUTUBE_API_KEY` | No | Métricas automáticas de vídeos YT en Contenido. |
| `APIFY_TOKEN` | No | Métricas automáticas de reels de Instagram (actor `apify~instagram-scraper`). |

Las credenciales bancarias (Airwallex, Mercury) **no** van en env: se pegan desde `/config.html` y viven en `data.integraciones` (en claro, sin cifrar). Nunca salen por `/api/state` ni las ve el chat.

### Usuarios y roles

- **admin**: ve `/admin.html` (Sistema → Usuarios). Puede crear cuentas, poner contraseña nueva a cualquiera (recuperación), quitar o devolver el acceso, editar nombre/contexto/rol y **ver una cuenta** (cookie `os_as`: navega el panel con los datos de esa persona; banner inferior para volver). Un admin no puede bloquearse ni degradarse a sí mismo.
- **user**: solo su cuenta. Cambia su nombre, contexto y contraseña en Configuración → Cuenta.
- Contraseñas con `scrypt`; sesión = cookie firmada `id.exp.hmac` que incluye `pw_version`, así cambiar la contraseña cierra las demás sesiones. Basic auth (`usuario:contraseña`) sigue valiendo para scripts.
- No hay borrado de cuentas desde la UI, solo quitar acceso (los datos se conservan).
- **MCP (conectar la cuenta a otras IAs)**: `POST /mcp` habla JSON-RPC 2.0 (Streamable HTTP, sin estado ni SSE) y se autentica con `Authorization: Bearer <token>`; el token decide de qué usuario son los datos, así que una IA externa nunca ve otra cuenta. Tokens en `mcp_tokens` guardados como SHA-256 (el claro se enseña una sola vez), máximo 10 por cuenta, revocables al instante; revocar o desactivar la cuenta corta el acceso en la siguiente petición. Expone las mismas herramientas que el chat interno (`TOOLS`, misma ejecución en `runTool`) más `get_dashboard`. Se gestiona en Configuración → Conectar con otras IAs. Clientes: Claude Code (`claude mcp add --transport http …  --header`), Claude Desktop vía `npx mcp-remote`. Para claude.ai haría falta OAuth, que no está implementado.
- **Bienvenida (onboarding)**: `users.onboarded`. Una cuenta nueva (creada desde `/admin.html`) entra por `/bienvenida.html` la primera vez: nombre → contexto para el asistente → hábitos y puntos (activar, renombrar, añadir, «Repartir a 100», umbral de horas y objetivo kcal) → tema → resumen. Guarda con `/api/me/profile`, `/api/state` (`config.senales`, `config_nutricion`) y `/api/me/onboarded`. «Saltar por ahora» la marca hecha; se repite desde Configuración → Cuenta → Repetir bienvenida (o el admin con `onboarded:false` en `/api/admin/users/:id`). `ui.js` redirige si `onboarded === false`, nunca cuando un admin está viendo otra cuenta.
- **Grupos (workspaces)**: etiqueta opcional por cuenta (Amigos, una empresa…) para agrupar en `/admin.html` y, en el futuro, clasificaciones o defaults por grupo. No aíslan datos (ya van por usuario). Tabla `workspaces (id, nombre, created)` + `users.workspace_id`. Borrar un grupo deja a sus cuentas sin grupo.

---

## 4. Personalizar la instancia para otra persona

Casi todo se personaliza desde la propia app. Estado a 13 sep 2026:

### 4.1 El prompt del asistente

No hay que tocar código. El prompt se construye **por usuario** (`systemPromptFor(nombre, contexto)` en `server.js`) con el `display_name` y el `context` de su fila en `users`; ambos se editan en Configuración → Cuenta o desde `/admin.html`. El resto del prompt describe la estructura del estado y las reglas de cada tool, y es genérico.

Detalles del prompt que son opinables y puedes ajustar si no encajan:

- Categorías canónicas de finanzas (`Trabajo | Clientes | Contenido | Otros ingresos`, y las de gastos).
- Reto de contenido por defecto (100 días, 100 reels + 42 vídeos YT, 100 min/día).
- El hábito `nutricion` derivado de calorías (ver 4.2).

### 4.2 Hábitos y pesos por defecto

`server.js`, `DEFAULT_CONFIG` (~línea 34). Siete señales que suman 100: contenido 25, deep_work 20 (umbral 4h), entreno 15, sueno 15 (umbral 7h), despertar 10, nutricion 10 (derivada de kcal), no_movil 5. Tipos: `bool`, `horas`, `kcal`.

Se siembran solo la primera vez que la BD está vacía. Después la BD manda y se editan desde el panel (menú ⋯ de hábitos) o por chat. Cambia los defaults antes del primer arranque o edítalos luego desde la UI.

`nutricion` es **derivada**: el servidor la calcula como `days[fecha].kcal >= config_nutricion.kcal_obj`. Si la persona no quiere trackear calorías, quita esa señal y reparte su peso.

### 4.3 Nombre en la interfaz

Ya no hay nada hardcodeado: el sidebar, el saludo del panel y la barra móvil leen el nombre de `/api/me`. El login muestra solo "OS". Si quieres otra marca, busca `OS` en `ui.js` y `login.html`.


### 4.4 Defaults del reto de contenido

`public/areas.html` ~línea 1964 (`inicio: "2026-08-13"`, `meta_reels 100`, `meta_yt 42`) y la misma descripción en el `SYSTEM_PROMPT`. Son fallbacks cuando `config_contenido` está vacío en la BD; se editan también desde la UI (Contenido → Reto → ⋯).

### 4.5 Sesión

Ver «Usuarios y roles» en la sección 3.

---

## 5. Modelo de datos

Tablas, todas creadas por `initSchema` (esquema aditivo, sin migraciones):

- `users (id, username, password_hash, display_name, context, role, active, pw_version, created, last_login, workspace_id, onboarded)`.
- `workspaces (id, nombre, created)`: grupos de cuentas.
- `mcp_tokens (id, user_id, nombre, token_hash, prefijo, created, last_used)`: tokens de acceso MCP.
- `user_state (user_id, data JSONB, updated_at)`: **todo el estado de un usuario** en una fila.
- `chat_images (id, mime, data base64, created, user_id)`: imágenes adjuntas al chat, fuera del JSONB para no engordar cada escritura.
- `app_files (id, nombre, mime, data base64, size, created, user_id)`: archivos de proyectos y subproyectos.
- `app_state (id=1, data)`: legado de la versión mono-usuario. En el primer arranque multiusuario su contenido se copia al admin y la tabla se conserva como copia.

Claves top-level de `data` (las describe en detalle el `SYSTEM_PROMPT`):

| Clave | Contenido |
|---|---|
| `config` | `{ racha_min, senales[] }` |
| `days` | `{ "YYYY-MM-DD": { senales, resumen, kcal?, contenido_min?, sueno_horario? } }` |
| `journal` | apuntes por área `{ fecha, area, texto }` |
| `memoria` | memoria durable del asistente, se inyecta entera en cada mensaje |
| `tareas` | estados `pendiente / por_definir / en_ejecucion / en_espera / falta_revision / completado`, prioridad `urgente / alta / normal / baja` |
| `recordatorios` | periódicos dentro de una ventana, con `hechos{fecha:true}` |
| `proyectos` | proyecto = carpeta: `subs[]`, tareas por `proyecto`/`sub`, `archivos[]`, `notas` (pizarra HTML) |
| `contenido` | piezas reel/youtube con `url`, `views`, `likes`, `fecha_pub`, `fecha_plan` |
| `config_contenido` | `{ inicio, dias, meta_reels, meta_yt, min_dia }` |
| `rutina_gym`, `entrenos` | rutina semanal y sets levantados por día |
| `peso` | `[{ fecha, kg }]` |
| `config_nutricion` | `{ kcal_obj }` |
| `finanzas`, `cuentas`, `suscripciones`, `config_finanzas` | área Finanzas (oculta) |
| `integraciones` | secretos bancarios, nunca salen por la API de estado |
| `chats` | historial de conversaciones, no sale por `/api/state` |

`readData()` pasa siempre por `normalizar()` (deriva nutrición, `done` de subs, `hecha` de tareas, dedup de ids). Los campos derivados (`hecha`, `done`, `senales.nutricion`) **no se escriben a mano**: se cambia el estado que los origina.

---

## 6. API

Autenticación: cookie `os_session` (login del navegador) o Basic auth (`-u user:pass`) para scripts. Todas las rutas de datos operan sobre `req.user` (la cuenta vista), que es el propio usuario salvo que un admin esté viendo otra cuenta. Sin auth el servidor responde con redirect al login, no con 401. Tenlo en cuenta al verificar con curl.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/health`, `/diag` | salud y tamaño del estado |
| POST | `/api/login`, `/api/logout` | sesión |
| GET | `/api/me` | quién soy (`user`, `actor`, `viewing_as`, `is_admin`) |
| POST | `/api/me/profile`, `/api/me/password`, `/api/me/onboarded` | mi nombre/contexto, mi contraseña, bienvenida hecha |
| GET/POST/DELETE | `/api/me/mcp`, `/api/me/mcp/:id` | mis tokens MCP |
| POST | `/mcp` | servidor MCP (auth propia por Bearer, fuera del middleware de sesión) |
| GET/POST | `/api/admin/users`, `/api/admin/users/:id`, `/api/admin/users/:id/password`, `/api/admin/view-as` | solo admin |
| GET/POST/DELETE | `/api/admin/workspaces`, `/api/admin/workspaces/:id` | grupos (solo admin) |
| GET | `/api/state` | estado completo menos `integraciones` y `chats` |
| POST | `/api/state` | merge superficial de las claves que envíes |
| GET | `/api/dashboard` | serie de score/acumulado, racha, KPIs |
| POST | `/api/day` | guardar señales de un día (checklist del panel) |
| POST | `/api/contenido/metricas` | refrescar views/likes desde YouTube API / Apify |
| GET/POST | `/api/integraciones`, `/test`, `/sync` | bancos (Finanzas) |
| GET/DELETE | `/api/chats`, `/api/chats/:id` | historial de chats |
| POST | `/api/chat` | mensaje al asistente (tools: `read_state`, `log_day`, `append_journal`, `add_item`, `set_value`) |
| POST/GET/DELETE | `/api/archivos`, `/api/imagenes` | binarios |

`set_value` del chat tiene bloqueado el acceso a `integraciones`.

---

## 7. Deploy

Referencia: EasyPanel con un servicio **app** (este repo, Dockerfile, puerto 3200) y un servicio **postgres** en el mismo proyecto. Env vars del apartado 3 en el servicio app. Push a `main` con webhook o deploy manual.

Sirve cualquier host que ejecute un Dockerfile y te dé un Postgres (Railway, Fly, Coolify, VPS con Docker). No hay migraciones: el esquema es aditivo y se crea al arrancar. Una instancia sirve para varias personas: crea sus cuentas desde `/admin.html`.

Si se activa el sync de Airwallex, su whitelist de IPs debe incluir la IP del servidor.

---

## 8. Gotchas conocidos

- **Ids**: usar `uid()` (Date.now + sufijo aleatorio). El chat puede crear varios items en el mismo milisegundo y con `Date.now()` solo se duplicaban.
- **Anti-parpadeo**: `ui.js` y `theme.js` van al **principio** del body. Las páginas usan `<link rel="expect" href="#ready" blocking="render">` con un `<div id="ready">` tras el script principal, más View Transitions cross-document. Safari degrada a carga clásica. Si añades una página, replica ese patrón o parpadeará al navegar.
- **Repintado**: `load()` compara el JSON del payload y solo re-renderiza si cambió. El resize sí repinta siempre (charts dependen del ancho).
- **Charts**: interpolación monótona Fritsch–Carlson (`pathSuave`), no catmull-rom. El acumulado se hundía bajo cero por overshoot.
- **Grid de hábitos**: el modo normal y el modo "Orden" deben tener el mismo `column-gap` o las líneas se recolocan.
- **Tests con Playwright**: `extraHTTPHeaders` manda `Authorization` a todos los dominios y rompe el CORS de los embeds de YouTube/Instagram. Para probar embeds, usar la cookie `os_session` vía `ctx.addCookies`.
- **El historial de gym se indexa por NOMBRE de ejercicio.** `entrenos.<fecha>.sets` usa la cadena literal como clave y el tracker la casa con `rutina_gym[dia].ejercicios[].nombre`: una variante de mayúsculas o un acento distinto crea un historial paralelo. Por eso renombrar en el editor ofrece migrar las sesiones anteriores, y `validaEntrenos` en `server.js` rechaza escrituras de chat o MCP cuyo nombre no coincida exacto o cuyo `dia` no sea el id del día de esa fecha. La web escribe directa a `/api/state`, así que nunca te deja bloqueado.
- **`read_state` filtra por lista blanca** (`KEYS_LEIBLES`): el `enum` del `input_schema` no lo aplica nadie, y quien llama (el chat, o cualquier cliente MCP) puede pedir claves arbitrarias. Nunca devuelve `integraciones` ni `chats`. Si añades una clave al estado y quieres que sea legible, métela ahí.
- **Iconos nuevos**: bajar el SVG outline de Tabler y meterlo en `public/icons.js` con el mismo formato, clave = rol, no nombre del icono.
- **Finanzas oculta**: comentada en `SECTIONS` de `ui.js` y `TABS` de `areas.html`. Reactivar es descomentar; código y datos intactos.
- **Temas**: todo tokenizado vía `theme.js`. Un color nuevo se define ahí para las cuatro paletas, nunca hardcodeado en una página.

---

## 9. Qué NO incluye este repo

- Ningún secreto. `.env` está ignorado. Pide al dueño de la instancia sus propias claves.
- Los datos de Alex. Una instancia nueva arranca vacía con los defaults.
