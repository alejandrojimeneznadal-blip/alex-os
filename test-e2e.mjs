// Prueba e2e local: cuenta un día al chat y verifica que el estado se actualiza.
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL(".env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const BASE = `http://localhost:${env.PORT || 3200}`;
const AUTH = "Basic " + Buffer.from(`${env.AUTH_USER}:${env.AUTH_PASS}`).toString("base64");

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Authorization: AUTH, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const msg = "hoy dormí 7 horas y media, me desperté a las 6, entrené push, publiqué un reel y metí unas 5 horas al proyecto principal. Comí bien. Eso sí, anoche caí con el móvil en la cama un rato.";

console.log("→ enviando día al chat…");
const t0 = Date.now();
const chat = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: msg }) });
console.log(`← respuesta en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("REPLY:", chat.reply);
console.log("ACTIONS:", JSON.stringify(chat.actions, null, 2));

const dash = await api("/api/dashboard");
console.log("\nHOY:", JSON.stringify(dash.hoy));
console.log("RACHA:", dash.racha, "| MEDIA7:", dash.media7, "| SERIE:", dash.serie.length, "días");

const state = await api("/api/state");
console.log("CONTENIDO:", JSON.stringify(state.contenido));
console.log("JOURNAL:", JSON.stringify(state.journal));
