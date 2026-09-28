/* Temas de Alex OS — claro (default), crema, azul, negro.
   Se carga al PRINCIPIO del body en todas las páginas (antes de icons.js/ui.js):
   aplica data-theme al <html> antes del primer paint, así no hay flash.
   El tema por defecto (claro) vive en el :root de cada página; aquí van
   los tokens NUEVOS compartidos y las overrides de los otros 3 temas. */
(function () {
  const METAS = { claro: "#f3f3f5", crema: "#f3ede2", azul: "#0d1830", negro: "#0e0e12" };

  const css = `
  /* sin zoom por doble toque (el pellizco lo bloquea el meta viewport) */
  html { touch-action: manipulation; }
  /* móvil compacto: menos aire en paddings y tipografías grandes */
  @media (max-width: 520px) {
    .wrap { padding-left: 12px; padding-right: 12px; padding-top: 14px; }
    .page-title { font-size: 21px; margin-bottom: 10px; }
    .greet h1 { font-size: 22px; }
    .card { padding: 14px; margin-bottom: 12px; border-radius: 15px; }
    .kpis { gap: 8px; }
    .kpi { padding: 12px 13px; }
    .kpi .num { font-size: 21px; }
    .mini-kpis { gap: 8px; }
    .mkpi { padding: 11px 12px; }
    .mkpi .n { font-size: 19px; }
  }
  /* fuera los spinners nativos de los inputs numéricos (cajita blanca que rompe el tema) */
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
  :root {
    --serie-1: #5546e8;
    --serie-2: #1baf7a;
    --grid: #e8e8ee;
    --accent-2: #8a7bf5;
    --accent-soft: #eeecfd;
    --hairline: #f1f1f4;
    --border-strong: #cfcfd8;
    --mark-border: #d3d3db;
    --placeholder: #b3b3bb;
    --ok: #17a171;
    --sb-active: #f1f1f5;
    --warn: #9a6700;
    --warn-bg: #fdf3dc;
    --warn-border: #f3e3b8;
  }
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
