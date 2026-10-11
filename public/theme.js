/* Temas de Alex OS — claro (default), crema, azul, negro.
   Se carga al PRINCIPIO del body en todas las páginas (antes de icons.js/ui.js):
   aplica data-theme al <html> antes del primer paint, así no hay flash.
   El tema por defecto (claro) vive en el :root de cada página; aquí van
   los tokens NUEVOS compartidos y las overrides de los otros 3 temas. */
(function () {
  const METAS = { claro: "#f6f7f9", crema: "#f3ede2", azul: "#0d1830", negro: "#0e0e12" };

  const css = `
  /* sin zoom por doble toque (el pellizco lo bloquea el meta viewport) */
  html { touch-action: manipulation; }
  /* móvil compacto: menos aire en paddings y tipografías grandes */
  @media (max-width: 520px) {
    .wrap { padding-left: 12px; padding-right: 12px; padding-top: 14px; }
    .page-title { font-size: 21px; margin-bottom: 10px; }
    .greet h1 { font-size: 22px; }
    .card { padding: 14px; margin-bottom: 12px; border-radius: 10px; }
    .kpis { gap: 8px; }
    .kpi { padding: 0; }
    .kpi .num { font-size: 20px; }
    .mini-kpis { gap: 8px; }
    .mkpi { padding: 11px 12px; }
    .mkpi .n { font-size: 19px; }
  }
  /* fuera los spinners nativos de los inputs numéricos (cajita blanca que rompe el tema) */
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
  /* ---- Tinta (11 oct 2026): la esencia de Stripe en un solo color. Tema claro por defecto. ---- */
  :root {
    --bg: #f6f7f9; --surface: #ffffff; --surface-2: #f3f4f6; --border: #e3e5e9; --grid: #eceef1;
    --ink: #111318; --ink-2: #2a2d34; --ink-3: #6b7080;
    --accent: #111318; --accent-2: #2a2d34; --accent-soft: #ececef;
    --serie-1: #111318; --serie-2: #0f6e3d;
    --good: #0f6e3d; --good-bg: #dcf5e7; --bad: #b3261e; --bad-bg: #fbe9e7;
    --hairline: #eeeff2; --border-strong: #d3d5da; --mark-border: #c9cbd1; --placeholder: #a6aab4;
    --ok: #111318; --sb-active: transparent;
    --warn: #8a5a00; --warn-bg: #fbf1d6; --warn-border: #eedfae;
    --radius: 8px; --shadow: none;
  }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 700; font-display: swap; src: url(/fonts/inter-latin-ext.woff2) format('woff2'); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 700; font-display: swap; src: url(/fonts/inter-latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
  html, body { font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; }
  .page-title, .greet h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
  .greet, .page-title { padding-bottom: 14px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
  /* bloques: cada apartado es una hoja con borde fino sobre el lienzo gris (distinción sin sombras) */
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; box-shadow: none; }
  .card h2 { font-size: 15px; font-weight: 600; }
  .box .card { border: 1px solid var(--border); border-radius: 10px; padding: 26px 24px; }
  /* KPIs: etiqueta arriba, cifra fina debajo, sin cajas ni iconos de color */
  .kpis { gap: 16px 28px; margin-bottom: 26px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .kpi { background: transparent; border: 0; box-shadow: none; padding: 0; gap: 3px; flex-direction: column-reverse; justify-content: flex-end; }
  .kpi .num { font-size: 22px; font-weight: 400; letter-spacing: -0.01em; }
  .kpi .num small { font-size: 13px; }
  .kpi .lbl { font-size: 13px; color: var(--ink-2); }
  .kpi .mini { display: none; }
  .chart-head .big { font-weight: 400; font-size: 28px; letter-spacing: -0.01em; }
  .curva-datos .v { font-weight: 500; }
  .pill { border-radius: 4px; font-weight: 500; padding: 2px 6px; font-size: 12px; vertical-align: 2px; }
  .mini-btn, .btn-mini, .btn, .btns button, .modal-card .btns button, .toggles button { border-radius: 6px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--ink-2); font-weight: 500; box-shadow: 0 1px 1px rgba(17,19,24,0.04); }
  /* primarios: tinta sobre la hoja → en los temas oscuros la tinta es clara y el texto oscuro */
  .mini-btn.primary, .btn-mini.primary, .btn.primary, button.primary, .btns button.primary, .modal-card .btns button.primary { background: var(--ink); color: var(--surface); border-color: var(--ink); font-weight: 500; }
  .toggles button.active { background: var(--ink); color: var(--surface); border-color: var(--ink); }
  .tooltip { background: var(--ink); color: var(--surface); opacity: 0.96; border-radius: 6px; box-shadow: none; }
  .tooltip b { color: var(--surface); }
  .modal-card { border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 12px 32px rgba(17,19,24,0.12); }
  .modal-card input, .modal-card select { border-radius: 6px; }
  .sec-menu { border-radius: 8px; box-shadow: 0 8px 24px rgba(17,19,24,0.10); }
  .entry .a { color: var(--ink-3); }
  /* crema: papel cálido con acento TERRACOTA — nada de índigo aquí */
  :root[data-theme="crema"] {
    --bg: #f3ede2;
    --surface: #fdfaf3;
    --surface-2: #f1ebde;
    --border: #e7dfcd;
    --grid: #e9e1cf;
    --ink: #211c14;
    --ink-2: #57503f;
    --ink-3: #94886e;
    --accent: #bc5f2e;
    --accent-2: #dd8a55;
    --accent-soft: #f6e3d4;
    --serie-1: #bc5f2e;
    --serie-2: #6f8f3a;
    --good: #4f7d2f;
    --good-bg: #e9efd8;
    --bad: #c43a34;
    --bad-bg: #f8e6de;
    --hairline: #ece5d4;
    --border-strong: #d4c9b0;
    --mark-border: #d6ccb6;
    --placeholder: #b8ad94;
    --ok: #5da04b;
    --sb-active: #f0e9da;
    --warn: #8a5c00;
    --warn-bg: #f6ecc8;
    --warn-border: #e8d9a4;
    --shadow: 0 1px 2px rgba(70,58,35,0.05), 0 8px 24px rgba(70,58,35,0.07);
  }
  /* azul: navy profundo — tema azul FUERTE, hermano azulado del negro */
  :root[data-theme="azul"] {
    --bg: #0d1830;
    --surface: #15233f;
    --surface-2: #1d2d4e;
    --border: #26385c;
    --grid: #22345a;
    --ink: #eef3fb;
    --ink-2: #b9c6dd;
    --ink-3: #7488ab;
    --accent: #4d8dff;
    --accent-2: #7fadff;
    --accent-soft: #1c3157;
    --serie-1: #5d9aff;
    --serie-2: #35d6a2;
    --good: #43d98a;
    --good-bg: #0f2c22;
    --bad: #ff6b6b;
    --bad-bg: #3a1a1e;
    --hairline: #1e2f52;
    --border-strong: #39538a;
    --mark-border: #3b5583;
    --placeholder: #55688f;
    --ok: #35d6a2;
    --sb-active: #1c2c50;
    --warn: #e5b453;
    --warn-bg: #2e2916;
    --warn-border: #4a3f1e;
    --shadow: 0 1px 2px rgba(0,10,30,0.4), 0 8px 24px rgba(0,10,30,0.45);
  }
  :root[data-theme="negro"] {
    --bg: #0e0e12;
    --surface: #17171d;
    --surface-2: #22222a;
    --border: #2a2a33;
    --grid: #26262e;
    --ink: #f2f2f6;
    --ink-2: #c0c0cb;
    --ink-3: #82828f;
    --accent: #7b6cff;
    --accent-2: #9a8cff;
    --accent-soft: #272348;
    --serie-1: #8b7dff;
    --serie-2: #2fd396;
    --good: #43d98a;
    --good-bg: #13291c;
    --bad: #ff6b6b;
    --bad-bg: #331a1a;
    --hairline: #22222a;
    --border-strong: #3a3a46;
    --mark-border: #40404c;
    --placeholder: #5c5c68;
    --ok: #2fd396;
    --sb-active: #232331;
    --warn: #e5b453;
    --warn-bg: #2e2713;
    --warn-border: #4a3f1e;
    --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.45);
  }`;

  /* inputs numéricos: sin cambiar valor con rueda/trackpad y sin negativos */
  document.addEventListener("wheel", () => {
    const el = document.activeElement;
    if (el && el.tagName === "INPUT" && el.type === "number") el.blur();
  }, { passive: true });
  document.addEventListener("keydown", (e) => {
    const el = e.target;
    if (el && el.tagName === "INPUT" && el.type === "number" && (e.key === "-" || e.key === "e" || e.key === "E")) e.preventDefault();
  }, true);
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el && el.tagName === "INPUT" && el.type === "number" && el.value !== "" && Number(el.value) < 0) {
      el.value = String(Math.abs(Number(el.value)));
    }
  }, true);

  const style = document.createElement("style");
  style.id = "os-theme";
  style.textContent = css;
  document.head.appendChild(style);

  function applyMeta(name) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", METAS[name] || METAS.claro);
  }

  const saved = localStorage.getItem("os_theme") || "claro";
  if (saved !== "claro" && METAS[saved]) document.documentElement.dataset.theme = saved;
  applyMeta(saved);

  /* PWA: manifest + iconos + service worker (todas las páginas cargan theme.js) */
  const addHead = (tag, attrs) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.head.appendChild(el);
  };
  if (!document.querySelector('link[rel="manifest"]')) addHead("link", { rel: "manifest", href: "/manifest.json" });
  if (!document.querySelector('link[rel="apple-touch-icon"]')) addHead("link", { rel: "apple-touch-icon", href: "/icon-180.png" });
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) addHead("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
  if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) addHead("meta", { name: "apple-mobile-web-app-status-bar-style", content: "default" });
  if (!document.querySelector('meta[name="apple-mobile-web-app-title"]')) addHead("meta", { name: "apple-mobile-web-app-title", content: "Alex OS" });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  window.OSTheme = {
    get: () => localStorage.getItem("os_theme") || "claro",
    set(name) {
      if (!METAS[name]) return;
      localStorage.setItem("os_theme", name);
      if (name === "claro") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = name;
      applyMeta(name);
    },
    temas: Object.keys(METAS),
  };
})();
