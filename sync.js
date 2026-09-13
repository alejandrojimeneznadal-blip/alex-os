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
    last_sync: integraciones?.last_sync || null,
    last_result: integraciones?.last_result || null,
  };
}

export async function testProviders(integraciones) {
  const out = {};
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

export async function runSync(data) {
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

  data.finanzas.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  integ.last_sync = new Date().toISOString();
  integ.last_result = { ...summary, fecha: integ.last_sync };
  data.integraciones = integ;
  return summary;
}
