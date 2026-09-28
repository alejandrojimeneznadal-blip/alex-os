#!/usr/bin/env node
/* Uso de tokens de Claude Code → Alex OS (área Claude).

   Se ejecuta en el ORDENADOR donde usas Claude Code, no en el servidor. Lee los historiales que Claude Code
   guarda en ~/.claude/projects/**\/*.jsonl (cada respuesta lleva su `usage`), deduplica por id de mensaje,
   agrega por día y modelo, estima el coste a tarifa pública de la API y lo sube a POST /api/claude-usage.

   Config por variables de entorno o en ~/.config/alex-os/claude-usage.json ({ "url", "token", "tz", "dir" }):
     ALEX_OS_URL     https://tu-instancia  (o http://localhost:3200)
     ALEX_OS_TOKEN   token MCP de tu cuenta (Configuración → Conectar con otras IAs → nuevo token)
     ALEX_OS_TZ      zona horaria para cortar los días (default Europe/Madrid)
     CLAUDE_DIR      carpeta de Claude Code (default ~/.claude)

   Uso:  node tools/claude-usage-sync.mjs [--dry] [--full]
     --dry   no sube nada, solo imprime el resumen
     --full  ignora la caché por fichero y vuelve a leer todos los historiales */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const VERSION = "1";
const HOME = os.homedir();
const CFG_PATH = path.join(HOME, ".config", "alex-os", "claude-usage.json");
const CACHE_PATH = path.join(HOME, ".cache", "alex-os", "claude-usage-cache.json");
const args = new Set(process.argv.slice(2));
const leeJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const cfgFile = leeJson(CFG_PATH, {});
const cfg = {
  url: String(process.env.ALEX_OS_URL || cfgFile.url || "").replace(/\/+$/, ""),
  token: process.env.ALEX_OS_TOKEN || cfgFile.token || "",
  tz: process.env.ALEX_OS_TZ || cfgFile.tz || "Europe/Madrid",
  dir: process.env.CLAUDE_DIR || cfgFile.dir || path.join(HOME, ".claude"),
};

/* Tarifa pública de la API en USD por millón de tokens (sep 2026): entrada, salida, caché escrita a 5 min (1,25×),
   caché escrita a 1 h (2×), caché leída. Solo sirve para ESTIMAR: con suscripción no se paga por token. */
const PRECIOS = {
  "claude-fable-5-1":  { in: 10, out: 50, cw5: 12.5, cw1h: 20, cr: 0.25 },
  "claude-mythos-5-1": { in: 10, out: 50, cw5: 12.5, cw1h: 20, cr: 0.25 },
  "claude-fable-5":    { in: 10, out: 50, cw5: 12.5, cw1h: 20, cr: 1 },
  "claude-opus-5-5":   { in: 4, out: 20, cw5: 5, cw1h: 8, cr: 0.2 },
  "claude-opus-5":     { in: 5, out: 25, cw5: 6.25, cw1h: 10, cr: 0.5 },
  "claude-opus-4-8":   { in: 5, out: 25, cw5: 6.25, cw1h: 10, cr: 0.5 },
  "claude-opus-4-7":   { in: 5, out: 25, cw5: 6.25, cw1h: 10, cr: 0.5 },
  "claude-opus-4-6":   { in: 5, out: 25, cw5: 6.25, cw1h: 10, cr: 0.5 },
  "claude-sonnet-5":   { in: 2, out: 10, cw5: 2.5, cw1h: 4, cr: 0.2 },
  "claude-sonnet-4-6": { in: 3, out: 15, cw5: 3.75, cw1h: 6, cr: 0.3 },
  "claude-haiku-4-5":  { in: 1, out: 5, cw5: 1.25, cw1h: 2, cr: 0.1 },
};
const FAMILIA_DEFAULT = { fable: "claude-fable-5-1", mythos: "claude-mythos-5-1", opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5" };

function normModel(m) {
  let s = String(m || "").trim().toLowerCase().replace(/\[1m\]$/, "").replace(/-\d{8}$/, "");
  if (!s.startsWith("claude-")) s = FAMILIA_DEFAULT[s] || "claude-" + s; // "opus" a secas → familia actual
  return s;
}
function precioDe(model) {
  if (PRECIOS[model]) return PRECIOS[model];
  const fam = Object.keys(FAMILIA_DEFAULT).find((f) => model.includes(f));
  return PRECIOS[FAMILIA_DEFAULT[fam] || "claude-opus-5"];
}
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz, year: "numeric", month: "2-digit", day: "2-digit" });
function diaDe(ts) {
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? fmtDia.format(d) : null;
}

function* ficheros(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* ficheros(p);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
  }
}

/* Agrega un historial: { dias: { fecha: { modelo: { in, out, cw5, cw1h, cr, th, n } } }, sesiones: { fecha: [ids] } }.
   Claude Code escribe el mismo mensaje en varias líneas (una por bloque de contenido) con el mismo usage:
   nos quedamos con la última por id de mensaje. */
async function agregaFichero(file) {
  const porId = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"usage"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o?.type !== "assistant") continue;
    const m = o.message, u = m?.usage;
    if (!u || !m.model || m.model === "<synthetic>") continue;
    const dia = diaDe(o.timestamp);
    if (!dia) continue;
    porId.set(m.id || o.uuid, { dia, model: normModel(m.model), u, sid: o.sessionId });
  }
  const dias = {}, sesiones = {};
  for (const { dia, model, u, sid } of porId.values()) {
    const t = (dias[dia] ||= {})[model] ||= { in: 0, out: 0, cw5: 0, cw1h: 0, cr: 0, th: 0, n: 0 };
    const cc = u.cache_creation || {};
    const cwTotal = Number(u.cache_creation_input_tokens) || 0;
    const cw1h = Number(cc.ephemeral_1h_input_tokens) || 0;
    const cw5 = cc.ephemeral_5m_input_tokens !== undefined ? Number(cc.ephemeral_5m_input_tokens) || 0 : Math.max(0, cwTotal - cw1h);
    t.in += Number(u.input_tokens) || 0;
    t.out += Number(u.output_tokens) || 0;
    t.cw5 += cw5;
    t.cw1h += cw1h;
    t.cr += Number(u.cache_read_input_tokens) || 0;
    t.th += Number(u.output_tokens_details?.thinking_tokens) || 0;
    t.n += 1;
    if (sid) (sesiones[dia] ||= new Set()).add(sid);
  }
  for (const d in sesiones) sesiones[d] = [...sesiones[d]];
  return { dias, sesiones };
}

async function main() {
  const t0 = Date.now();
  const raiz = path.join(cfg.dir, "projects");
  if (!fs.existsSync(raiz)) { console.error(`No existe ${raiz}: ¿está instalado Claude Code en este ordenador?`); process.exit(1); }
  const cache = args.has("--full") ? { files: {} } : leeJson(CACHE_PATH, { files: {} });
  const files = {};
  let releidos = 0;
  for (const f of ficheros(raiz)) {
    const st = fs.statSync(f);
    const prev = cache.files?.[f];
    if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) { files[f] = prev; continue; }
    files[f] = { mtime: st.mtimeMs, size: st.size, ...(await agregaFichero(f)) };
    releidos++;
  }
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify({ version: VERSION, files }));

  // fusión de todos los ficheros → payload por día y modelo, con coste estimado
  const dias = {}, ses = {};
  for (const agg of Object.values(files)) {
    for (const [dia, modelos] of Object.entries(agg.dias || {})) {
      const D = (dias[dia] ||= { modelos: {}, sesiones: 0 });
      for (const [m, t] of Object.entries(modelos)) {
        const M = D.modelos[m] ||= { in: 0, out: 0, cw: 0, cr: 0, th: 0, n: 0, usd: 0 };
        const p = precioDe(m);
        M.in += t.in; M.out += t.out; M.cw += t.cw5 + t.cw1h; M.cr += t.cr; M.th += t.th; M.n += t.n;
        M.usd += (t.in * p.in + t.out * p.out + t.cw5 * p.cw5 + t.cw1h * p.cw1h + t.cr * p.cr) / 1e6;
      }
    }
    for (const [dia, ids] of Object.entries(agg.sesiones || {})) for (const id of ids) (ses[dia] ||= new Set()).add(id);
  }
  for (const dia in dias) {
    dias[dia].sesiones = ses[dia]?.size || 0;
    for (const M of Object.values(dias[dia].modelos)) M.usd = Math.round(M.usd * 10000) / 10000;
  }

  const fechas = Object.keys(dias).sort();
  const hoy = fmtDia.format(new Date());
  const suma = (fs_) => fs_.reduce((a, f) => { for (const M of Object.values(dias[f].modelos)) { a.tok += M.in + M.out + M.cw + M.cr; a.usd += M.usd; } return a; }, { tok: 0, usd: 0 });
  const sH = suma(fechas.filter((f) => f === hoy)), sT = suma(fechas);
  const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
  console.log(`[${new Date().toISOString().slice(0, 16)}] ${Object.keys(files).length} historiales (${releidos} releídos) · ${fechas.length} días desde ${fechas[0] || "–"} · hoy ${k(sH.tok)} tokens ≈ ${sH.usd.toFixed(2)} $ · total ${k(sT.tok)} tokens ≈ ${sT.usd.toFixed(2)} $ · ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (args.has("--dry")) return;
  if (!cfg.url || !cfg.token) { console.error(`Falta ALEX_OS_URL o ALEX_OS_TOKEN (env o ${CFG_PATH}). Nada subido.`); process.exit(1); }
  const res = await fetch(cfg.url + "/api/claude-usage", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + cfg.token },
    body: JSON.stringify({ version: VERSION, origen: os.hostname().replace(/\.local$/, ""), dias }),
  });
  const body = await res.text();
  if (!res.ok) { console.error(`Subida rechazada (${res.status}): ${body.slice(0, 200)}`); process.exit(1); }
  console.log(`Subido a ${cfg.url} → ${body.slice(0, 120)}`);
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
