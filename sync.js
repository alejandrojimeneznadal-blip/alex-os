import { createSign, createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
/* Sync bancario (Airwallex / Mercury).
   Credenciales en BD (data.integraciones), NO en variables de entorno:
   se configuran desde /config.html. Todo se unifica en EUR con tipos ECB. */

const AWX_FRIENDLY = {
  ISSUING_CAPTURE: "Compra con tarjeta",
  ISSUING_REFUND: "Devolución tarjeta",
  DEPOSIT: "Depósito recibido",
  PAYOUT: "Transferencia enviada",
  CONVERSION_BUY: "Conversión de divisas (compra)",
  CONVERSION_SELL: "Conversión de divisas (venta)",
  FEE: "Comisión",
};

/* ---------- FX (ECB vía frankfurter.app; no fatal si falla) ---------- */
export async function syncFxRates(data) {
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=EUR");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const body = await res.json();
    data.fx_rates = { EUR: 1, ...body.rates, _day: body.date };
  } catch (e) {
    if (!data.fx_rates) data.fx_rates = { EUR: 1 };
  }
}

function toEur(amount, currency, rates) {
  const rate = rates?.[currency] ?? 1;
  return amount / rate;
}

const round2 = (n) => Math.round(n * 100) / 100;

/* ---------- Airwallex ---------- */
function awxBase(cfg) {
  return cfg.base === "demo" ? "https://api-demo.airwallex.com" : "https://api.airwallex.com";
}

async function awxToken(cfg) {
  const res = await fetch(`${awxBase(cfg)}/api/v1/authentication/login`, {
    method: "POST",
    headers: { "x-client-id": cfg.client_id, "x-api-key": cfg.api_key },
  });
  if (!res.ok) throw new Error(`Airwallex login: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).token; // dura ~30 min; un sync entero cabe de sobra
}

async function awxGet(cfg, token, path) {
  const res = await fetch(`${awxBase(cfg)}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Airwallex ${path.split("?")[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// El comercio de las compras con tarjeta vive en la API de Issuing;
// su transaction_id coincide con el id del financial_transaction. No fatal.
async function awxMerchants(cfg, token, since) {
  const merchants = new Map();
  let pageNum = 0;
  while (true) {
    const params = new URLSearchParams({
      from_created_at: since.toISOString(), page_num: String(pageNum), page_size: "100",
    });
    const data = await awxGet(cfg, token, `/api/v1/issuing/transactions?${params}`);
    const items = data.items ?? [];
    for (const t of items) {
      const m = t.merchant;
      if (!m) continue;
      const name = m.additional_merchant_info?.merchant_full_name ??
        m.name?.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      if (name) merchants.set(t.transaction_id, name);
    }
    if (!data.has_more || items.length === 0) break;
    pageNum += 1;
  }
  return merchants;
}

async function syncAirwallex(cfg, data, since, rates, summary) {
  const token = await awxToken(cfg);

  // Saldos: el wallet es multi-divisa → una cuenta por divisa con saldo,
  // filtrando las ~50 divisas a 0 (salvo que ya estén trackeadas).
  const balances = await awxGet(cfg, token, "/api/v1/balances/current");
  for (const b of balances) {
    const id = "awx-" + b.currency;
    const existing = (data.cuentas || []).find((c) => c.id === id);
    if (!existing && !(Number(b.total_amount) || 0)) continue;
    const saldoEur = round2(toEur(b.total_amount, b.currency, rates));
    if (existing) {
      existing.saldo = saldoEur;
      existing.divisa = b.currency;
      existing.saldo_original = b.total_amount;
      existing.updated = new Date().toISOString().slice(0, 10);
    } else {
      data.cuentas.push({
        id, nombre: `Airwallex ${b.currency}`, tipo: "banco", provider: "airwallex",
        saldo: saldoEur, divisa: b.currency, saldo_original: b.total_amount,
        updated: new Date().toISOString().slice(0, 10),
      });
      summary.cuentas_nuevas++;
    }
  }

  const merchants = await awxMerchants(cfg, token, since).catch(() => new Map());
  const seen = new Set((data.finanzas || []).map((m) => m.ext_id).filter(Boolean));
  let pageNum = 0;
  while (true) {
    const params = new URLSearchParams({
      from_created_at: since.toISOString(), page_num: String(pageNum), page_size: "200",
    });
    const body = await awxGet(cfg, token, `/api/v1/financial_transactions?${params}`);
    const items = body.items ?? [];
    for (const t of items) {
      const type = t.transaction_type ?? t.source_type;
      // holds/releases de tarjeta se cancelan entre sí — el gasto real es ISSUING_CAPTURE
      if (type === "ISSUING_AUTHORISATION_HOLD" || type === "ISSUING_AUTHORISATION_RELEASE") continue;
      if (type?.startsWith("CONVERSION_")) continue; // interno: no es flujo
      if (t.status === "CANCELLED") continue;
      const extId = "awx-" + t.id;
      if (seen.has(extId)) continue;
      seen.add(extId);
      const eur = round2(toEur(Math.abs(t.amount), t.currency, rates));
      data.finanzas.push({
        fecha: (t.settled_at ?? t.created_at).slice(0, 10),
        concepto: merchants.get(t.id) ?? t.description ?? AWX_FRIENDLY[type] ?? type ?? "Movimiento Airwallex",
        importe: eur,
        tipo: t.amount > 0 ? "ingreso" : "gasto",
        cuenta: "Airwallex",
        ext_id: extId,
        ...(t.currency !== "EUR" ? { divisa: t.currency, importe_original: Math.abs(t.amount) } : {}),
      });
      summary.movimientos++;
    }
    if (!body.has_more || items.length === 0) break;
    pageNum += 1;
  }
}

/* ---------- Mercury ---------- */
async function mercuryGet(cfg, path) {
  const res = await fetch(`https://api.mercury.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`Mercury ${path.split("?")[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function syncMercury(cfg, data, since, rates, summary) {
  const accounts = ((await mercuryGet(cfg, "/accounts")).accounts || []).filter((a) => a.status !== "archived");
  for (const a of accounts) {
    const id = "mcy-" + a.id;
    const existing = (data.cuentas || []).find((c) => c.id === id);
    const saldoEur = round2(toEur(a.currentBalance, "USD", rates));
    if (existing) {
      existing.saldo = saldoEur;
      existing.divisa = "USD";
      existing.saldo_original = a.currentBalance;
      existing.updated = new Date().toISOString().slice(0, 10);
    } else {
      data.cuentas.push({
        id, nombre: `Mercury ${String(a.name || "").replace(/^Mercury\s+/i, "")}`, tipo: "banco", provider: "mercury",
        saldo: saldoEur, divisa: "USD", saldo_original: a.currentBalance,
        updated: new Date().toISOString().slice(0, 10),
      });
      summary.cuentas_nuevas++;
    }
  }

  const seen = new Set((data.finanzas || []).map((m) => m.ext_id).filter(Boolean));
  for (const a of accounts) {
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        start: since.toISOString().slice(0, 10), limit: "500", offset: String(offset),
      });
      const body = await mercuryGet(cfg, `/account/${a.id}/transactions?${params}`);
      const txs = body.transactions || [];
      for (const t of txs) {
        if (t.kind === "internalTransfer") continue;
        if (t.status === "cancelled" || t.status === "failed") continue;
        const extId = "mcy-" + t.id;
        if (seen.has(extId)) continue;
        seen.add(extId);
        const eur = round2(toEur(Math.abs(t.amount), "USD", rates));
        data.finanzas.push({
          fecha: (t.postedAt ?? t.createdAt).slice(0, 10),
          concepto: t.counterpartyName ?? t.note ?? t.bankDescription ?? "Movimiento Mercury",
          importe: eur,
          tipo: t.amount > 0 ? "ingreso" : "gasto",
          cuenta: `Mercury ${String(a.name || "").replace(/^Mercury\s+/i, "")}`,
          ext_id: extId,
          divisa: "USD",
          importe_original: Math.abs(t.amount),
        });
        summary.movimientos++;
      }
      offset += txs.length;
      if (offset >= (body.total || 0) || txs.length === 0) break;
    }
  }
}

/* ---------- Enable Banking: bancos españoles y europeos por PSD2 (13 oct 2026) ----------
   Modo «producción restringida»: gratis, sin eIDAS, solo las cuentas que el propio usuario enlaza.
   Sin tokens: cada petición lleva un JWT RS256 firmado con la clave privada de la aplicación.
   La clave privada se guarda CIFRADA (AES-256-GCM con una clave derivada del secreto del servidor). */
const EB_BASE = "https://api.enablebanking.com";

export function encryptSecret(text, secret) {
  const key = scryptSync(String(secret), "daily-system-eb", 32);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: enc.toString("base64") };
}
export function decryptSecret(obj, secret) {
  if (!obj?.iv || !obj?.tag || !obj?.data) return null;
  const key = scryptSync(String(secret), "daily-system-eb", 32);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(obj.iv, "base64"));
  d.setAuthTag(Buffer.from(obj.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(obj.data, "base64")), d.final()]).toString("utf8");
}

export class EbError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  get expired() { return this.status === 401 || this.code === "EXPIRED_SESSION" || this.code === "SESSION_EXPIRED"; }
  get rateLimited() { return this.status === 429 || this.code === "ASPSP_RATE_LIMIT_EXCEEDED"; }
}

const b64url = (x) => Buffer.from(x).toString("base64url");
export function ebSignJwt(applicationId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: applicationId }));
  const payload = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const pem = String(privateKeyPem).replace(/\\n/g, "\n").trim();
  return `${header}.${payload}.${b64url(signer.sign(pem))}`;
}

/* cfg = { application_id, private_key } (clave ya descifrada); psu = { ip, userAgent } marca la petición como "online" */
export async function ebRequest(cfg, path, init = {}, psu) {
  const headers = { Authorization: `Bearer ${ebSignJwt(cfg.application_id, cfg.private_key)}`, "Content-Type": "application/json", ...(init.headers || {}) };
  if (psu?.ip) headers["psu-ip-address"] = psu.ip;
  if (psu?.userAgent) headers["psu-user-agent"] = psu.userAgent;
  const res = await fetch(`${EB_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    let code, message = text;
    try { const b = JSON.parse(text); code = b.error ?? b.code; message = b.message ?? b.error ?? text; } catch (e) {}
    throw new EbError(`Enable Banking ${path.split("?")[0]}: ${res.status} ${message}`.slice(0, 400), res.status, code);
  }
  return text ? JSON.parse(text) : {};
}

/* credenciales descifradas a partir de integraciones.enablebanking */
export function ebCreds(integ, secret) {
  const eb = integ?.enablebanking;
  if (!eb?.application_id || !eb?.private_key_enc) return null;
  const pem = decryptSecret(eb.private_key_enc, secret);
  return pem ? { application_id: eb.application_id, private_key: pem } : null;
}

export const ebAspsps = async (cfg, country = "ES") => ((await ebRequest(cfg, `/aspsps?country=${encodeURIComponent(country)}`)).aspsps || []);
export const ebStartAuth = (cfg, { aspspName, country, redirectUrl, state, validUntil, psu }) => ebRequest(cfg, "/auth", {
  method: "POST",
  body: JSON.stringify({ access: { valid_until: validUntil.toISOString() }, aspsp: { name: aspspName, country }, state, redirect_url: redirectUrl, psu_type: "personal", language: "es" }),
}, psu);
export const ebCreateSession = (cfg, code, psu) => ebRequest(cfg, "/sessions", { method: "POST", body: JSON.stringify({ code }) }, psu);
export const ebCloseSession = (cfg, id) => ebRequest(cfg, `/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
export const ebApplication = (cfg) => ebRequest(cfg, "/application");

/* Ojo: muchos bancos (BBVA entre ellos) mandan el nombre del TITULAR como nombre de todas las cuentas:
   el producto y los últimos dígitos del IBAN son lo que las distingue. */
export function ebNombreCuenta(aspspName, a) {
  const producto = (a.product || a.name || aspspName || "Cuenta").trim();
  const iban = a.account_id?.iban || a.iban || "";
  return `${producto}${iban ? ` ••${iban.slice(-4)}` : ""}`;
}

function ebImporte(t) {
  const raw = Math.abs(Number(t.transaction_amount?.amount) || 0);
  return t.credit_debit_indicator === "DBIT" ? -raw : raw;
}
function ebFecha(t) { return (t.booking_date || t.value_date || t.transaction_date || new Date().toISOString()).slice(0, 10); }
function ebConcepto(t) {
  const rem = (t.remittance_information || []).filter(Boolean).join(" ").trim();
  const cp = (t.credit_debit_indicator === "DBIT" ? t.creditor?.name : t.debtor?.name)?.trim();
  return cp && rem ? `${cp} · ${rem}`.slice(0, 160) : (cp || rem || t.note?.trim() || t.bank_transaction_code?.description?.trim() || "Movimiento").slice(0, 160);
}
/* muchos bancos no mandan entry_reference: id estable por huella del movimiento (no duplica al resincronizar) */
function ebExtId(uid, t, seen) {
  if (t.entry_reference) return `eb-${uid}:${t.entry_reference}`;
  const h = createHash("sha1").update([uid, t.booking_date || t.value_date || "", t.transaction_amount?.amount, t.credit_debit_indicator, ebConcepto(t)].join("|")).digest("hex").slice(0, 20);
  const n = (seen.get(h) || 0) + 1; seen.set(h, n);
  return n === 1 ? `eb-${uid}:h${h}` : `eb-${uid}:h${h}#${n}`;
}

async function ebTransacciones(cfg, uid, dateFrom, strategy, psu) {
  const out = []; let key;
  for (let page = 0; page < 60; page++) {
    const qs = new URLSearchParams({ date_from: dateFrom.toISOString().slice(0, 10), strategy });
    if (key) qs.set("continuation_key", key);
    const d = await ebRequest(cfg, `/accounts/${encodeURIComponent(uid)}/transactions?${qs}`, {}, psu);
    out.push(...(d.transactions || []));
    if (!d.continuation_key) break;
    key = d.continuation_key;
  }
  return out;
}

/* sincroniza todas las sesiones activas. Los fallos son por banco: uno caducado no para a los demás. */
export async function syncEnableBanking(cfg, integ, data, rates, summary, psu) {
  const eb = integ.enablebanking;
  const hoy = new Date().toISOString().slice(0, 10);
  for (const ses of eb.sessions || []) {
    if (ses.status !== "active") continue;
    if (ses.valid_until && new Date(ses.valid_until) < new Date()) { ses.status = "expired"; summary.errores.push(`${ses.aspsp}: consentimiento caducado, hay que reautorizar`); continue; }
    try {
      const seen = new Set((data.finanzas || []).map((m) => m.ext_id).filter(Boolean));
      for (const a of ses.accounts || []) {
        const nombre = a.nombre || ebNombreCuenta(ses.aspsp, a);
        const divisa = a.currency || "EUR";
        // saldos: CLBD = contable · XPCD/ITAV = disponible; nos quedamos con el contable si existe
        const bal = (await ebRequest(cfg, `/accounts/${encodeURIComponent(a.uid)}/balances`, {}, psu)).balances || [];
        const pick = (t) => bal.find((b) => b.balance_type === t)?.balance_amount;
        const amt = pick("CLBD") || pick("CLAV") || pick("XPCD") || pick("ITAV") || bal[0]?.balance_amount;
        const saldoOrig = amt ? Number(amt.amount) : null;
        const id = "eb-" + a.uid;
        let cuenta = (data.cuentas || []).find((c) => c.id === id);
        if (!cuenta) { cuenta = { id, nombre, tipo: "banco", provider: "enablebanking", banco: ses.aspsp, divisa }; data.cuentas.push(cuenta); summary.cuentas_nuevas++; }
        if (saldoOrig != null && Number.isFinite(saldoOrig)) { cuenta.saldo = round2(toEur(saldoOrig, divisa, rates)); cuenta.saldo_original = saldoOrig; }
        cuenta.divisa = divisa; cuenta.banco = ses.aspsp; cuenta.updated = hoy;
        // movimientos: la primera vez pedimos el máximo de historial (la ventana de la primera hora); después, solape de 10 días
        const primera = !ses.first_sync_done;
        const desde = primera ? new Date(Date.now() - 3 * 365 * 86400000) : new Date(new Date(ses.last_sync || Date.now()).getTime() - 10 * 86400000);
        const txs = await ebTransacciones(cfg, a.uid, desde, primera ? "longest" : "default", psu);
        const hashes = new Map();
        for (const t of txs) {
          if (t.status === "RJCT") continue;
          const extId = ebExtId(a.uid, t, hashes);
          if (seen.has(extId)) continue;
          seen.add(extId);
          const imp = ebImporte(t);
          const mov = { fecha: ebFecha(t), concepto: ebConcepto(t), importe: round2(toEur(Math.abs(imp), divisa, rates)), tipo: imp >= 0 ? "ingreso" : "gasto", cuenta: nombre, ext_id: extId };
          if (divisa !== "EUR") { mov.divisa = divisa; mov.importe_original = Math.abs(imp); }
          if (t.status === "PDNG") mov.pendiente = true;
          data.finanzas.push(mov);
          summary.movimientos++;
        }
      }
      ses.first_sync_done = true; ses.last_sync = new Date().toISOString(); delete ses.last_error;
    } catch (e) {
      if (e instanceof EbError && e.expired) { ses.status = "expired"; ses.last_error = "Consentimiento caducado: vuelve a autorizar el banco."; summary.errores.push(`${ses.aspsp}: consentimiento caducado, hay que reautorizar`); }
      else if (e instanceof EbError && e.rateLimited) { ses.last_error = "El banco limitó las consultas; reintenta en unas horas."; summary.errores.push(`${ses.aspsp}: límite del banco, reintenta en unas horas`); }
      else { ses.last_error = String(e.message || e).slice(0, 300); summary.errores.push(`${ses.aspsp}: ${String(e.message || e).slice(0, 160)}`); }
    }
  }
}

/* ---------- API pública del módulo ---------- */
export function providerStatus(integraciones) {
  const awx = integraciones?.airwallex || {};
  const mcy = integraciones?.mercury || {};
  return {
    airwallex: {
      configured: Boolean(awx.client_id && awx.api_key),
      client_id: awx.client_id || null,
      api_key_last4: awx.api_key ? awx.api_key.slice(-4) : null,
      base: awx.base === "demo" ? "demo" : "prod",
    },
    mercury: {
      configured: Boolean(mcy.token),
      token_last4: mcy.token ? mcy.token.slice(-4) : null,
    },
    enablebanking: (() => {
      const eb = integraciones?.enablebanking || {};
      const dias = (v) => v ? Math.ceil((new Date(v) - Date.now()) / 86400000) : null;
      return {
        configured: Boolean(eb.application_id && eb.private_key_enc),
        application_id: eb.application_id || null,
        sessions: (eb.sessions || []).map((s) => ({ id: s.id, aspsp: s.aspsp, country: s.country, status: s.status, valid_until: s.valid_until || null, dias_restantes: dias(s.valid_until), last_sync: s.last_sync || null, last_error: s.last_error || null, cuentas: (s.accounts || []).map((a) => ({ uid: a.uid, nombre: a.nombre, divisa: a.currency })) })),
        last_error: eb.last_error || null,
      };
    })(),
    last_sync: integraciones?.last_sync || null,
    last_result: integraciones?.last_result || null,
  };
}

export async function testProviders(integraciones, secret) {
  const out = {};
  const ebc = secret ? ebCreds(integraciones, secret) : null;
  if (ebc) {
    try { const app = await ebApplication(ebc); out.enablebanking = { ok: true, nombre: app.name || null, entorno: app.environment || null }; }
    catch (e) { out.enablebanking = { ok: false, error: e.message }; }
  } else {
    out.enablebanking = { ok: false, error: "sin configurar" };
  }
  const awx = integraciones?.airwallex;
  if (awx?.client_id && awx?.api_key) {
    try { await awxToken(awx); out.airwallex = { ok: true }; }
    catch (e) { out.airwallex = { ok: false, error: e.message }; }
  } else {
    out.airwallex = { ok: false, error: "sin configurar" };
  }
  const mcy = integraciones?.mercury;
  if (mcy?.token) {
    try {
      const accs = await mercuryGet(mcy, "/accounts");
      out.mercury = { ok: true, cuentas: (accs.accounts || []).length };
    } catch (e) { out.mercury = { ok: false, error: e.message }; }
  } else {
    out.mercury = { ok: false, error: "sin configurar" };
  }
  return out;
}

export async function runSync(data, psu, secret) {
  const integ = data.integraciones || {};
  if (!Array.isArray(data.cuentas)) data.cuentas = [];
  if (!Array.isArray(data.finanzas)) data.finanzas = [];

  // primer sync: 365 días; siguientes: solape de 7 días sobre el último
  const since = integ.last_sync
    ? new Date(new Date(integ.last_sync).getTime() - 7 * 24 * 3600 * 1000)
    : new Date(Date.now() - 365 * 24 * 3600 * 1000);

  await syncFxRates(data);
  const rates = data.fx_rates || { EUR: 1 };

  const summary = { movimientos: 0, cuentas_nuevas: 0, errores: [] };
  if (integ.airwallex?.client_id && integ.airwallex?.api_key) {
    try { await syncAirwallex(integ.airwallex, data, since, rates, summary); }
    catch (e) { summary.errores.push("Airwallex: " + e.message); }
  }
  if (integ.mercury?.token) {
    try { await syncMercury(integ.mercury, data, since, rates, summary); }
    catch (e) { summary.errores.push("Mercury: " + e.message); }
  }
  const ebc = secret ? ebCreds(integ, secret) : null;
  if (ebc && (integ.enablebanking?.sessions || []).length) {
    try { await syncEnableBanking(ebc, integ, data, rates, summary, psu); }
    catch (e) { summary.errores.push("Enable Banking: " + e.message); }
  }

  data.finanzas.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  integ.last_sync = new Date().toISOString();
  integ.last_result = { ...summary, fecha: integ.last_sync };
  data.integraciones = integ;
  return summary;
}
