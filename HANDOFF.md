# Alex OS — guía para montar tu propia instancia

Este documento está pensado para pasárselo a una sesión de Claude Code que tenga este repo clonado. Explica qué es la app, cómo arranca, qué hay que personalizar para que sea de otra persona (no de Alex) y qué reglas de diseño no hay que romper.

---

## 1. Qué es

Panel personal de vida en una sola app: registras tu día hablando con un chat (Claude) y el chat estructura y guarda los datos. El panel calcula un **score diario 0-100 con matemática fija** a partir de "hábitos" (internamente `senales`) y dibuja una **equity curve acumulada**. Tiene áreas de Sueño, Gym, Nutrición, Proyectos, Contenido, Tareas y Finanzas (esta última oculta en el sidebar).

Principios de diseño acordados, no negociables sin hablarlo:

- **El chat es la entrada única.** Los módulos son vistas de lo que el chat guarda. Los formularios manuales son la excepción (chips clicables, checklist de hábitos).
- **El score lo calcula el servidor**, nunca la IA. Pesos por hábito, crédito parcial en los de horas (`min(valor/umbral, 1)`). Ver `computeScore` en `server.js`.
- **Un solo JSONB** (`app_state.data`) con merge superficial por claves top-level. Nunca se machaca lo que no envías.
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
  config.html    Tema, integraciones bancarias, memoria del asistente.
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
OWNER_NAME=Juanca
OWNER_CONTEXT=Dos frases sobre ti: a qué te dedicas, qué hábitos quieres trackear, qué tono prefieres.
```

**Arrancar:**

```bash
npm install
node --env-file=.env server.js
```

Abre `http://localhost:3200`, entra con `AUTH_USER` / `AUTH_PASS`. El esquema se crea solo la primera vez (`initSchema`) y se siembran los defaults.

### Variables de entorno

| Variable | Obligatoria | Qué hace |
|---|---|---|
| `DATABASE_URL` | Sí | Postgres. El server aborta si falta. |
| `AUTH_PASS` | Sí | Contraseña única. El server aborta si falta. |
| `AUTH_USER` | No (default `alex`) | Usuario del login. **Cámbialo.** |
| `ANTHROPIC_API_KEY` | No | Sin ella la app funciona pero el chat está apagado. |
| `MODEL` | No (default `claude-opus-5`) | Modelo del chat. |
| `EFFORT` | No (default `low`) | `output_config.effort` del chat. `low` para respuestas rápidas. |
| `PORT` | No (default `3200`) | Puerto. |
| `OWNER_NAME` | No (default: `AUTH_USER` capitalizado) | Cómo te llama el asistente. |
| `OWNER_CONTEXT` | No | Una o dos frases sobre ti (trabajo, hábitos, objetivos, tono). Se inyectan al principio del prompt del asistente. Sin ella el asistente solo sabe tu nombre. |
| `YOUTUBE_API_KEY` | No | Métricas automáticas de vídeos YT en Contenido. |
| `APIFY_TOKEN` | No | Métricas automáticas de reels de Instagram (actor `apify~instagram-scraper`). |

Las credenciales bancarias (Airwallex, Mercury) **no** van en env: se pegan desde `/config.html` y viven en `data.integraciones` (en claro, sin cifrar). Nunca salen por `/api/state` ni las ve el chat.

La app es **mono-usuario**. Para otra persona se levanta otra instancia con su propia BD. No hay multi-login y se decidió no añadirlo.

---

## 4. Personalizar la instancia para otra persona

Todo lo que dice "Alex" está hardcodeado y hay que cambiarlo. Lista a 13 sep 2026:

### 4.1 El prompt del asistente

No hay que tocar código. El `SYSTEM_PROMPT` de `server.js` empieza con `Eres el asistente personal de ${N}` más `OWNER_CONTEXT` si existe; el resto describe la estructura del estado y las reglas de cada tool, y es genérico. Rellena `OWNER_NAME` y `OWNER_CONTEXT` en el `.env` y listo.

Detalles del prompt que son opinables y puedes ajustar si no encajan:

- Categorías canónicas de finanzas (`Trabajo | Clientes | Contenido | Otros ingresos`, y las de gastos).
- Reto de contenido por defecto (100 días, 100 reels + 42 vídeos YT, 100 min/día).
- El hábito `nutricion` derivado de calorías (ver 4.2).

### 4.2 Hábitos y pesos por defecto

`server.js`, `DEFAULT_CONFIG` (~línea 34). Siete señales que suman 100: contenido 25, deep_work 20 (umbral 4h), entreno 15, sueno 15 (umbral 7h), despertar 10, nutricion 10 (derivada de kcal), no_movil 5. Tipos: `bool`, `horas`, `kcal`.

Se siembran solo la primera vez que la BD está vacía. Después la BD manda y se editan desde el panel (menú ⋯ de hábitos) o por chat. Cambia los defaults antes del primer arranque o edítalos luego desde la UI.

`nutricion` es **derivada**: el servidor la calcula como `days[fecha].kcal >= config_nutricion.kcal_obj`. Si la persona no quiere trackear calorías, quita esa señal y reparte su peso.

### 4.3 Nombre en la interfaz

El nombre en la UI sí está hardcodeado (la app se llama "Alex OS"). Sustituir "Alex" en:

- `public/index.html` línea ~319 (`<h1 id="saludo">Hola, Alex</h1>`) y el pool de saludos por hora (~líneas 435-440).
- `public/login.html` líneas 7 y 61 (título y logo `Alex / OS`).
- `public/ui.js` líneas ~119 y ~151 (brand del sidebar `Alex / OS`, letra del chip `A`).
- Títulos `<title>` de `index.html`, `chat.html`, `config.html`, `areas.html`.
- `public/manifest.json` (`"name": "Alex OS"`, nombre de la PWA instalada).

Un `grep -rn "Alex" public/ server.js` da la lista exacta.

### 4.4 Defaults del reto de contenido

`public/areas.html` ~línea 1964 (`inicio: "2026-08-13"`, `meta_reels 100`, `meta_yt 42`) y la misma descripción en el `SYSTEM_PROMPT`. Son fallbacks cuando `config_contenido` está vacío en la BD; se editan también desde la UI (Contenido → Reto → ⋯).

### 4.5 Sesión

La cookie de sesión es un HMAC de `AUTH_PASS` sobre `"alexos-session:" + AUTH_USER`. Cambiar la contraseña invalida las sesiones. No hay que tocar código.

---

## 5. Modelo de datos

Tres tablas, todas creadas por `initSchema`:

- `app_state (id=1, data JSONB, updated_at)`: **todo el estado** en una fila.
- `chat_images (id, mime, data base64, created)`: imágenes adjuntas al chat, fuera del JSONB para no engordar cada escritura.
- `app_files (id, nombre, mime, data base64, size, created)`: archivos de proyectos y subproyectos.

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

Autenticación: cookie `os_session` (login del navegador) o Basic auth (`-u user:pass`) para scripts. Sin auth el servidor responde con redirect al login, no con 401. Tenlo en cuenta al verificar con curl.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/health`, `/diag` | salud y tamaño del estado |
| POST | `/api/login`, `/api/logout` | sesión |
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

Sirve cualquier host que ejecute un Dockerfile y te dé un Postgres (Railway, Fly, Coolify, VPS con Docker). No hay migraciones: el esquema es aditivo y se crea al arrancar.

Si se activa el sync de Airwallex, su whitelist de IPs debe incluir la IP del servidor.

---

## 8. Gotchas conocidos

- **Ids**: usar `uid()` (Date.now + sufijo aleatorio). El chat puede crear varios items en el mismo milisegundo y con `Date.now()` solo se duplicaban.
- **Anti-parpadeo**: `ui.js` y `theme.js` van al **principio** del body. Las páginas usan `<link rel="expect" href="#ready" blocking="render">` con un `<div id="ready">` tras el script principal, más View Transitions cross-document. Safari degrada a carga clásica. Si añades una página, replica ese patrón o parpadeará al navegar.
- **Repintado**: `load()` compara el JSON del payload y solo re-renderiza si cambió. El resize sí repinta siempre (charts dependen del ancho).
- **Charts**: interpolación monótona Fritsch–Carlson (`pathSuave`), no catmull-rom. El acumulado se hundía bajo cero por overshoot.
- **Grid de hábitos**: el modo normal y el modo "Orden" deben tener el mismo `column-gap` o las líneas se recolocan.
- **Tests con Playwright**: `extraHTTPHeaders` manda `Authorization` a todos los dominios y rompe el CORS de los embeds de YouTube/Instagram. Para probar embeds, usar la cookie `os_session` vía `ctx.addCookies`.
- **Iconos nuevos**: bajar el SVG outline de Tabler y meterlo en `public/icons.js` con el mismo formato, clave = rol, no nombre del icono.
- **Finanzas oculta**: comentada en `SECTIONS` de `ui.js` y `TABS` de `areas.html`. Reactivar es descomentar; código y datos intactos.
- **Temas**: todo tokenizado vía `theme.js`. Un color nuevo se define ahí para las cuatro paletas, nunca hardcodeado en una página.

---

## 9. Qué NO incluye este repo

- Ningún secreto. `.env` está ignorado. Pide al dueño de la instancia sus propias claves.
- Los datos de Alex. Una instancia nueva arranca vacía con los defaults.
