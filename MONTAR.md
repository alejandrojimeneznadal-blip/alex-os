# Daily System · cómo montarlo y hacerlo tuyo

Daily System es un panel personal de vida. Cada día se puntúa de 0 a 100 con los hábitos que tú elijas, una curva enseña si a la larga vas hacia arriba o hacia abajo, y alrededor añades solo las partes que te sirvan: agenda, gym, sueño, nutrición, finanzas con tu banco conectado, proyectos, contenido o un «cerebro» para ideas y notas. Se usa hablando con Claude, que está conectado al panel y apunta lo que le cuentas, y también desde el móvil.

Llega **vacío**: sin datos de nadie. La idea no es que copies el panel de otra persona, sino que el onboarding con Claude lo monte alrededor de tu vida.

---

## La forma rápida: con Claude Code

1. Descomprime la carpeta `daily-system`.
2. Abre una terminal en ella y arranca Claude Code:
   ```bash
   cd daily-system
   claude
   ```
3. Dile: **«Lee MONTAR.md y móntame el Daily System»**.

Claude seguirá esta guía: lo arranca en tu ordenador, te crea la cuenta, lo conecta a sí mismo y te hace el onboarding. Si prefieres hacerlo a mano, sigue los pasos de abajo.

---

## 1. Lo que necesitas

- **Node.js 20 o superior**.
- **PostgreSQL**. Lo más fácil es Docker Desktop, que lo levanta con un comando.
- **Claude Code**, para el onboarding y para hablar con tu panel cada día.
- **Para el móvil y para conectar tu banco**: tenerlo en internet con HTTPS. En tu ordenador funciona todo salvo el banco, porque el banco solo devuelve a direcciones https.

---

## 2. Montarlo en tu ordenador

**Base de datos** (Docker, cualquier puerto libre):

```bash
docker run -d --name daily-system-db -p 5448:5432 \
  -e POSTGRES_USER=os -e POSTGRES_PASSWORD=os -e POSTGRES_DB=os \
  postgres:16-alpine
```

**Variables de entorno.** Copia la plantilla y rellénala:

```bash
cp .env.example .env
```

- `AUTH_USER` y `AUTH_PASS`: tu usuario y tu contraseña para entrar la primera vez.
- `SESSION_SECRET`: una cadena larga y aleatoria. Puedes generarla con `openssl rand -hex 32`. No la cambies después, porque también cifra la clave de tu banco.
- El resto se puede quedar como está.

**Arrancar:**

```bash
npm install
npm run dev
```

Abre `http://localhost:3200` y entra con tu usuario. La primera vez te recibe la **bienvenida**: para qué quieres el panel, qué partes vas a usar, tu nombre, unas frases sobre ti, tus hábitos y el tema. En dos minutos tienes el panel funcionando; el onboarding con Claude lo afina después.

---

## 3. Ponerlo en internet

Hace falta para usarlo desde el móvil y para conectar el banco. Cualquier plataforma que despliegue un `Dockerfile` vale: EasyPanel en un VPS, Railway, Render o Fly.

1. Sube esta carpeta a un **repositorio privado tuyo** en GitHub. El `.env` no se sube nunca.
2. En la plataforma, crea un **PostgreSQL** y un **servicio** a partir del repositorio. El `Dockerfile` ya está: Node 22, puerto 3200, `node server.js`.
3. Pon en el servicio las mismas variables del `.env`, con la `DATABASE_URL` del PostgreSQL de la plataforma.
4. Dale un dominio con HTTPS.

**En el móvil:** abre tu dirección en Safari o Chrome y usa «Añadir a la pantalla de inicio». Queda como una app y no vuelve a pedir contraseña durante meses. En el iPhone también hay widgets: Configuración → Widgets del móvil.

**Copias de seguridad:** todo vive en PostgreSQL. Un `pg_dump` de vez en cuando basta.

---

## 4. Conectar Claude a tu panel

Claude se conecta al panel por **MCP**: así puede leer cómo vas y apuntar lo que le cuentas.

1. En el panel: Configuración → **Conectar con otras IAs** → **Crear token**.
2. Copia el comando que aparece y pégalo en tu terminal. Tiene esta forma:
   ```bash
   claude mcp add --scope user --transport http mi-panel https://TU-DOMINIO/mcp --header "Authorization: Bearer osmcp_…"
   ```
3. Abre una sesión nueva de Claude Code y comprueba con `/mcp` que `mi-panel` sale conectado.

El token solo da acceso a tu cuenta y se puede revocar desde la misma pantalla. Con `--scope user` el panel está disponible en cualquier carpeta en la que abras Claude Code.

---

## 5. El onboarding: que el panel sea tuyo

Hay dos capas.

- **La bienvenida** del panel, la primera vez que entras: rápida y con formularios.
- **El onboarding con Claude**, que es el que de verdad lo adapta. Con Claude ya conectado, dile **«hazme el onboarding»**. Te preguntará qué necesitas y cómo es tu vida, lo analizará y te propondrá qué partes activar, qué hábitos medir y con qué peso. No cambia nada sin tu OK. Dura unos 20 minutos de conversación.

Puedes repetirlo cuando cambie tu vida: «replanteemos el panel».

### Protocolo del onboarding (para Claude)

Si eres Claude y la persona te pide el onboarding, o la cuenta está recién creada, sigue esto. Las instrucciones del servidor MCP traen la misma versión resumida.

1. **Qué necesita.** Empieza abierto: para qué quiere este panel, qué le gustaría que hiciera por él cada día, qué usa ahora para organizarse y qué le falla. Si al pasar por la bienvenida escribió para qué lo quiere, está en su memoria: parte de ahí.
2. **Su vida.** Una pregunta cada vez, en conversación, sin interrogatorio:
   - Trabajo o estudios, y su objetivo para los próximos 3-6 meses.
   - Su día tipo: a qué hora se levanta y se acuesta, mañanas, tardes y fines de semana.
   - Cuerpo: si entrena, qué y cuántos días, cuánto duerme, si cuida la comida o cuenta calorías.
   - Dinero: bancos y cuentas, gastos fijos, suscripciones o deudas, objetivo de ahorro.
   - Proyectos aparte y si crea contenido.
   - Cabeza: dónde apunta ideas y tareas, qué le cuesta (constancia, foco, el móvil…).
   - Su ancla: por qué hace todo esto, en una palabra o una frase.
3. **Análisis y propuesta**, en un mensaje corto:
   - Lo que has entendido, en 3-5 líneas.
   - Qué partes activar y por qué, y cuáles no y por qué. Mejor 3-5 que use de verdad que todas vacías.
   - De 4 a 7 hábitos medibles, conectados a sus objetivos, con pesos que sumen 100. Tipos: sí/no, horas con un umbral realista, o calorías si las cuenta.
   - Objetivos concretos: calorías, ahorro.
   - Lo que necesitaría y el panel no tiene. Eso se construye aparte (ver abajo); no lo des por hecho.
4. **Configurar, con su OK**, con las herramientas del MCP:
   - `set_value` en `config.modulos` con la lista entera de partes.
   - `set_value` en `config.senales` con los hábitos: ids en minúsculas, sin espacios ni tildes.
   - `config_nutricion.kcal_obj` y `config_finanzas.objetivo_ahorro`, si aplican.
   - Su rutina en `rutina_gym`, si entrena con una.
   - `add_item` en `memoria` con 5-10 hechos durables: objetivos, contexto, preferencias, su ancla.
   - `set_value` en `config.onboarding` con la fecha de hoy.
   - Si activa finanzas, guíale por el apartado 6 de esta guía.
5. **Cierre:** explícale el uso diario (apartado 7) en pocas frases.

Reglas: el panel sale de su vida, no copies el de nadie; no inventes datos; si algo no encaja en ninguna parte, apúntalo en `ideas` como mejora del panel.

**Construir lo que falte.** Si estás en Claude Code dentro de esta carpeta y la persona necesita algo que el panel no tiene, puedes construirlo en el código. Antes, cuéntale qué harías y espera su OK. Sigue el apartado 8 para hacerlo encajar con lo demás y pruébalo en una base de datos de pruebas, nunca con sus datos reales.

### Las partes que se pueden activar

| Parte | Para qué |
|---|---|
| Panel | Siempre está: hábitos del día, score de 0 a 100 y la curva de crecimiento. |
| Agenda | Calendario por mes o por semana con lo que toca cada día: publicaciones, recordatorios y entrenos hechos. |
| Instagram | Piezas de contenido de la idea a la publicación: tablero, edición con un editor que solo ve lo que le asignas, banco de ganchos y la «visión» de tu marca; en cada pieza, guion con notas de voz transcritas y reels de referencia. Con tu app de Meta (Instagram → Conectar Instagram), los números oficiales de cada reel: vistas, alcance, omisión, tiempo medio, guardados y compartidos. |
| Gym | Rutina semanal, las series de cada día frente a la última vez y el peso corporal. |
| Sueño | Horas por noche, medias, racha y rutinas de despertar. |
| Nutrición | Calorías de cada día frente a tu objetivo. |
| Finanzas | Cuentas con tu banco conectado o a mano, movimientos, suscripciones y ahorro. |
| Proyectos | Cada proyecto es una carpeta con subproyectos, tareas, archivos y notas. |
| Bandeja, Ideas y Notas | El «cerebro»: captura rápida sin clasificar, ideas y notas o decisiones. |

Se cambian en Configuración → **Partes del panel**, o pidiéndoselo a Claude. Lo que desactivas no se borra: vuelve tal cual si lo activas otra vez.

---

## 6. Finanzas: conectar tu banco

La conexión va por **Enable Banking** (open banking, normativa PSD2). El panel solo **lee** las cuentas que tú enlazas, nunca ve las credenciales de tu banco y es gratis para uso personal. Necesitas el panel en internet con HTTPS (apartado 3).

1. Crea una cuenta en [enablebanking.com](https://enablebanking.com) y entra en su panel de control.
2. **Registra una aplicación**:
   - Entorno: **Production**.
   - Redirect URL: `https://TU-DOMINIO/api/bancos/callback`. Tiene que ser exacta y con https; tu panel te la enseña en Configuración → Bancos.
   - Si te pide URLs de privacidad y términos, vale la de tu panel.
   - Genera la clave privada y **descarga el fichero .pem**. Guárdalo en un gestor de contraseñas: solo se descarga una vez.
3. **Activa la aplicación**: en la ficha de la app, «Activate by linking accounts», y enlaza tu propia cuenta bancaria. Así queda activa en modo restringido: solo lee las cuentas que tú enlaces.
4. **En tu panel**: Configuración → **Bancos**. Pega el Application ID y el contenido del .pem, pulsa Guardar y luego Probar. La clave se guarda cifrada en tu base de datos.
5. **Conecta el banco**: Finanzas → Cuentas → **Añadir cuenta** → elige tu banco → autoriza en su web. Vuelves al panel con tus cuentas y el historial de movimientos.
6. A partir de ahí se sincroniza solo una vez al día, y puedes forzarlo con el botón de sincronizar. El permiso dura como mucho 180 días: el panel avisa antes y se renueva en un clic con «Reautorizar».

Si no quieres conectar ningún banco, las cuentas también se pueden llevar a mano en la misma pantalla.

---

## 7. El uso diario

- **«Buenos días»** a Claude: te dice qué toca hoy y cómo va tu curva.
- **Cuéntale tu día** cuando quieras, como hablarías con alguien: él marca los hábitos y guarda lo demás.
- **«Cierro el día»**: registra el día y vacía la bandeja.
- **«Revisión»** los domingos: cómo ha ido la semana y qué cambiar.

Desde el móvil también puedes marcar los hábitos a mano en el Panel.

---

## 8. Cómo está hecho (para Claude Code)

**Stack.** Node 20+, Express y PostgreSQL (`pg`). Sin framework ni compilación: el front son páginas HTML con JavaScript normal.

```
server.js         Esquema, API, score, dashboard, servidor MCP y su manual (systemPromptFor, ONBOARDING, instruccionesMcp).
sync.js           Bancos: Enable Banking (y Airwallex/Mercury, heredados) con la clave cifrada en la BD.
public/
  index.html      Panel: hábitos, score, curva y «Hoy toca».
  areas.html      Todas las partes, navegando por hash (#gym, #finanzas/cuentas, #instagram/tablero…).
  config.html     Cuenta, partes del panel, tema, conexión con Claude, widgets y bancos.
  bienvenida.html Primera vez de cada cuenta.
  admin.html      Solo admin: otras cuentas (para dar acceso a alguien más).
  editor.html     Pantalla de las cuentas de editor (solo ven sus piezas asignadas).
  ui.js           Barra lateral, catálogo de partes (OS_MODULOS) y formularios internos (OSUI).
  theme.js        Temas (claro, crema, azul, negro) y estilos compartidos.
  icons.js        Iconos Tabler incrustados.
scripts/importar-vision.mjs   Opcional: importa un esquema «Creator Vision» en HTML a Instagram → Visión.
Dockerfile        Node 22, puerto 3200.
```

**Datos.** Cada cuenta tiene **un JSONB** en `user_state.data`. `POST /api/state` hace merge por clave de primer nivel y **sustituye la clave entera**: relee antes de escribir claves grandes. Claves principales:

- `config`: `senales` (los hábitos: `{ id, label, tipo: bool|horas|kcal, peso, umbral? }`), `modulos` (partes activas), `equilibrio` (score que deja la curva plana, 35 por defecto), `onboarding`.
- `days` (registro diario por fecha), `tareas`, `recordatorios`, `memoria` (memoria durable de Claude), `rutina_gym` y `entrenos`, `peso`, `contenido` y `tomas`, `bandeja`, `ideas`, `notas`, `finanzas`, `cuentas`, `suscripciones`, `config_nutricion`, `config_finanzas`, `widget`.
- Fuera del JSONB, en tablas propias: `users`, `mcp_tokens`, `ediciones` (trabajo de los editores), `vision` y `vision_versiones`, `app_files`.

**Reglas que no hay que romper:**

- **El score lo calcula el servidor**, nunca la IA.
- **Nunca pruebes escribiendo en los datos reales de la persona.** Usa otra base de datos de pruebas.
- **Ningún secreto en el código.** Las claves de bancos se pegan desde el panel y se guardan cifradas; el resto va en el `.env`.
- **Formularios, calendarios y desplegables propios** (`OSUI` en `ui.js`), nunca los del navegador.
- **Colores siempre con las variables del tema** (`var(--ink)`, `var(--surface)`…), nunca fijos: tiene que verse bien en claro y en oscuro.

**Añadir una parte nueva:**

1. Su vista en `areas.html`: una entrada en `TABS` y una función en `VIEWS`.
2. Su entrada en el catálogo `OS_MODULOS` de `ui.js`: id, grupo, nombre, enlace, icono y una frase de para qué sirve.
3. Si guarda datos: su clave por defecto en `seedDefaults` de `server.js`, en `KEYS_LEIBLES` y en los `enum` de `read_state` y `add_item`, y su descripción en el manual del MCP (`systemPromptFor`), para que Claude sepa leerla y escribirla.

**API principal** (sesión por cookie, o Basic auth `usuario:contraseña` para scripts):

| Ruta | Qué hace |
|---|---|
| `GET /api/me` | Quién eres, tu rol y tus partes activas. |
| `GET` y `POST /api/state` | Tu estado entero, y guardar claves de primer nivel. |
| `GET /api/dashboard` | Score, racha, curva y serie diaria. |
| `POST /api/day` | Guardar los hábitos de un día. |
| `POST /mcp` | Servidor MCP (Bearer con token de Configuración). |
| `/api/bancos/*`, `/api/integraciones` | Bancos. |
| `/api/vision*`, `/api/edicion*`, `/api/editores`, `/api/editor/*` | Visión y cuentas de editor de la parte Instagram. |
| `/api/admin/*` | Solo admin: cuentas y grupos. |

**Variables de entorno:**

| Variable | Obligatoria | Qué hace |
|---|---|---|
| `DATABASE_URL` | Sí | PostgreSQL. |
| `AUTH_PASS` | Sí | Contraseña de la primera cuenta (solo con la BD vacía). |
| `AUTH_USER` | No | Usuario de la primera cuenta. Por defecto `admin`. |
| `SESSION_SECRET` | Muy recomendada | Firma las sesiones y cifra la clave del banco. Fija para siempre. |
| `OWNER_NAME`, `OWNER_CONTEXT` | No | Nombre y contexto de la primera cuenta; luego se editan en Configuración. |
| `PANEL_TZ`, `DIA_CIERRA_A` | No | Zona horaria y hora a la que acaba el día del panel (por defecto `Europe/Madrid` y `5`: lo de antes de las 5:00 cuenta para el día anterior). |
| `PORT` | No | Por defecto 3200. |
| `YOUTUBE_API_KEY`, `APIFY_TOKEN` | No | Métricas automáticas de vídeos publicados. |
| `OPENAI_API_KEY` | No | Transcribe las notas de voz de las piezas (Claude no escucha audio). Sin ella se graban y se escuchan, pero sin texto. `TRANSCRIPCION_MODELO` cambia el modelo (por defecto `gpt-4o-transcribe`). |

**Cuentas.** La primera cuenta es **admin**. Desde `/admin.html` puede crear cuentas para otras personas en la misma instalación: cada una tiene sus propios datos, su bienvenida y su propia conexión con Claude.
