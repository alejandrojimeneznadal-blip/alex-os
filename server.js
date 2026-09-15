import express from "express";
import pg from "pg";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { providerStatus, testProviders, runSync } from "./sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  DATABASE_URL,
  AUTH_USER = "alex",
  AUTH_PASS,
  ANTHROPIC_API_KEY,
  YOUTUBE_API_KEY,
  APIFY_TOKEN,
  MODEL = "claude-opus-5",
  PORT = 3200,
  OWNER_NAME,
  OWNER_CONTEXT = "",
  SESSION_SECRET,
} = process.env;

/* AUTH_USER / AUTH_PASS / OWNER_* solo sirven para crear el PRIMER usuario (admin) cuando la
   tabla users está vacía. Después las cuentas viven en la BD y se gestionan desde /admin.html. */
const SECRET = SESSION_SECRET || AUTH_PASS;
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL no está definido"); process.exit(1); }
if (!AUTH_PASS) { console.error("ERROR: AUTH_PASS no está definido"); process.exit(1); }

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

/* ======================================================================
   DEFAULTS — se siembran en la BD la primera vez; después la BD manda
   y la IA puede modificarlos vía chat (pesos, umbrales, señales nuevas).
   ====================================================================== */
const DEFAULT_CONFIG = {
  racha_min: 50, // score mínimo para que un día cuente en la racha
  senales: [
    { id: "contenido", label: "Contenido", tipo: "bool", peso: 25, hint: "Grabó, editó o publicó contenido" },
    { id: "deep_work", label: "Deep work", tipo: "horas", peso: 20, umbral: 4, hint: "Horas de trabajo enfocado en el proyecto prioritario" },
    { id: "entreno", label: "Entreno", tipo: "bool", peso: 15 },
    { id: "sueno", label: "Sueño", tipo: "horas", peso: 15, umbral: 7 },
    { id: "despertar", label: "Despertar 6:00", tipo: "bool", peso: 10 },
    { id: "nutricion", label: "Nutrición", tipo: "kcal", peso: 10, hint: "Calorías del día ≥ objetivo (no se marca a mano: se deriva de las kcal registradas)" },
    { id: "no_movil", label: "Sin móvil en cama", tipo: "bool", peso: 5 },
  ],
};

const AREAS = ["general", "sueno", "gym", "nutricion", "proyectos", "contenido", "finanzas"];

/* ======================================================================
   DB
   ====================================================================== */
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INT PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    INSERT INTO app_state (id, data) VALUES (1, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  `);
  // imágenes adjuntas del chat: fuera del JSONB del estado para no engordar cada escritura
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_images (
      id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      data TEXT NOT NULL,
      created BIGINT
    );
  `);
  // archivos de subproyectos (y lo que venga): mismos motivos que chat_images
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_files (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      mime TEXT NOT NULL,
      data TEXT NOT NULL,
      size BIGINT,
      created BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      context TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      active BOOLEAN NOT NULL DEFAULT true,
      pw_version INT NOT NULL DEFAULT 1,
      created BIGINT,
      last_login BIGINT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      nombre TEXT,
      token_hash TEXT UNIQUE NOT NULL,
      prefijo TEXT,
      created BIGINT,
      last_used BIGINT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      nombre TEXT UNIQUE NOT NULL,
      created BIGINT
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace_id TEXT;`);
  /* onboarding: las cuentas nuevas pasan por /bienvenida.html la primera vez. Al añadir la columna,
     los admins ya existentes se dan por configurados; el resto (cuentas creadas antes de esta versión) lo verá una vez. */
  const colOnb = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'onboarded'");
  if (!colOnb.rows.length) {
    await pool.query(`ALTER TABLE users ADD COLUMN onboarded BOOLEAN NOT NULL DEFAULT false;`);
    await pool.query(`UPDATE users SET onboarded = true WHERE role = 'admin';`);
  }
  await pool.query(`ALTER TABLE chat_images ADD COLUMN IF NOT EXISTS user_id TEXT;`);
  await pool.query(`ALTER TABLE app_files ADD COLUMN IF NOT EXISTS user_id TEXT;`);

  /* Bootstrap: sin usuarios → el admin sale de AUTH_USER/AUTH_PASS y hereda el estado
     mono-usuario antiguo (app_state id=1), que se conserva intacto como copia. */
  const nUsers = Number((await pool.query("SELECT COUNT(*)::int AS n FROM users")).rows[0].n);
  if (nUsers === 0) {
    const adminId = uid("u");
    await pool.query(
      "INSERT INTO users (id, username, password_hash, display_name, context, role, created, onboarded) VALUES ($1, $2, $3, $4, $5, 'admin', $6, true)",
      [adminId, AUTH_USER.toLowerCase(), await hashPassword(AUTH_PASS), OWNER_NAME || capital(AUTH_USER), OWNER_CONTEXT || null, Date.now()]
    );
    const legacy = await pool.query("SELECT data FROM app_state WHERE id = 1");
    const legacyData = legacy.rows[0]?.data || {};
    await pool.query("INSERT INTO user_state (user_id, data) VALUES ($1, $2::jsonb)", [adminId, JSON.stringify(legacyData)]);
    await pool.query("UPDATE chat_images SET user_id = $1 WHERE user_id IS NULL", [adminId]);
    await pool.query("UPDATE app_files SET user_id = $1 WHERE user_id IS NULL", [adminId]);
    console.log(`Bootstrap: admin "${AUTH_USER}" creado${Object.keys(legacyData).length ? " y estado anterior migrado" : ""}`);
  }
}

/* Defaults por usuario: se siembran las claves que falten (usuario nuevo o clave nueva en una versión). */
function seedDefaults(data) {
  const seeds = {
    config: DEFAULT_CONFIG,
    days: {},        // "YYYY-MM-DD" → { senales: {id: valor}, resumen }
    journal: [],     // { fecha, area, texto }
    tareas: [],      // { id, titulo, estado: pendiente|en_espera|en_ejecucion|terminada, inicio?, fecha?, proyecto?, sub?, notas?, hecha (derivada), creada, hecha_el? }
    recordatorios: [], // { id, titulo, desde, hasta?, frecuencia: diario|laborables|cada_2|cada_3|cada_7|dias, dias?: ["lun",...], proyecto?, notas?, hechos: {fecha: true} }
    memoria: [],     // { id, texto, fecha } — memoria durable del chat, inyectada en su system prompt
    proyectos: [],   // { id, nombre, estado: activo|pausado|cerrado, nota, updated }
    contenido: [],   // { fecha, tipo, titulo, estado: idea|grabado|editando|publicado, fecha_pub?, url?, views?, likes? }
    finanzas: [],    // { fecha, concepto, importe, tipo: ingreso|gasto, categoria?, cuenta? }
    cuentas: [],     // { id, nombre, tipo: banco|efectivo|ahorro|otro, saldo, updated }
    suscripciones: [], // { id, nombre, importe, periodicidad: mensual|anual, dia_cobro?, tipo: sub|deuda, cuotas_restantes?, fin?, activa }
    config_finanzas: { objetivo_ahorro: 10800 },
    config_nutricion: { kcal_obj: 2500 },
    integraciones: {}, // { airwallex: {client_id, api_key, base}, mercury: {token}, last_sync, last_result } — credenciales en BD, se configuran desde /config.html
    peso: [],        // { fecha, kg }
    chats: {},
  };
  let changed = false;
  for (const [key, value] of Object.entries(seeds)) {
    if (data[key] === undefined) { data[key] = value; changed = true; }
  }
  // migración: el hábito nutrición dejó de ser un check manual y pasa a derivarse de las kcal
  const sNut = (data.config?.senales || []).find((x) => x.id === "nutricion");
  if (sNut && sNut.tipo !== "kcal") {
    sNut.tipo = "kcal";
    sNut.hint = "Calorías del día ≥ objetivo (no se marca a mano: se deriva de las kcal registradas)";
    delete sNut.umbral;
    changed = true;
    console.log("Migrado hábito nutricion → tipo kcal");
  }
  return changed;
}

/* El hábito `nutricion` NO se marca a mano: se deriva de days.<fecha>.kcal.
   Cumplido = kcal registradas >= config_nutricion.kcal_obj. Sin kcal = día sin registrar.
   Se aplica al leer y al escribir, así que es la única verdad posible. */
function derivarNutricion(data) {
  const obj = Number(data?.config_nutricion?.kcal_obj) || 3500;
  const days = data?.days;
  if (!days || typeof days !== "object") return data;
  for (const f of Object.keys(days)) {
    const d = days[f];
    if (!d || typeof d !== "object") continue;
    const k = Number(d.kcal);
    if (Number.isFinite(k) && k > 0) {
      if (!d.senales || typeof d.senales !== "object") d.senales = {};
      d.senales.nutricion = k >= obj;
    } else if (d.senales && typeof d.senales === "object") {
      delete d.senales.nutricion;
    }
  }
  return data;
}

/* los subproyectos siempre llevan id y estado; done se deriva del estado (compat con lo viejo) */
const ESTADOS_SUB = ["en_curso", "en_cola", "pausado", "hecho"];
let subSeq = 0;
function normalizarSubs(data) {
  for (const p of data?.proyectos || []) {
    for (const s of p.subs || []) {
      if (!s || typeof s !== "object") continue;
      if (!s.id) s.id = "s" + Date.now().toString(36) + (subSeq++).toString(36);
      if (!ESTADOS_SUB.includes(s.estado)) s.estado = s.done ? "hecho" : "en_curso";
      s.done = s.estado === "hecho";
    }
  }
  return data;
}

/* id único de verdad: Date.now() solo repite ids cuando el chat crea varios elementos en el mismo ms */
function uid(prefijo) {
  return prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* las tareas llevan estado (sistema de growing-projects) y prioridad; hecha se deriva */
const ESTADOS_TAREA = ["pendiente", "por_definir", "en_ejecucion", "en_espera", "falta_revision", "completado"];
const PRIORIDADES_TAREA = ["urgente", "alta", "normal", "baja"];
function normalizarTareas(data) {
  // repara ids duplicados o ausentes (tareas/recordatorios/memoria no son referenciados por nadie: seguro)
  for (const [lista, pref] of [["tareas", "t"], ["recordatorios", "r"], ["memoria", "m"]]) {
    const vistos = new Set();
    for (const x of data?.[lista] || []) {
      if (!x || typeof x !== "object") continue;
      if (!x.id || vistos.has(x.id)) x.id = uid(pref);
      vistos.add(x.id);
    }
  }
  for (const t of data?.tareas || []) {
    if (!t || typeof t !== "object") continue;
    if (t.estado === "terminada") t.estado = "completado"; // migración del sistema anterior
    if (!ESTADOS_TAREA.includes(t.estado)) t.estado = t.hecha ? "completado" : "pendiente";
    if (!PRIORIDADES_TAREA.includes(t.prioridad)) t.prioridad = "normal";
    t.hecha = t.estado === "completado";
  }
  return data;
}

function normalizar(data) {
  return normalizarTareas(normalizarSubs(derivarNutricion(data)));
}

async function readData(userId) {
  if (!userId) throw new Error("readData sin usuario");
  const { rows } = await pool.query("SELECT data FROM user_state WHERE user_id = $1", [userId]);
  const data = rows[0]?.data ?? {};
  const seeded = seedDefaults(data);
  const out = normalizar(data);
  if (seeded || !rows.length) await writeData(userId, out);
  return out;
}

async function writeData(userId, data) {
  if (!userId) throw new Error("writeData sin usuario");
  const payload = JSON.stringify(normalizar(data));
  await pool.query(
    "INSERT INTO user_state (user_id, data) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()",
    [userId, payload]
  );
  return payload.length;
}

/* ======================================================================
   USUARIOS — contraseñas con scrypt (sin dependencias), sesiones firmadas
   ====================================================================== */
function hashPassword(pass) {
  return new Promise((ok, ko) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(String(pass), salt, 64, (e, k) => (e ? ko(e) : ok(`scrypt$${salt}$${k.toString("hex")}`)));
  });
}
function verifyPassword(pass, stored) {
  return new Promise((ok) => {
    const [alg, salt, hex] = String(stored || "").split("$");
    if (alg !== "scrypt" || !salt || !hex) return ok(false);
    crypto.scrypt(String(pass), salt, 64, (e, k) => {
      if (e) return ok(false);
      const a = Buffer.from(hex, "hex");
      ok(a.length === k.length && crypto.timingSafeEqual(a, k));
    });
  });
}
const USER_COLS = "id, username, display_name, context, role, active, pw_version, created, last_login, workspace_id, onboarded";
async function getUser(id) {
  const r = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
  return r.rows[0] || null;
}
async function getUserByName(username) {
  const r = await pool.query(`SELECT ${USER_COLS}, password_hash FROM users WHERE username = $1`, [String(username || "").toLowerCase().trim()]);
  return r.rows[0] || null;
}
function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}
/* token = id.exp.firma — la firma incluye pw_version: cambiar la contraseña invalida todas las sesiones */
function signSession(u) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 90;
  const body = `${u.id}.${exp}`;
  const sig = crypto.createHmac("sha256", SECRET).update(body + "." + u.pw_version).digest("hex");
  return `${body}.${sig}`;
}
async function userFromSession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  const u = await getUser(id);
  if (!u || !u.active) return null;
  const want = crypto.createHmac("sha256", SECRET).update(`${id}.${exp}.${u.pw_version}`).digest("hex");
  const a = Buffer.from(sig, "utf8"), b = Buffer.from(want, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? u : null;
}

/* ======================================================================
   SCORE — matemática transparente, la IA nunca lo inventa.
   bool: cumplida = peso completo. horas: crédito parcial min(valor/umbral, 1).
   ====================================================================== */
function computeScore(senalesValues, config) {
  const senales = config?.senales || [];
  let total = 0, got = 0;
  for (const s of senales) {
    const peso = Number(s.peso) || 0;
    total += peso;
    const v = senalesValues?.[s.id];
    if (v === undefined || v === null) continue;
    if (s.tipo === "horas") {
      const num = Number(v);
      const umbral = Number(s.umbral) || 1;
      if (Number.isFinite(num) && num > 0) got += Math.min(num / umbral, 1) * peso;
    } else if (v === true) {
      got += peso;
    }
  }
  if (total <= 0) return 0;
  return Math.round((got / total) * 100);
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

function buildDashboard(data) {
  const config = data.config || DEFAULT_CONFIG;
  const days = data.days || {};
  const today = todayISO();
  const logged = Object.keys(days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  const first = logged[0] || today;
  // serie desde el primer día registrado (mínimo 14 días de ventana)
  let start = first < addDays(today, -13) ? first : addDays(today, -13);

  const serie = [];
  let acumulado = 0;
  for (let f = start; f <= today; f = addDays(f, 1)) {
    const d = days[f];
    const score = d ? computeScore(d.senales, config) : null;
    acumulado += score || 0;
    serie.push({ fecha: f, score, acumulado, resumen: d?.resumen || null });
  }

  // racha: días consecutivos con score >= racha_min, terminando hoy o ayer
  const min = Number(config.racha_min) || 50;
  let racha = 0;
  let f = today;
  const scoreOf = (fecha) => (days[fecha] ? computeScore(days[fecha].senales, config) : null);
  if (scoreOf(f) === null || scoreOf(f) < min) f = addDays(f, -1); // hoy aún sin cerrar no rompe la racha
  while (scoreOf(f) !== null && scoreOf(f) >= min) { racha++; f = addDays(f, -1); }

  // pendiente: suma de scores últimos 30 días vs 30 anteriores
  const sumRange = (from, to) => {
    let s = 0;
    for (let x = from; x <= to; x = addDays(x, 1)) s += scoreOf(x) || 0;
    return s;
  };
  const last30 = sumRange(addDays(today, -29), today);
  const prev30 = sumRange(addDays(today, -59), addDays(today, -30));
  let pendiente = null;
  if (prev30 > 0) pendiente = Math.round(((last30 - prev30) / prev30) * 100);

  // media de los últimos 7 días registrados
  const last7 = serie.slice(-7).filter((x) => x.score !== null);
  const media7 = last7.length ? Math.round(last7.reduce((a, x) => a + x.score, 0) / last7.length) : null;

  const hoy = days[today] || null;
  return {
    fecha: today,
    config,
    hoy: {
      senales: hoy?.senales || {},
      resumen: hoy?.resumen || null,
      kcal: Number(hoy?.kcal) > 0 ? Math.round(Number(hoy.kcal)) : null,
      score: hoy ? computeScore(hoy.senales, config) : null,
    },
    kcal_obj: Number(data.config_nutricion?.kcal_obj) || 3500,
    racha,
    media7,
    pendiente, // % de crecimiento del ritmo (30d vs 30d anteriores)
    last30,
    prev30,
    serie,
    dias_registrados: logged.length,
  };
}

/* ======================================================================
   APP
   ====================================================================== */
const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/diag", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT updated_at, octet_length(data::text) AS bytes FROM user_state WHERE user_id = $1", [req.user?.id]
    );
    res.json({ db: "ok", ia: anthropic ? "ok" : "sin ANTHROPIC_API_KEY", row: rows[0] || null });
  } catch (e) {
    res.status(500).json({ db: "fail", error: e.message });
  }
});

/* Sesión: cookie httpOnly con token firmado por usuario.
   Basic auth (usuario:contraseña de la BD) sigue aceptado para scripts (test-e2e, curl). */
const SESSION_COOKIE = "os_session";
const VIEWAS_COOKIE = "os_as"; // solo admin: id de la cuenta que está viendo
const PUBLIC_PATHS = new Set([
  "/health", "/login.html", "/api/login", "/favicon.ico",
  // PWA: el navegador los pide sin cookies
  "/manifest.json", "/sw.js", "/icon-180.png", "/icon-192.png", "/icon-512.png", "/theme.js",
]);

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
const cookieStr = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/* Basic auth verificado contra la BD, con caché corta para no recalcular scrypt en cada petición */
const basicCache = new Map(); // header → { userId, exp }
async function userFromBasic(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) return null;
  const hit = basicCache.get(header);
  if (hit && hit.exp > Date.now()) return getUser(hit.userId);
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  const u = await getUserByName(decoded.slice(0, sep));
  if (!u || !u.active || !(await verifyPassword(decoded.slice(sep + 1), u.password_hash))) return null;
  basicCache.set(header, { userId: u.id, exp: Date.now() + 5 * 60 * 1000 });
  return publicUser(u);
}

app.post("/api/login", async (req, res) => {
  try {
    const { user, pass } = req.body || {};
    const u = await getUserByName(user);
    if (!u || !(await verifyPassword(pass, u.password_hash))) return res.status(401).json({ error: "Credenciales incorrectas" });
    if (!u.active) return res.status(403).json({ error: "Cuenta desactivada. Habla con el administrador." });
    await pool.query("UPDATE users SET last_login = $2 WHERE id = $1", [u.id, Date.now()]);
    res.setHeader("Set-Cookie", [cookieStr(SESSION_COOKIE, signSession(u), 60 * 60 * 24 * 90), cookieStr(VIEWAS_COOKIE, "", 0)]);
    res.json({ ok: true, user: publicUser(u) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", [cookieStr(SESSION_COOKIE, "", 0), cookieStr(VIEWAS_COOKIE, "", 0)]);
  res.json({ ok: true });
});

/* ======================================================================
   MCP (Model Context Protocol) — deja conectar esta cuenta a otras IAs
   (Claude Code, Claude Desktop vía mcp-remote…). JSON-RPC 2.0 sobre HTTP,
   sin estado: cada petición se autentica con su token Bearer y ese token
   decide de QUIÉN son los datos. Un token nunca ve otra cuenta.
   ====================================================================== */
const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MCP_MUTAN = new Set(["log_day", "append_journal", "add_item", "set_value"]);
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

async function userFromMcpToken(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  const r = await pool.query(
    `SELECT t.id AS token_id, ${USER_COLS.split(", ").map((c) => "u." + c).join(", ")}
     FROM mcp_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`,
    [hashToken(h.slice(7).trim())]
  );
  const u = r.rows[0];
  if (!u || !u.active) return null;
  pool.query("UPDATE mcp_tokens SET last_used = $2 WHERE id = $1", [u.token_id, Date.now()]).catch(() => {});
  return u;
}

const jsonRpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/* Herramientas que ve la IA externa: las mismas del chat interno (misma lógica, mismos límites)
   más una lectura cómoda del panel. */
function mcpTools() {
  return [
    ...TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
    {
      name: "get_dashboard",
      description: "Resumen del panel: score de hoy, racha, media de 7 y 30 días, ritmo frente al mes anterior y la serie diaria con el acumulado. Empieza por aquí para saber cómo va la persona.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

async function mcpHandle(msg, user) {
  const { id, method, params } = msg || {};
  const esNotificacion = id === undefined || id === null;

  if (method === "initialize") {
    const pedida = params?.protocolVersion;
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: MCP_VERSIONS.includes(pedida) ? pedida : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "os-panel-personal", version: "1.0.0" },
        instructions: `Panel de vida de ${user.display_name || user.username}: hábitos con un score diario de 0 a 100, tareas, proyectos, contenido, sueño, gym y nutrición. Usa get_dashboard para ver cómo va, read_state para leer detalle y log_day/add_item/append_journal/set_value para registrar lo que te cuente. El score lo calcula el servidor: nunca lo inventes.`,
      },
    };
  }
  if (esNotificacion) return null; // notifications/initialized y compañía: sin respuesta
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: mcpTools() } };
  if (method === "resources/list") return { jsonrpc: "2.0", id, result: { resources: [] } };
  if (method === "prompts/list") return { jsonrpc: "2.0", id, result: { prompts: [] } };

  if (method === "tools/call") {
    const nombre = params?.name;
    const args = params?.arguments || {};
    if (!nombre) return jsonRpcError(id, -32602, "falta el nombre de la herramienta");
    if (nombre !== "get_dashboard" && !TOOLS.some((t) => t.name === nombre)) {
      return jsonRpcError(id, -32602, `herramienta desconocida: ${nombre}`);
    }
    const data = await readData(user.id);
    if (nombre === "get_dashboard") {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(buildDashboard(data)) }] } };
    }
    try {
      const acciones = [];
      const texto = runTool(nombre, args, data, acciones);
      if (MCP_MUTAN.has(nombre)) await writeData(user.id, data);
      console.log(`MCP ${user.username} ${nombre}: ${acciones.join(" · ") || "ok"}`);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: texto }] } };
    } catch (e) {
      // error de la herramienta (no del protocolo): va como isError para que la IA lo lea y reintente
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e.message }], isError: true } };
    }
  }
  return jsonRpcError(id, -32601, `método no soportado: ${method}`);
}

app.post("/mcp", async (req, res) => {
  try {
    const user = await userFromMcpToken(req);
    if (!user) {
      res.set("WWW-Authenticate", 'Bearer realm="os"');
      return res.status(401).json(jsonRpcError(null, -32001, "token MCP inválido o revocado"));
    }
    const lote = Array.isArray(req.body) ? req.body : [req.body];
    if (!lote.length) return res.status(400).json(jsonRpcError(null, -32600, "petición vacía"));
    const salidas = (await Promise.all(lote.map((m) => mcpHandle(m, user)))).filter(Boolean);
    if (!salidas.length) return res.status(202).end(); // solo notificaciones
    res.json(Array.isArray(req.body) ? salidas : salidas[0]);
  } catch (e) {
    console.error("MCP error:", e.message);
    res.status(500).json(jsonRpcError(null, -32603, e.message));
  }
});
// sin canal servidor→cliente: no abrimos SSE ni guardamos sesiones
app.get("/mcp", (req, res) => res.set("Allow", "POST, DELETE").status(405).json(jsonRpcError(null, -32000, "este servidor no abre stream SSE; usa POST")));
app.delete("/mcp", (req, res) => res.status(200).end());

/* req.actor = quien ha iniciado sesión · req.user = cuenta cuyos datos se sirven
   (la misma, salvo que un admin esté viendo otra cuenta con la cookie os_as). */
app.use(async (req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  try {
    let actor = await userFromSession(getCookie(req, SESSION_COOKIE));
    if (!actor) actor = await userFromBasic(req);
    if (!actor) {
      if (req.path.startsWith("/api/")) return res.status(401).json({ error: "no autenticado" });
      return res.redirect("/login.html");
    }
    req.actor = actor;
    req.user = actor;
    const asId = getCookie(req, VIEWAS_COOKIE);
    if (asId && actor.role === "admin" && asId !== actor.id) {
      const target = await getUser(asId);
      if (target) { req.user = target; req.viewingAs = true; }
    }
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const isAdmin = (req) => req.actor?.role === "admin";
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: "solo administradores" });
  next();
}
const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;

/* ---------- cuenta propia ---------- */
app.get("/api/me", (req, res) => {
  res.json({
    user: publicUser(req.user),
    actor: publicUser(req.actor),
    viewing_as: req.viewingAs ? publicUser(req.user) : null,
    is_admin: isAdmin(req),
  });
});

app.post("/api/me/profile", async (req, res) => {
  try {
    const { display_name, context } = req.body || {};
    const name = String(display_name ?? req.user.display_name ?? "").trim().slice(0, 60);
    const ctx = context === undefined ? req.user.context : String(context || "").trim().slice(0, 2000) || null;
    if (!name) return res.status(400).json({ error: "el nombre no puede estar vacío" });
    await pool.query("UPDATE users SET display_name = $2, context = $3 WHERE id = $1", [req.user.id, name, ctx]);
    res.json({ ok: true, user: await getUser(req.user.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/me/onboarded", async (req, res) => {
  try {
    const done = req.body?.done !== false;
    await pool.query("UPDATE users SET onboarded = $2 WHERE id = $1", [req.user.id, done]);
    res.json({ ok: true, onboarded: done });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- tokens MCP de la cuenta ---------- */
app.get("/api/me/mcp", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, nombre, prefijo, created, last_used FROM mcp_tokens WHERE user_id = $1 ORDER BY created DESC",
      [req.user.id]
    );
    res.json({ tokens: r.rows, url: `${req.protocol}://${req.get("host")}/mcp` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/me/mcp", async (req, res) => {
  try {
    if (req.viewingAs) return res.status(400).json({ error: "estás viendo otra cuenta: los tokens se crean desde la suya" });
    const nombre = String(req.body?.nombre || "").trim().slice(0, 40) || "Sin nombre";
    const n = await pool.query("SELECT COUNT(*)::int AS n FROM mcp_tokens WHERE user_id = $1", [req.user.id]);
    if (n.rows[0].n >= 10) return res.status(400).json({ error: "máximo 10 tokens por cuenta: revoca alguno" });
    const token = "osmcp_" + crypto.randomBytes(32).toString("base64url");
    const id = uid("t");
    await pool.query(
      "INSERT INTO mcp_tokens (id, user_id, nombre, token_hash, prefijo, created) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, req.user.id, nombre, hashToken(token), token.slice(0, 12), Date.now()]
    );
    // el token en claro se enseña una sola vez: en la BD solo queda su hash
    res.json({ ok: true, id, nombre, token, url: `${req.protocol}://${req.get("host")}/mcp` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/me/mcp/:id", async (req, res) => {
  try {
    const r = await pool.query("DELETE FROM mcp_tokens WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: "token no encontrado" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/me/password", async (req, res) => {
  try {
    if (req.viewingAs) return res.status(400).json({ error: "estás viendo otra cuenta: cambia su contraseña desde Usuarios" });
    const { current, next: nextPass } = req.body || {};
    if (typeof nextPass !== "string" || nextPass.length < 8) return res.status(400).json({ error: "la nueva contraseña necesita al menos 8 caracteres" });
    const full = await getUserByName(req.actor.username);
    if (!(await verifyPassword(current, full.password_hash))) return res.status(401).json({ error: "la contraseña actual no es correcta" });
    await pool.query("UPDATE users SET password_hash = $2, pw_version = pw_version + 1 WHERE id = $1", [req.actor.id, await hashPassword(nextPass)]);
    basicCache.clear();
    const u = await getUser(req.actor.id);
    res.setHeader("Set-Cookie", cookieStr(SESSION_COOKIE, signSession(u), 60 * 60 * 24 * 90)); // la sesión actual sigue viva
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- administración de cuentas ---------- */
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.${USER_COLS.split(", ").join(", u.")}, s.updated_at AS state_updated, octet_length(s.data::text) AS state_bytes, w.nombre AS workspace_nombre
       FROM users u LEFT JOIN user_state s ON s.user_id = u.id LEFT JOIN workspaces w ON w.id = u.workspace_id ORDER BY u.created ASC`
    );
    const ws = await pool.query("SELECT id, nombre, created FROM workspaces ORDER BY nombre ASC");
    res.json({ users: r.rows, workspaces: ws.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const username = String(req.body?.username || "").toLowerCase().trim();
    const password = String(req.body?.password || "");
    const display_name = String(req.body?.display_name || "").trim().slice(0, 60) || capital(username);
    const context = String(req.body?.context || "").trim().slice(0, 2000) || null;
    const role = req.body?.role === "admin" ? "admin" : "user";
    const workspace_id = await workspaceIdValido(req.body?.workspace_id);
    if (workspace_id === false) return res.status(400).json({ error: "grupo no encontrado" });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "usuario: 2-32 caracteres, minúsculas, números, . _ -" });
    if (password.length < 8) return res.status(400).json({ error: "la contraseña necesita al menos 8 caracteres" });
    if (await getUserByName(username)) return res.status(409).json({ error: "ese usuario ya existe" });
    const id = uid("u");
    await pool.query(
      "INSERT INTO users (id, username, password_hash, display_name, context, role, created, workspace_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, username, await hashPassword(password), display_name, context, role, Date.now(), workspace_id]
    );
    await readData(id); // siembra su estado vacío con los defaults
    res.json({ ok: true, user: await getUser(id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const u = await getUser(req.params.id);
    if (!u) return res.status(404).json({ error: "usuario no encontrado" });
    const b = req.body || {};
    const display_name = b.display_name === undefined ? u.display_name : String(b.display_name || "").trim().slice(0, 60) || u.display_name;
    const context = b.context === undefined ? u.context : String(b.context || "").trim().slice(0, 2000) || null;
    let role = b.role === undefined ? u.role : (b.role === "admin" ? "admin" : "user");
    let active = b.active === undefined ? u.active : Boolean(b.active);
    if (u.id === req.actor.id) { role = "admin"; active = true; } // nunca te bloqueas a ti mismo
    let workspace_id = u.workspace_id;
    if (b.workspace_id !== undefined) {
      workspace_id = await workspaceIdValido(b.workspace_id);
      if (workspace_id === false) return res.status(400).json({ error: "grupo no encontrado" });
    }
    const onboarded = b.onboarded === undefined ? u.onboarded : Boolean(b.onboarded);
    await pool.query("UPDATE users SET display_name = $2, context = $3, role = $4, active = $5, workspace_id = $6, onboarded = $7 WHERE id = $1", [u.id, display_name, context, role, active, workspace_id, onboarded]);
    if (!active) basicCache.clear();
    res.json({ ok: true, user: await getUser(u.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/users/:id/password", requireAdmin, async (req, res) => {
  try {
    const u = await getUser(req.params.id);
    if (!u) return res.status(404).json({ error: "usuario no encontrado" });
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(400).json({ error: "la contraseña necesita al menos 8 caracteres" });
    await pool.query("UPDATE users SET password_hash = $2, pw_version = pw_version + 1 WHERE id = $1", [u.id, await hashPassword(password)]);
    basicCache.clear();
    const headers = [];
    if (u.id === req.actor.id) headers.push(cookieStr(SESSION_COOKIE, signSession(await getUser(u.id)), 60 * 60 * 24 * 90));
    if (headers.length) res.setHeader("Set-Cookie", headers);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- workspaces (grupos de cuentas: Amigos, una empresa…) ----------
   Solo etiquetan usuarios: los datos siguen aislados por persona. Sirven para agrupar
   en el panel de admin y, en el futuro, para clasificaciones o defaults por grupo. */
async function workspaceIdValido(v) {
  if (v === null || v === "" || v === undefined) return null; // sin grupo
  const r = await pool.query("SELECT id FROM workspaces WHERE id = $1", [String(v)]);
  return r.rows.length ? r.rows[0].id : false;
}
const nombreWs = (v) => String(v || "").trim().replace(/\s+/g, " ").slice(0, 40);

app.get("/api/admin/workspaces", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT w.id, w.nombre, w.created, COUNT(u.id)::int AS usuarios FROM workspaces w LEFT JOIN users u ON u.workspace_id = w.id GROUP BY w.id ORDER BY w.nombre ASC"
    );
    res.json({ workspaces: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/workspaces", requireAdmin, async (req, res) => {
  try {
    const nombre = nombreWs(req.body?.nombre);
    if (nombre.length < 2) return res.status(400).json({ error: "el grupo necesita un nombre (2-40 caracteres)" });
    const dup = await pool.query("SELECT 1 FROM workspaces WHERE lower(nombre) = lower($1)", [nombre]);
    if (dup.rows.length) return res.status(409).json({ error: "ya existe un grupo con ese nombre" });
    const id = uid("w");
    await pool.query("INSERT INTO workspaces (id, nombre, created) VALUES ($1, $2, $3)", [id, nombre, Date.now()]);
    res.json({ ok: true, workspace: { id, nombre } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/workspaces/:id", requireAdmin, async (req, res) => {
  try {
    const nombre = nombreWs(req.body?.nombre);
    if (nombre.length < 2) return res.status(400).json({ error: "el grupo necesita un nombre (2-40 caracteres)" });
    const dup = await pool.query("SELECT 1 FROM workspaces WHERE lower(nombre) = lower($1) AND id <> $2", [nombre, req.params.id]);
    if (dup.rows.length) return res.status(409).json({ error: "ya existe un grupo con ese nombre" });
    const r = await pool.query("UPDATE workspaces SET nombre = $2 WHERE id = $1 RETURNING id, nombre", [req.params.id, nombre]);
    if (!r.rows.length) return res.status(404).json({ error: "grupo no encontrado" });
    res.json({ ok: true, workspace: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* borrar un grupo deja a sus usuarios sin grupo; nunca toca sus datos */
app.delete("/api/admin/workspaces/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("UPDATE users SET workspace_id = NULL WHERE workspace_id = $1", [req.params.id]);
    const r = await pool.query("DELETE FROM workspaces WHERE id = $1", [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: "grupo no encontrado" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ver otra cuenta: cookie os_as (null para volver a la propia) */
app.post("/api/admin/view-as", requireAdmin, async (req, res) => {
  try {
    const id = req.body?.user_id;
    if (!id || id === req.actor.id) {
      res.setHeader("Set-Cookie", cookieStr(VIEWAS_COOKIE, "", 0));
      return res.json({ ok: true, viewing_as: null });
    }
    const u = await getUser(id);
    if (!u) return res.status(404).json({ error: "usuario no encontrado" });
    res.setHeader("Set-Cookie", cookieStr(VIEWAS_COOKIE, u.id, 60 * 60 * 12));
    res.json({ ok: true, viewing_as: publicUser(u) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/state", async (req, res) => {
  try {
    const data = await readData(req.user.id);
    const { integraciones, chats, ...rest } = data; // secretos y chats no salen por aquí
    res.json(rest);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Merge superficial de claves top-level (nunca machaca lo que no envías).
app.post("/api/state", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "body must be a JSON object" });
    }
    const data = await readData(req.user.id);
    delete req.body.integraciones; // solo via /api/integraciones
    delete req.body.chats;
    Object.assign(data, req.body);
    const bytes = await writeData(req.user.id, data);
    res.json({ ok: true, bytes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const data = await readData(req.user.id);
    res.json(buildDashboard(data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Registro/edición rápida del día desde la UI (excepción manual al chat).
app.post("/api/day", async (req, res) => {
  try {
    const { fecha, senales, resumen, kcal } = req.body || {};
    const f = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : todayISO();
    const data = await readData(req.user.id);
    if (!data.days || typeof data.days !== "object") data.days = {};
    const day = data.days[f] || { senales: {} };
    if (senales && typeof senales === "object") {
      const { nutricion, ...resto } = senales; // nutricion se deriva de las kcal, nunca se marca
      Object.assign(day.senales, resto);
    }
    if (kcal !== undefined) {
      const n = Math.round(Number(kcal));
      if (kcal === null || !Number.isFinite(n) || n <= 0) delete day.kcal;
      else day.kcal = n;
    }
    if (typeof resumen === "string") day.resumen = resumen;
    data.days[f] = day;
    derivarNutricion(data); // el score de la respuesta ya cuenta la nutrición derivada
    await writeData(req.user.id, data);
    res.json({ ok: true, fecha: f, score: computeScore(day.senales, data.config || DEFAULT_CONFIG) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======================================================================
   INTEGRACIONES BANCARIAS (Airwallex + Mercury)
   Las credenciales viven en la BD y se gestionan desde /config.html.
   GET devuelve solo estado + últimos 4 caracteres, nunca el secreto entero.
   ====================================================================== */
/* métricas automáticas de YouTube (views/likes/comments) para las piezas con link de YT */
function ytIdDeUrl(url) {
  const m = String(url || "").match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function igCodeDeUrl(url) {
  const m = String(url || "").match(/instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([\w-]+)/);
  return m ? m[1] : null;
}

app.post("/api/contenido/metricas", async (req, res) => {
  try {
    const data = await readData(req.user.id);
    const ytPiezas = (data.contenido || []).filter((c) => ytIdDeUrl(c.url));
    const igPiezas = (data.contenido || []).filter((c) => igCodeDeUrl(c.url));
    if (!YOUTUBE_API_KEY && !APIFY_TOKEN) return res.status(400).json({ error: "Faltan YOUTUBE_API_KEY y APIFY_TOKEN en el servidor" });

    let nYT = 0, nIG = 0;
    const errores = [];

    if (YOUTUBE_API_KEY && ytPiezas.length) {
      try {
        const ids = [...new Set(ytPiezas.map((c) => ytIdDeUrl(c.url)))];
        const stats = {};
        for (let i = 0; i < ids.length; i += 50) {
          const lote = ids.slice(i, i + 50).join(",");
          const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${lote}&key=${YOUTUBE_API_KEY}`);
          if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
          const body = await r.json();
          for (const it of body.items || []) stats[it.id] = it.statistics || {};
        }
        for (const c of ytPiezas) {
          const s = stats[ytIdDeUrl(c.url)];
          if (!s) continue;
          if (s.viewCount != null) c.views = Number(s.viewCount);
          if (s.likeCount != null) c.likes = Number(s.likeCount);
          if (s.commentCount != null) c.comments = Number(s.commentCount);
          nYT++;
        }
      } catch (e) { errores.push("YouTube: " + e.message); }
    }

    if (APIFY_TOKEN && igPiezas.length) {
      try {
        const urls = [...new Set(igPiezas.map((c) => `https://www.instagram.com/reel/${igCodeDeUrl(c.url)}/`))];
        const r = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directUrls: urls, resultsType: "details", addParentData: false }),
        });
        if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
        const items = await r.json();
        const stats = {};
        for (const it of Array.isArray(items) ? items : []) {
          const code = it.shortCode || igCodeDeUrl(it.url || it.inputUrl);
          if (code) stats[code] = it;
        }
        for (const c of igPiezas) {
          const s = stats[igCodeDeUrl(c.url)];
          if (!s) continue;
          const views = s.videoPlayCount ?? s.videoViewCount;
          if (views != null) c.views = Number(views);
          if (s.likesCount != null && s.likesCount >= 0) c.likes = Number(s.likesCount);
          if (s.commentsCount != null) c.comments = Number(s.commentsCount);
          if (s.videoUrl) c.video_url = s.videoUrl; // mp4 directo para el player propio (caduca; se renueva en cada refresh)
          nIG++;
        }
      } catch (e) { errores.push("Instagram: " + e.message); }
    }

    await writeData(req.user.id, data);
    res.json({ ok: true, actualizadas: nYT + nIG, youtube: nYT, instagram: nIG, errores });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/integraciones", async (req, res) => {
  try {
    const data = await readData(req.user.id);
    res.json(providerStatus(data.integraciones));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/integraciones", async (req, res) => {
  try {
    const body = req.body || {};
    const data = await readData(req.user.id);
    const integ = data.integraciones || {};
    if (body.airwallex !== undefined) {
      const a = body.airwallex;
      integ.airwallex = a && (a.client_id || a.api_key)
        ? {
            client_id: (a.client_id || integ.airwallex?.client_id || "").trim(),
            api_key: (a.api_key || integ.airwallex?.api_key || "").trim(),
            base: a.base === "demo" ? "demo" : "prod",
          }
        : undefined; // vacío = desconectar
      if (!integ.airwallex?.client_id || !integ.airwallex?.api_key) delete integ.airwallex;
    }
    if (body.mercury !== undefined) {
      const t = (body.mercury?.token || "").trim();
      if (t) integ.mercury = { token: t };
      else delete integ.mercury;
    }
    data.integraciones = integ;
    await writeData(req.user.id, data);
    res.json(providerStatus(integ));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/integraciones/test", async (req, res) => {
  try {
    const data = await readData(req.user.id);
    res.json(await testProviders(data.integraciones));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sync", async (req, res) => {
  const t0 = Date.now();
  try {
    const data = await readData(req.user.id);
    const summary = await runSync(data);
    await writeData(req.user.id, data);
    console.log(`POST /api/sync OK en ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(summary));
    res.json({ ok: true, ...summary });
  } catch (e) {
    console.error("POST /api/sync ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ======================================================================
   CHAT IA
   ====================================================================== */
const systemPromptFor = (N, CTX, HAB) => `Eres el asistente personal de ${N}.${CTX ? " Contexto sobre esta persona: " + CTX : ""}

Esta app es su panel de vida: él te cuenta su día (al final o durante) y TÚ estructuras y guardas los datos. El dashboard calcula un score diario 0-100 con matemática fija a partir de las señales — tú NUNCA calculas ni inventas el score, solo registras señales.

Estructura del estado:
- config.senales: [{ id, label, tipo: "bool"|"horas"|"kcal", peso, umbral? }] — los HÁBITOS que puntúan (${N} los llama "hábitos"; en conversación di siempre hábito, nunca señal — la clave interna sigue siendo senales). Actuales: ${HAB}
- days: por fecha { senales: {id: valor}, resumen } — el registro diario.
- journal: [{ fecha, area, texto }] — apuntes de contexto por área: general|sueno|gym|nutricion|proyectos|contenido|finanzas.
- memoria: [{ id, texto, fecha }] — TU memoria durable entre conversaciones. Se te inyecta entera al final de este prompt en cada mensaje: lo que guardes ahí lo "recuerdas" siempre, sin tener que leerlo.
- tareas: [{ id, titulo, estado, prioridad: urgente|alta|normal|baja, inicio?, fecha?, proyecto?, sub?, notas? (pizarra: texto plano o HTML sencillo h2/h3/b/u/div/br, como contenido.notas), hecha (derivada: true solo si estado=completado — cambia SIEMPRE estado, nunca hecha), creada, hecha_el? }] — la lista de tareas (área Tareas). Estados (mismo sistema que growing-projects): pendiente (sin iniciar) | por_definir (activa pero falta concretar) | en_ejecucion | en_espera (bloqueada por alguien/algo) | falta_revision (hecha pero pendiente de revisar) | completado (cerrada). fecha = fecha límite/fin; inicio = arranque de su ventana (time frame: con inicio y fecha la tarea está "activa" ese rango). Solo pon fechas si ${N} las dice. «Apunta que tengo que llamar a María el jueves» → add_item con fecha del jueves. «Estoy con X» → en_ejecucion; «X espera a Y» → en_espera; «X hecho, falta repasarlo» → falta_revision; «esto es urgente/importante» → prioridad urgente/alta. Cuando diga que algo está terminado del todo, pon estado completado + hecha_el — NO la borres. Solo borra si lo pide explícitamente (set_value con delete).
- recordatorios: [{ id, titulo, desde, hasta?, frecuencia: diario|laborables|cada_2|cada_3|cada_7|dias, dias? (si frecuencia=dias: ["lun","mar","mie","jue","vie","sab","dom"]), proyecto?, notas?, hechos: { "<fecha>": true } }] — recordatorios PERIÓDICOS dentro de una ventana (área Tareas). Cada día que toca aparece en "Para hoy"; marcarlo escribe hechos.<fecha>=true y reaparece el siguiente día que toque; al pasar hasta caduca solo. «Recuérdame hacer follow-up a María cada 2 días durante 2 semanas» → add_item en recordatorios con desde=hoy, hasta=+14 días, frecuencia=cada_2. cada_2/cada_3/cada_7 cuentan a partir del campo desde. No toques hechos salvo que ${N} diga que ya lo hizo hoy.
- rutina_gym: { lunes..domingo: { titulo, ejercicios: [{ nombre, series, reps, nota? }] } } — la rutina semanal de gym (editable en el panel, pestaña Gym → Rutina). Si ${N} pide cambios de rutina, edítala con set_value respetando la estructura.
- entrenos: { "<fecha>": { dia, sets: { "<nombre ejercicio>": [{ kg, reps }, ...una entrada por serie] } } } — lo que ${N} levanta cada día (Gym → Tracker). Si dice «hoy press inclinado 3×10 con 40kg», regístralo aquí con set_value y marca la señal entreno.
- days.<fecha>.sueno_horario: { acostar: "23:00", levantar: "06:00" } — opcional. Si ${N} dice a qué hora se acostó y se levantó, calcula las horas dormidas (si se acostó antes de medianoche, suma las 24h), regístralas como señal sueno con log_day y guarda el horario con set_value en days.<fecha>.sueno_horario.
- proyectos: [{ id, nombre, icono (rocket|briefcase|code|video|mic|school|presentation|tienda|coin|chart|users|robot|server|camera|pencil|book|world|tool|flask|gamepad|palette|home|bolt|bulb), tipo: normal|periodico, estado: activo|en_cola|pausado|entregado|cerrado, desc?, siguiente?, subs, notas? (pizarra HTML sencillo, como contenido.notas), archivos? (NO tocar: se gestionan desde la página), updated }]. Un proyecto es una CARPETA: dentro viven sus tareas (campo proyecto en tareas), subproyectos, archivos y pizarra. Cada sub de subs es un SUBPROYECTO con vida propia: { id, nombre, estado: en_curso|en_cola|pausado|hecho, done (derivado: true solo si estado=hecho — para cambiarlo cambia SIEMPRE estado, nunca done), fecha? (día en que se completó, ponla al pasar a hecho), notas? (pizarra HTML sencillo, como la de contenido), archivos?: [{id, nombre, mime, size}] — NO toques archivos, se gestionan desde el panel }. Las tareas pueden colgar de un subproyecto vía su campo sub (id del sub). Si añades un sub nuevo no le pongas id (se genera solo) y usa estado en_curso o en_cola.
- contenido: [{ fecha, tipo: reel|youtube, titulo, estado: idea|grabado|editando|publicado, fecha_pub?, fecha_plan?, url?, views?, likes?, comments?, notas? }] — las métricas de piezas con link (YouTube e Instagram) se actualizan solas desde sus APIs; no hace falta que ${N} las dicte salvo que quiera corregirlas. video_url es interno (mp4 del reel para el player del panel, lo rellena la API — no lo toques). notas es la "pizarra" de la pieza y puede llevar HTML sencillo (h2/h3, b, u, div, br); si escribes tú, texto plano o ese HTML simple. — al marcar publicado, pon fecha_pub con el día real de publicación (cuenta para el reto). fecha_plan = día en que ${N} planea publicarla (calendario de publicación; «el reel del Excel sale el jueves» → fecha_plan). Si ${N} pasa el link («publiqué un reel: <link>»), guárdalo en url (sirve para la miniatura y el player del panel). Si menciona métricas («el reel lleva 4k views»), actualiza views/likes de esa pieza.
- config_contenido: { inicio, dias, meta_reels, meta_yt, min_dia? } — el reto de contenido (default: 100 días desde 2026-08-13, 100 reels + 42 vídeos YT, 100 min/día). Editable si ${N} cambia las metas.
- days.<fecha>.contenido_min: minutos dedicados a contenido ese día — el corazón del reto (objetivo min_dia, default 100). «Hoy le metí 2h al contenido» → set_value en days.<fecha>.contenido_min = 120. Si llega al objetivo, marca también la señal contenido con log_day.
- finanzas: [{ fecha, concepto, importe, tipo: ingreso|gasto, categoria?, cuenta? }] — movimientos en euros. Categorías CANÓNICAS (usa siempre una de estas): gastos = Comida | Compras | Suscripciones | Transporte | Ocio | Salud | Negocio | Otros gastos; ingresos = Trabajo | Clientes | Contenido | Otros ingresos.
- cuentas: [{ id, nombre, tipo: banco|efectivo|ahorro|otro, saldo, updated }] — saldos declarados por ${N} (el sync bancario opcional de Airwallex/Mercury se configura en Configuración).
- suscripciones: [{ id, nombre, importe, periodicidad: mensual|anual, dia_cobro?, tipo: sub|deuda, cuotas_restantes?, fin?, activa }] — tipo "deuda" = pagos financiados con cuotas restantes y fecha fin.
- config_finanzas: { objetivo_ahorro } — objetivo de ahorro en euros (el progreso lo calcula la app sumando cuentas tipo "ahorro").
- peso: [{ fecha, kg }] — peso corporal.
- days.<fecha>.kcal: calorías comidas ese día, a grosso modo (número, total del día). «Hoy he comido unas 2800 kcal» → set_value en days.<fecha>.kcal = 2800. Si va sumando comidas («añade 600 kcal de la cena»), lee el día con read_state y suma al total. Objetivo diario en config_nutricion.kcal_obj.
- El hábito nutricion es DERIVADO y NO se marca a mano: el servidor lo calcula como kcal >= config_nutricion.kcal_obj cada vez que se guarda. NUNCA escribas senales.nutricion (se ignora y se recalcula). Si ${N} dice «hoy he comido bien» sin número, pídele el total aproximado de kcal o estímalo con él a partir de lo que comió — sin kcal ese día queda sin registrar en nutrición.
- config_nutricion: { kcal_obj } — objetivo de calorías diarias.

Reglas de comportamiento:
- Responde SIEMPRE en español, conciso y directo, sin hype. Una recomendación clara, nunca un menú de opciones.
- Cuando ${N} cuente su día, extrae TODAS las señales que mencione y regístralas con log_day en una sola llamada, con un resumen fiel de 1-2 frases. Si menciona datos de áreas (una pieza de contenido, un cobro, su peso, avance de un proyecto), regístralos también con add_item o set_value. Los detalles con contexto van a append_journal con su área.
- Si cuenta el día a medias (por la mañana/tarde), registra lo que haya; se completa luego.
- ${N} puede adjuntarte imágenes (capturas, fotos de comida, pizarras, tickets). Léelas y úsalas como cualquier otro dato: una foto de comida → estima kcal a grosso modo si viene al caso; un ticket/captura de un pago → regístralo en finanzas; una captura de métricas → actualiza la pieza.
- No preguntes por cada señal que falte: registra lo dicho y como mucho pregunta UNA cosa importante que falte.
- Antes de modificar proyectos/contenido/finanzas/cuentas/suscripciones/tareas lee esa clave con read_state para respetar estructura e ids.
- Proyectos: cada proyecto tiene su página en la app. Mantén al día su «siguiente» (la próxima acción concreta), sus subs (subproyectos: marca done:true con fecha cuando ${N} diga que algo está hecho, añade nuevos si los menciona) y notas (contexto/decisiones, texto breve). Usa set_value con el índice del proyecto (p.ej. 'proyectos.2.siguiente'). Al crearlo elige el icono de la lista que más le pegue. Los avances con contexto van también a append_journal (area proyectos) EMPEZANDO el texto con el nombre del proyecto, p.ej. «Taller Claude Code: grabada la VSL».
- Finanzas: si ${N} dice que cobró/pagó algo, add_item en finanzas con categoría y cuenta si las menciona. Si dice su saldo ("tengo 850 en Revolut"), actualiza o crea la cuenta (set_value en el saldo + updated, o add_item si es nueva). Altas de suscripciones o deudas → add_item en suscripciones; si paga una cuota de una deuda, registra el gasto Y baja cuotas_restantes con set_value.
- Memoria: guarda ahí HECHOS DURABLES, no eventos. Sí: decisiones vigentes («decidió aparcar X»), preferencias («no quiere emojis en los títulos»), datos estables (objetivos, acuerdos, contexto de personas). No: lo que pasó hoy (eso va a days/journal). Cuando ${N} diga «recuerda que…» o cuente una decisión/preferencia, guárdala con add_item en memoria SIN que te lo pida dos veces. Una frase por entrada, concreta. Si algo cambia o caduca, actualiza esa entrada (set_value memoria.<i>.texto) o bórrala (set_value con delete) — nunca dupliques. Mantenla por debajo de ~40 entradas fusionando o podando. ${N} también puede editarla a mano en Configuración.
- Puede pedirte cambiar pesos/umbrales/señales de config: hazlo con set_value manteniendo el formato y que los pesos sigan sumando ~100.
- No inventes datos que no estén en el estado. Si no hay registro, dilo.
- Cuando des lectura de su evolución, básate en los days/journal reales. Sé crítico pero sin machacar: señala el patrón, no la culpa, y termina con la siguiente acción concreta.`;

/* la memoria durable del chat va entera en el system prompt: no depende de que el modelo la lea */
function systemConMemoria(data, user) {
  const hab = (data?.config?.senales || []).map((s) =>
    `${s.id} "${s.label}" (${s.tipo === "horas" ? `horas, umbral ${s.umbral}` : s.tipo === "kcal" ? "tipo kcal: DERIVADO, ver abajo" : "bool"}, ${s.peso} pts)`
  ).join(", ") || "ninguno configurado todavía";
  const SYSTEM_PROMPT = systemPromptFor(user?.display_name || capital(user?.username) || "ti", user?.context || "", hab + ".");
  const mems = Array.isArray(data?.memoria) ? data.memoria : [];
  if (!mems.length) {
    return SYSTEM_PROMPT + "\n\nMEMORIA: vacía todavía — ve guardando hechos durables con add_item en memoria.";
  }
  const lineas = mems.map((m, i) => `${i}. [${m.fecha || "?"}] ${m.texto}`).join("\n");
  return SYSTEM_PROMPT + `\n\nMEMORIA (tus ${mems.length} recuerdos durables; el número es el índice para set_value memoria.<i>):\n` + lineas;
}

const TOOLS = [
  {
    name: "read_state",
    description: "Lee claves del estado. days devuelve los últimos 30 días con su score calculado; journal las últimas 25 entradas. Sin keys devuelve config y days.",
    input_schema: {
      type: "object",
      properties: {
        keys: {
          type: "array",
          items: { type: "string", enum: ["config", "days", "journal", "memoria", "tareas", "recordatorios", "proyectos", "contenido", "finanzas", "cuentas", "suscripciones", "config_finanzas", "config_contenido", "config_nutricion", "peso", "rutina_gym", "entrenos"] },
        },
      },
    },
  },
  {
    name: "log_day",
    description: "Registra o completa el día: valores de señales y/o resumen. Hace merge — no borra señales ya registradas. Las señales bool valen true/false; las de horas, un número.",
    input_schema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "YYYY-MM-DD; por defecto hoy" },
        senales: { type: "object", description: "p.ej. { contenido: true, deep_work: 3.5, sueno: 6.5 }. nutricion se ignora aquí: se deriva de kcal." },
        kcal: { type: "number", description: "Total de calorías del día (a grosso modo). De aquí sale el hábito nutricion: cumplido si llega al objetivo." },
        resumen: { type: "string", description: "Resumen fiel del día en 1-2 frases" },
      },
    },
  },
  {
    name: "append_journal",
    description: "Añade un apunte de contexto a un área. Úsalo para detalles con sustancia (cómo se sintió, decisiones, avances) — no para lo que ya cubren las señales.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string" },
        area: { type: "string", enum: AREAS, description: "por defecto general" },
        fecha: { type: "string", description: "YYYY-MM-DD; por defecto hoy" },
      },
      required: ["texto"],
    },
  },
  {
    name: "add_item",
    description: "Añade un elemento a una lista: memoria { texto } (hecho durable, una frase), tareas { titulo, estado? (default pendiente), prioridad? (default normal), inicio?, fecha? (límite/fin, solo si la dice), proyecto? (id), sub? (id del subproyecto), notas? }, recordatorios { titulo, desde, hasta?, frecuencia: diario|laborables|cada_2|cada_3|cada_7|dias, dias?, proyecto?, notas? }, proyectos { nombre, icono, tipo: normal|periodico, estado: activo|en_cola|pausado|entregado|cerrado, desc, siguiente, subs: [{nombre, done}], notas? }, contenido { fecha, tipo: reel|youtube, titulo, estado, fecha_pub?, url?, views?, likes? }, finanzas { fecha, concepto, importe, tipo, categoria?, cuenta? }, cuentas { nombre, tipo, saldo }, suscripciones { nombre, importe, periodicidad, dia_cobro?, tipo, cuotas_restantes?, fin?, activa }, peso { fecha, kg }.",
    input_schema: {
      type: "object",
      properties: {
        lista: { type: "string", enum: ["memoria", "tareas", "recordatorios", "proyectos", "contenido", "finanzas", "cuentas", "suscripciones", "peso"] },
        item: { type: "object" },
      },
      required: ["lista", "item"],
    },
  },
  {
    name: "set_value",
    description: "Escribe un valor por path con puntos (p.ej. 'config.senales.1.umbral', 'proyectos.0.estado'). Índices numéricos acceden a arrays. delete: true borra la clave.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        value: {},
        delete: { type: "boolean" },
      },
      required: ["path"],
    },
  },
];

function setPath(obj, dottedPath, value, del) {
  const parts = dottedPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== "object") {
      cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  if (del) {
    if (Array.isArray(cur) && /^\d+$/.test(last)) cur.splice(Number(last), 1);
    else delete cur[last];
  } else {
    cur[last] = value;
  }
}

function getPath(obj, dottedPath) {
  return dottedPath.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/* claves que read_state puede devolver: nunca integraciones (credenciales bancarias) ni chats */
const KEYS_LEIBLES = new Set([
  "config", "days", "journal", "memoria", "tareas", "recordatorios", "proyectos", "contenido",
  "finanzas", "cuentas", "suscripciones", "config_finanzas", "config_contenido", "config_nutricion",
  "peso", "rutina_gym", "entrenos",
]);

function runTool(name, input, data, actions) {
  const config = data.config || DEFAULT_CONFIG;

  if (name === "read_state") {
    const pedidas = input?.keys?.length ? input.keys : ["config", "days"];
    // el enum del input_schema es orientativo: quien llama puede mandar cualquier cosa
    // (el chat, pero también un cliente MCP), así que la lista blanca se aplica aquí.
    const keys = pedidas.filter((k) => KEYS_LEIBLES.has(k));
    const out = {};
    for (const k of keys) {
      if (k === "days") {
        const fechas = Object.keys(data.days || {}).sort().slice(-30);
        out.days = fechas.map((f) => ({
          fecha: f,
          ...data.days[f],
          score: computeScore(data.days[f]?.senales, config),
        }));
      } else if (k === "journal") {
        out.journal = (data.journal || []).slice(-25);
      } else {
        out[k] = data[k];
      }
    }
    return JSON.stringify(out);
  }

  if (name === "log_day") {
    const f = input?.fecha && /^\d{4}-\d{2}-\d{2}$/.test(input.fecha) ? input.fecha : todayISO();
    if (!data.days || typeof data.days !== "object") data.days = {};
    const day = data.days[f] || { senales: {} };
    if (!day.senales) day.senales = {};
    const validIds = new Set((config.senales || []).map((s) => s.id));
    const applied = {};
    if (input?.senales && typeof input.senales === "object") {
      for (const [id, v] of Object.entries(input.senales)) {
        if (!validIds.has(id) || id === "nutricion") continue; // nutricion se deriva de kcal
        day.senales[id] = v;
        applied[id] = v;
      }
    }
    if (input?.kcal !== undefined) {
      const n = Math.round(Number(input.kcal));
      if (Number.isFinite(n) && n > 0) { day.kcal = n; applied.kcal = n; }
    }
    if (typeof input?.resumen === "string" && input.resumen) day.resumen = input.resumen;
    data.days[f] = day;
    derivarNutricion(data);
    const score = computeScore(day.senales, config);
    const parts = Object.entries(applied).map(([k, v]) => `${k}=${v}`).join(" · ");
    actions.push(`📅 ${f}: ${parts || "resumen"} → score ${score}`);
    return JSON.stringify({ ok: true, fecha: f, senales: day.senales, score });
  }

  if (name === "append_journal") {
    if (!input?.texto) throw new Error("texto requerido");
    if (!Array.isArray(data.journal)) data.journal = [];
    const entry = {
      fecha: input.fecha && /^\d{4}-\d{2}-\d{2}$/.test(input.fecha) ? input.fecha : todayISO(),
      area: AREAS.includes(input.area) ? input.area : "general",
      texto: input.texto,
    };
    data.journal.push(entry);
    actions.push(`📓 ${entry.area}: ${entry.texto.slice(0, 80)}`);
    return JSON.stringify({ ok: true, entradas: data.journal.length });
  }

  if (name === "add_item") {
    const lista = input?.lista;
    if (!["memoria", "tareas", "recordatorios", "proyectos", "contenido", "finanzas", "cuentas", "suscripciones", "peso"].includes(lista)) throw new Error("lista inválida");
    if (!input?.item || typeof input.item !== "object") throw new Error("item requerido");
    if (!Array.isArray(data[lista])) data[lista] = [];
    const item = { ...input.item };
    if (lista === "tareas") {
      // fecha = fecha límite: NO se rellena sola
      item.id = item.id || uid("t");
      if (!ESTADOS_TAREA.includes(item.estado)) item.estado = "pendiente";
      if (!PRIORIDADES_TAREA.includes(item.prioridad)) item.prioridad = "normal";
      item.hecha = item.estado === "completado";
      item.creada = item.creada || todayISO();
    } else if (lista === "recordatorios") {
      item.id = item.id || uid("r");
      item.desde = item.desde || todayISO();
      if (!item.hechos || typeof item.hechos !== "object") item.hechos = {};
    } else if (lista === "memoria") {
      item.id = item.id || uid("m");
      item.fecha = item.fecha || todayISO();
    } else if (["proyectos", "cuentas", "suscripciones"].includes(lista)) {
      item.id = item.id || uid(lista[0]);
      item.updated = todayISO();
      if (lista === "suscripciones" && item.activa === undefined) item.activa = true;
    } else if (!item.fecha) {
      item.fecha = todayISO();
    }
    data[lista].push(item);
    actions.push(`➕ ${lista}: ${JSON.stringify(input.item).slice(0, 100)}`);
    return JSON.stringify({ ok: true, total: data[lista].length });
  }

  if (name === "set_value") {
    if (!input?.path || typeof input.path !== "string") throw new Error("path requerido");
    if (/^(chats?|integraciones)(\.|$)/.test(input.path)) throw new Error("esa clave no es modificable desde el chat");
    const before = getPath(data, input.path);
    setPath(data, input.path, input.value, input.delete === true);
    actions.push(input.delete === true
      ? `🗑 ${input.path}`
      : `✎ ${input.path} = ${JSON.stringify(input.value).slice(0, 120)}`);
    return JSON.stringify({ ok: true, path: input.path, antes: before === undefined ? null : before });
  }

  throw new Error(`herramienta desconocida: ${name}`);
}

// Opus 5 con fallbacks server-side por defecto; effort low para respuestas rápidas.
const EFFORT = process.env.EFFORT || "low";

async function callClaude(params) {
  const body = { ...params, output_config: { effort: EFFORT } };
  try {
    return await anthropic.beta.messages.create({
      ...body,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (e) {
    if (e?.status === 400) return await anthropic.messages.create(body);
    throw e;
  }
}

const CHAT_HISTORY_MAX = 80;
const CHAT_CONTEXT_MAX = 24;
const MAX_TOOL_ITERATIONS = 8;

app.get("/api/chats", async (req, res) => {
  try {
    const data = await readData(req.user.id);
    const list = Object.entries(data.chats || {})
      .map(([id, c]) => ({ id, title: c.title, updated: c.updated, count: c.messages.length }))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/chats/:id", async (req, res) => {
  try {
    const data = await readData(req.user.id);
    const chat = data.chats?.[req.params.id];
    if (!chat) return res.status(404).json({ error: "chat no encontrado" });
    res.json({ id: req.params.id, title: chat.title, messages: chat.messages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/chats/:id", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim().slice(0, 80);
    if (!title) return res.status(400).json({ error: "title requerido" });
    const data = await readData(req.user.id);
    const chat = data.chats?.[req.params.id];
    if (!chat) return res.status(404).json({ error: "chat no encontrado" });
    chat.title = title;
    await writeData(req.user.id, data);
    res.json({ ok: true, title });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/chats/:id", async (req, res) => {
  try {
    const data = await readData(req.user.id);
    if (data.chats?.[req.params.id]) {
      const ids = (data.chats[req.params.id].messages || []).flatMap((m) => m.images || []);
      if (ids.length) await pool.query("DELETE FROM chat_images WHERE id = ANY($1) AND user_id = $2", [ids, req.user.id]).catch(() => {});
      delete data.chats[req.params.id];
      await writeData(req.user.id, data);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// archivos de subproyectos: subir (base64), servir y borrar
const MIMES_INLINE = /^(image\/|video\/|audio\/|application\/pdf$|text\/plain$)/; // el resto se descarga, nunca se renderiza (evita HTML servido same-origin)
app.post("/api/archivos", async (req, res) => {
  try {
    const { nombre, mime, data } = req.body || {};
    if (typeof data !== "string" || !data || typeof mime !== "string" || !mime || typeof nombre !== "string" || !nombre.trim()) {
      return res.status(400).json({ error: "nombre, mime y data (base64) requeridos" });
    }
    if (data.length > 20 * 1024 * 1024) return res.status(413).json({ error: "archivo demasiado grande (máx ~15MB)" });
    const id = "f" + Date.now() + Math.random().toString(36).slice(2, 7);
    const size = Math.round(data.length * 0.75);
    await pool.query(
      "INSERT INTO app_files (id, nombre, mime, data, size, created, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, nombre.trim().slice(0, 160), mime, data, size, Date.now(), req.user.id]
    );
    res.json({ ok: true, id, size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/archivos/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT nombre, mime, data FROM app_files WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).end();
    const { nombre, mime, data } = r.rows[0];
    const inline = MIMES_INLINE.test(mime);
    res.set("Content-Type", inline ? mime : "application/octet-stream");
    res.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nombre)}`);
    res.set("Cache-Control", "private, max-age=31536000, immutable");
    res.send(Buffer.from(data, "base64"));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/archivos/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM app_files WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const IMG_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// sube una imagen del chat (base64 ya reducida en el cliente) y devuelve su id
app.post("/api/imagenes", async (req, res) => {
  try {
    const { data, mime } = req.body || {};
    if (typeof data !== "string" || !data || !IMG_MIMES.includes(mime)) {
      return res.status(400).json({ error: "data (base64) y mime de imagen requeridos" });
    }
    if (data.length > 8 * 1024 * 1024) return res.status(413).json({ error: "imagen demasiado grande" });
    const id = "img" + Date.now() + Math.random().toString(36).slice(2, 7);
    await pool.query("INSERT INTO chat_images (id, mime, data, created, user_id) VALUES ($1, $2, $3, $4, $5)", [id, mime, data, Date.now(), req.user.id]);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/imagenes/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT mime, data FROM chat_images WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).end();
    res.set("Content-Type", r.rows[0].mime);
    res.set("Cache-Control", "private, max-age=31536000, immutable");
    res.send(Buffer.from(r.rows[0].data, "base64"));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/chat", async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: "ANTHROPIC_API_KEY no configurada" });
  const userMessage = (req.body?.message || "").trim();
  const imageIds = Array.isArray(req.body?.images)
    ? req.body.images.filter((x) => typeof x === "string" && /^img[\w]+$/.test(x)).slice(0, 6)
    : [];
  if (!userMessage && !imageIds.length) return res.status(400).json({ error: "message requerido" });

  const t0 = Date.now();
  try {
    const data = await readData(req.user.id);
    if (!data.chats || typeof data.chats !== "object") data.chats = {};

    let chatId = req.body?.chat_id;
    if (!chatId || !data.chats[chatId]) {
      chatId = "c" + Date.now();
      data.chats[chatId] = { title: (userMessage || "Imagen").slice(0, 48), created: Date.now(), updated: Date.now(), messages: [] };
    }
    const chat = data.chats[chatId];
    chat.messages.push({ role: "user", content: userMessage, ts: Date.now(), ...(imageIds.length ? { images: imageIds } : {}) });

    const history = chat.messages.slice(-CHAT_CONTEXT_MAX);
    // imágenes de los mensajes en contexto → bloques de visión
    const idsCtx = history.flatMap((m) => m.images || []);
    const imgMap = {};
    if (idsCtx.length) {
      const r = await pool.query("SELECT id, mime, data FROM chat_images WHERE id = ANY($1) AND user_id = $2", [idsCtx, req.user.id]);
      for (const row of r.rows) imgMap[row.id] = row;
    }
    const messages = history.map((m) => {
      const blocks = [];
      for (const iid of m.images || []) {
        const im = imgMap[iid];
        if (im) blocks.push({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } });
      }
      if (m.content) blocks.push({ type: "text", text: m.content });
      if (!blocks.length) blocks.push({ type: "text", text: "(imagen adjunta no disponible)" });
      return { role: m.role, content: blocks };
    });
    const ultimo = messages[messages.length - 1].content;
    ultimo[ultimo.length - 1].cache_control = { type: "ephemeral" };
    messages.push({ role: "system", content: `Hoy es ${todayISO()}.` });

    const actions = [];
    let response = null;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      response = await callClaude({
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: "text", text: systemConMemoria(data, req.user), cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason !== "tool_use") break;

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      messages.push({ role: "assistant", content: response.content });
      const results = toolUses.map((tu) => {
        try {
          return { type: "tool_result", tool_use_id: tu.id, content: runTool(tu.name, tu.input, data, actions) };
        } catch (e) {
          return { type: "tool_result", tool_use_id: tu.id, content: e.message, is_error: true };
        }
      });
      messages.push({ role: "user", content: results });
    }

    let reply;
    if (response.stop_reason === "refusal") {
      reply = "No puedo ayudarte con eso.";
    } else {
      reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!reply) reply = "(sin respuesta — inténtalo de nuevo)";
    }

    chat.messages.push({ role: "assistant", content: reply, ts: Date.now(), ...(actions.length ? { actions } : {}) });
    if (chat.messages.length > CHAT_HISTORY_MAX) {
      const fuera = chat.messages.slice(0, -CHAT_HISTORY_MAX).flatMap((m) => m.images || []);
      if (fuera.length) await pool.query("DELETE FROM chat_images WHERE id = ANY($1) AND user_id = $2", [fuera, req.user.id]).catch(() => {});
      chat.messages = chat.messages.slice(-CHAT_HISTORY_MAX);
    }
    chat.updated = Date.now();
    await writeData(req.user.id, data);

    console.log(`POST /api/chat OK en ${((Date.now() - t0) / 1000).toFixed(1)}s (${actions.length} acciones)`);
    res.json({ reply, actions, chat_id: chatId });
  } catch (e) {
    console.error(`POST /api/chat ERROR tras ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e.status || "", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`OS up on :${PORT} (IA: ${anthropic ? MODEL : "off"})`));
  })
  .catch((e) => {
    console.error("Schema init failed:", e.message);
    process.exit(1);
  });
