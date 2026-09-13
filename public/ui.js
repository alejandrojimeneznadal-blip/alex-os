/* Sidebar compartido + navegación. Cada página lo incluye con <script src="/ui.js"></script>.
   Estilo claro (referencia Cashora/Muzli): sidebar blanco, item activo con barra índigo.
   En desktop: barra fija a la izquierda (padding-left en html).
   En móvil: off-canvas con botón ☰ (se inserta en .top-bar si existe, si no crea una barra superior). */
(function () {
  const SBW = 228;

  // iconos Tabler inlineados en /icons.js (debe cargarse antes que ui.js)
  const I = window.OSIcons || {};
  const ic = (k, fb) => I[k] || `<span>${fb}</span>`;

  const SECTIONS = [
    { href: "/", label: "Panel", icon: ic("panel", "◱") },
    { href: "/chat.html", label: "Chat", icon: ic("chat", "✳") },
    { group: "Áreas" },
    { href: "/areas.html#tareas", label: "Tareas", icon: ic("tareas", "☑") },
    { href: "/areas.html#sueno", label: "Sueño", icon: ic("sueno", "☾") },
    { href: "/areas.html#gym", label: "Gym", icon: ic("gym", "⚓") },
    { href: "/areas.html#nutricion", label: "Nutrición", icon: ic("nutricion", "◇") },
    { href: "/areas.html#proyectos", label: "Proyectos", icon: ic("proyectos", "▣") },
    { href: "/areas.html#contenido", label: "Contenido", icon: ic("contenido", "▶") },
    // Finanzas oculta por ahora (28 ago 2026, decisión de Alex) — para reactivarla, descomenta:
    // { href: "/areas.html#finanzas", label: "Finanzas", icon: ic("finanzas", "€") },
    { group: "Sistema" },
    { href: "/config.html", label: "Configuración", icon: ic("config", "⚙") },
  ];

  const css = `
    :root { --sbw: ${SBW}px; }
    @view-transition { navigation: auto; }
    ::view-transition-old(root), ::view-transition-new(root) { animation-duration: 0.12s; }
    /* el sidebar es idéntico en todas las páginas: se congela durante la transición
       (grupo propio sin animación) para que no parpadee con el crossfade */
    #sidebar { view-transition-name: os-sidebar; }
    ::view-transition-group(os-sidebar) { animation: none; }
    ::view-transition-image-pair(os-sidebar) { animation: none; }
    ::view-transition-old(os-sidebar) { animation: none; opacity: 0; }
    ::view-transition-new(os-sidebar) { animation: none; opacity: 1; }
    #sidebar {
      position: fixed; top: 0; left: 0; bottom: 0; width: var(--sbw);
      background: var(--surface); border-right: 1px solid var(--border);
      display: flex; flex-direction: column; z-index: 90;
      padding: 20px 14px calc(16px + env(safe-area-inset-bottom));
      transition: transform 0.22s ease;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    #sidebar .sb-brand {
      display: flex; align-items: center; gap: 10px;
      font-size: 16px; font-weight: 750; letter-spacing: -0.01em; color: var(--ink);
      padding: 2px 8px 20px;
    }
    #sidebar .sb-brand .logo {
      width: 34px; height: 34px; border-radius: 11px; flex-shrink: 0;
      background: linear-gradient(135deg, var(--accent-2), var(--accent));
      color: #fff; font-size: 16px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
    }
    #sidebar .sb-brand small { color: var(--ink-3); font-weight: 500; }
    #sidebar .sb-group {
      font-size: 10.5px; color: var(--ink-3); text-transform: uppercase;
      letter-spacing: 0.09em; padding: 16px 10px 7px; font-weight: 600;
    }
    #sidebar a.sb-item {
      position: relative;
      display: flex; align-items: center; gap: 11px;
      color: var(--ink-2); text-decoration: none; font-size: 13.5px; font-weight: 500;
      padding: 9px 11px; border-radius: 10px; margin-bottom: 2px;
    }
    #sidebar a.sb-item .ic { width: 17px; height: 17px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink-3); flex-shrink: 0; }
    .tic { width: 100%; height: 100%; }
    #sidebar a.sb-item .ic .tic, #sb-burger .tic { width: 17px; height: 17px; }
    .sb-logout .tic { width: 14px; height: 14px; vertical-align: -2px; margin-right: 7px; }
    #sidebar a.sb-item:hover { color: var(--ink); background: var(--surface-2); }
    #sidebar a.sb-item.active { color: var(--ink); background: var(--sb-active); font-weight: 650; }
    #sidebar a.sb-item.active::before {
      content: ""; position: absolute; left: -14px; top: 8px; bottom: 8px; width: 3.5px;
      background: var(--accent); border-radius: 0 4px 4px 0;
    }
    #sidebar a.sb-item.active .ic { color: var(--accent); }
    #sidebar .sb-foot { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--hairline); }
    #sidebar .sb-logout {
      display: block; width: 100%; background: transparent; border: none; color: var(--ink-3);
      font-family: inherit; font-size: 12.5px; text-align: left; padding: 8px 11px;
      border-radius: 10px; cursor: pointer; font-weight: 500;
    }
    #sidebar .sb-logout:hover { color: var(--bad); background: var(--bad-bg); }
    html { padding-left: var(--sbw); }
    #sb-overlay { display: none; }
    #sb-burger {
      display: none; background: var(--surface); border: 1px solid var(--border);
      color: var(--ink-2); height: 34px; min-width: 34px; border-radius: 10px; cursor: pointer;
      font-size: 15px; align-items: center; justify-content: center; font-family: inherit; flex-shrink: 0;
    }
    #sb-burger:hover { color: var(--ink); }
    .sb-topbar {
      display: none; align-items: center; gap: 10px;
      padding: 12px 16px; padding-top: max(12px, env(safe-area-inset-top));
      background: var(--surface); border-bottom: 1px solid var(--border);
    }
    .sb-topbar .t { font-size: 14px; font-weight: 750; color: var(--ink); }
    .sb-topbar .t small { color: var(--ink-3); font-weight: 500; }
    @media (max-width: 900px) {
      html { padding-left: 0; }
      #sidebar { transform: translateX(-100%); box-shadow: 0 0 44px rgba(23,23,40,0.18); }
      #sidebar.open { transform: translateX(0); }
      #sb-overlay.show { display: block; position: fixed; inset: 0; background: rgba(23,23,30,0.35); z-index: 80; }
      #sb-burger { display: inline-flex; }
      .sb-topbar { display: flex; }
    }
  `;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const nav = document.createElement("nav");
  nav.id = "sidebar";
  nav.innerHTML =
    `<div class="sb-brand"><span class="logo">A</span><span>Alex<small> / OS</small></span></div>` +
    SECTIONS.map((s) => s.group
      ? `<div class="sb-group">${s.group}</div>`
      : `<a class="sb-item" href="${s.href}"><span class="ic">${s.icon}</span>${s.label}</a>`
    ).join("") +
    `<div class="sb-foot"><button class="sb-logout" id="sbLogout">${ic("salir", "←")} Salir</button></div>`;
  document.body.appendChild(nav);

  const overlay = document.createElement("div");
  overlay.id = "sb-overlay";
  document.body.appendChild(overlay);

  function openSb() { nav.classList.add("open"); overlay.classList.add("show"); }
  function closeSb() { nav.classList.remove("open"); overlay.classList.remove("show"); }
  overlay.onclick = closeSb;

  // burger: dentro de .top-bar si la página tiene una (chat); si no, barra superior propia.
  // Se monta en DOMContentLoaded porque ui.js se carga al PRINCIPIO del body
  // (así el sidebar existe antes de que se pinte el contenido y no hay salto).
  function initBurger() {
    const burger = document.createElement("button");
    burger.id = "sb-burger";
    burger.innerHTML = ic("menu", "☰");
    const topBar = document.querySelector(".top-bar");
    if (topBar) {
      topBar.insertBefore(burger, topBar.firstChild);
    } else {
      const tb = document.createElement("div");
      tb.className = "sb-topbar";
      tb.appendChild(burger);
      const t = document.createElement("div");
      t.className = "t";
      t.innerHTML = `Alex<small> / OS</small>`;
      tb.appendChild(t);
      document.body.insertBefore(tb, document.body.firstChild);
    }
    burger.onclick = () => (nav.classList.contains("open") ? closeSb() : openSb());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initBurger);
  else initBurger();

  function setActive() {
    const here = location.pathname + location.hash;
    let best = null;
    nav.querySelectorAll("a.sb-item").forEach((a) => {
      a.classList.remove("active");
      const href = a.getAttribute("href");
      if (href === here) best = a;
    });
    if (!best) {
      // sub-secciones por hash (p.ej. #finanzas/cuentas activa Finanzas)
      nav.querySelectorAll("a.sb-item").forEach((a) => {
        const href = a.getAttribute("href");
        if (!best && href.includes("#") && here.startsWith(href + "/")) best = a;
      });
    }
    if (!best) {
      // sin hash: primera entrada de la página actual
      nav.querySelectorAll("a.sb-item").forEach((a) => {
        const href = a.getAttribute("href");
        if (!best && href.split("#")[0] === location.pathname) best = a;
      });
      if (!best && location.pathname === "/index.html") best = nav.querySelector('a[href="/"]');
    }
    if (best) best.classList.add("active");
  }
  window.addEventListener("hashchange", () => { setActive(); closeSb(); });
  setActive();

  nav.querySelectorAll("a.sb-item").forEach((a) => {
    a.addEventListener("click", () => setTimeout(closeSb, 50));
  });

  document.getElementById("sbLogout").onclick = async () => {
    try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch (e) {}
    location.href = "/login.html";
  };
})();

/* ---------- OSUI: formularios y desplegables internos (nada del navegador) ---------- */
(function () {
  const I = window.OSIcons || {};
  const css = `
    .osel { position: relative; }
    .osel > select { display: none !important; }
    .osel-btn {
      width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
      background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      color: var(--ink); font-family: inherit; font-size: 14px; padding: 9px 11px; cursor: pointer; text-align: left;
    }
    .osel-btn:focus { outline: none; border-color: var(--accent); }
    .osel-btn .tic { width: 14px; height: 14px; color: var(--ink-3); flex-shrink: 0; transition: transform 0.15s; }
    .osel.open .osel-btn { border-color: var(--accent); }
    .osel.open .osel-btn .tic { transform: rotate(180deg); }
    .osel-menu {
      position: absolute; left: 0; right: 0; top: calc(100% + 5px); z-index: 320;
      background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
      box-shadow: 0 10px 30px rgba(23,23,40,0.16); padding: 5px; max-height: 240px; overflow: auto;
    }
    .osel-menu button {
      display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px;
      background: none; border: none; font-family: inherit; font-size: 13.5px;
      color: var(--ink-2); padding: 8px 10px; border-radius: 8px; cursor: pointer; text-align: left;
    }
    .osel-menu button:hover { background: var(--surface-2); color: var(--ink); }
    .osel-menu button.sel { color: var(--accent); font-weight: 600; }
    .osel-menu button.sel .tic { width: 13px; height: 13px; }

    .osui-ov {
      position: fixed; inset: 0; background: rgba(23,23,30,0.35); z-index: 400;
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .osui-card {
      background: var(--surface); border-radius: 18px; padding: 20px; width: 100%; max-width: 340px;
      box-shadow: 0 20px 60px rgba(23,23,40,0.25);
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .osui-card h3 { font-size: 15px; font-weight: 650; letter-spacing: -0.01em; color: var(--ink); }
    .osui-card .txt { font-size: 13px; color: var(--ink-3); margin-top: 6px; line-height: 1.5; }
    .osui-card label { display: block; font-size: 11px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.07em; margin: 13px 0 5px 2px; }
    .osui-card select {
      width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      color: var(--ink); font-family: inherit; font-size: 14px; padding: 9px 11px;
    }
    .osui-card input {
      width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      color: var(--ink); font-family: inherit; font-size: 14px; padding: 9px 11px;
    }
    .osui-card input:focus { outline: none; border-color: var(--accent); }
    .osui-card input::placeholder { color: var(--placeholder); }
    .osui-btns { display: flex; gap: 8px; margin-top: 18px; justify-content: flex-end; }
    .osui-btns button {
      background: var(--surface); border: 1px solid var(--border); color: var(--ink-2);
      border-radius: 10px; padding: 8px 15px; font-size: 13.5px; font-weight: 500; cursor: pointer; font-family: inherit;
    }
    .osui-btns button:hover { color: var(--ink); border-color: var(--border-strong); }
    .osui-btns button.primary { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 600; }
    .osui-btns button.danger { background: var(--bad); color: #fff; border-color: var(--bad); font-weight: 600; }
    .osui-btns button.danger-ghost { color: var(--bad); border-color: transparent; background: transparent; padding-left: 4px; }
    .osui-btns button.danger-ghost:hover { color: var(--bad); border-color: var(--bad); }
    .osui-dw { position: relative; }
    .osui-dw input { cursor: pointer; caret-color: transparent; }
    .osui-cal {
      position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; width: 256px;
      background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
      padding: 10px; box-shadow: 0 16px 50px rgba(0,0,0,0.22);
    }
    .osui-cal .cal-h { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 8px; }
    .osui-cal .cal-t { font-size: 13px; font-weight: 600; color: var(--ink); }
    .osui-cal .cal-nav { display: flex; gap: 2px; }
    .osui-cal .cal-nav button {
      background: transparent; border: none; color: var(--ink-3); cursor: pointer;
      width: 26px; height: 26px; border-radius: 7px; font-size: 15px; font-family: inherit;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .osui-cal .cal-nav button:hover { background: var(--surface-2); color: var(--ink); }
    .osui-cal .cal-g { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
    .osui-cal .cal-d { font-size: 10px; color: var(--ink-3); text-align: center; font-weight: 650; padding: 3px 0; }
    .osui-cal .cal-c {
      background: transparent; border: none; color: var(--ink); font-size: 12.5px;
      height: 30px; border-radius: 8px; cursor: pointer; font-family: inherit;
    }
    .osui-cal .cal-c:hover { background: var(--surface-2); }
    .osui-cal .cal-c.hoy { box-shadow: inset 0 0 0 1px var(--border-strong, var(--border)); }
    .osui-cal .cal-c.sel { background: var(--accent); color: #fff; font-weight: 600; }
    .osui-cal .cal-f { display: flex; justify-content: flex-end; gap: 4px; margin-top: 6px; }
    .osui-cal .cal-f button {
      background: transparent; border: none; color: var(--accent); font-size: 12px; font-weight: 550;
      cursor: pointer; font-family: inherit; padding: 4px 7px; border-radius: 6px;
    }
    .osui-cal .cal-f button:hover { background: var(--accent-soft, var(--surface-2)); }
    .osui-cal.meses { width: 236px; }
    .osui-cal .cal-mg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
    .osui-cal .cal-m {
      background: transparent; border: none; color: var(--ink); font-size: 12.5px;
      height: 34px; border-radius: 9px; cursor: pointer; font-family: inherit;
    }
    .osui-cal .cal-m:hover:not(:disabled) { background: var(--surface-2); }
    .osui-cal .cal-m.sel { background: var(--accent); color: #fff; font-weight: 600; }
    .osui-cal .cal-m:disabled { opacity: 0.3; cursor: default; }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ----- select custom sincronizado con el <select> nativo (que queda oculto) -----
  function enhanceSelect(sel) {
    if (sel.dataset.osel || sel.closest(".osel")) return;
    sel.dataset.osel = "1";
    const wrap = document.createElement("div");
    wrap.className = "osel";
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "osel-btn";
    wrap.appendChild(btn);
    const label = () => sel.options[sel.selectedIndex]?.text || "";
    const paintBtn = () => { btn.innerHTML = `<span>${label()}</span>${I.chevron || ""}`; };
    paintBtn();
    sel.addEventListener("change", paintBtn);
    let menu = null;
    const close = () => { menu?.remove(); menu = null; wrap.classList.remove("open"); };
    btn.onclick = (e) => {
      e.stopPropagation();
      if (menu) return close();
      document.querySelectorAll(".osel.open").forEach((o) => o.classList.remove("open"));
      document.querySelectorAll(".osel-menu").forEach((m) => m.remove());
      menu = document.createElement("div");
      menu.className = "osel-menu";
      [...sel.options].forEach((op, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = i === sel.selectedIndex ? "sel" : "";
        b.innerHTML = `<span>${op.text}</span>${i === sel.selectedIndex ? (I.check || "") : ""}`;
        b.onclick = () => {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          close();
        };
        menu.appendChild(b);
      });
      wrap.appendChild(menu);
      wrap.classList.add("open");
    };
    document.addEventListener("click", (e) => { if (menu && !wrap.contains(e.target)) close(); });
  }
  function enhanceAll(root) {
    (root.querySelectorAll ? [...root.querySelectorAll("select")] : []).forEach(enhanceSelect);
  }
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) {
      if (n.tagName === "SELECT") enhanceSelect(n);
      else enhanceAll(n);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => enhanceAll(document));
  else enhanceAll(document);

  // ----- modales internos: form / prompt / confirm -----
  function modal(inner) {
    const ov = document.createElement("div");
    ov.className = "osui-ov";
    const card = document.createElement("div");
    card.className = "osui-card";
    card.innerHTML = inner;
    ov.appendChild(card);
    document.body.appendChild(ov);
    return { ov, card };
  }
  function campoHTML(c) {
    const val = String(c.valor ?? "");
    if (c.tipo === "select") {
      const ops = (c.opciones || []).map((o) => {
        const v = typeof o === "object" ? o.v : o;
        const l = typeof o === "object" ? o.l : o;
        return `<option value="${String(v).replace(/"/g, "&quot;")}" ${String(v) === val ? "selected" : ""}>${l}</option>`;
      }).join("");
      return `<label>${c.label || ""}</label><select data-id="${c.id}">${ops}</select>`;
    }
    if (c.tipo === "date") {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : "";
      const disp = iso ? iso.split("-").reverse().join("/") : "";
      return `<label>${c.label || ""}</label><div class="osui-dw"><input class="osui-date" data-id="${c.id}" type="text" readonly data-iso="${iso}" ${c.opcional ? 'data-opt="1"' : ""} value="${disp}" placeholder="${c.opcional ? "sin fecha" : "dd/mm/aaaa"}"></div>`;
    }
    if (c.tipo === "time") {
      return `<label>${c.label || ""}</label><input class="osui-time" data-id="${c.id}" type="text" inputmode="numeric" maxlength="5" value="${val.replace(/"/g, "&quot;")}" placeholder="${c.placeholder || "23:30"}">`;
    }
    return `<label>${c.label || ""}</label><input data-id="${c.id}" type="${c.tipo || "text"}" ${c.tipo === "number" ? 'inputmode="decimal" step="any"' : ""} value="${val.replace(/"/g, "&quot;")}" placeholder="${c.placeholder || ""}">`;
  }

  /* calendario interno para campos date — nada del navegador */
  function initDateInput(input) {
    const wrap = input.parentElement;
    const isoHoy = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const setVal = (iso) => {
      input.dataset.iso = iso;
      input.value = iso ? iso.split("-").reverse().join("/") : "";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    let pop = null;
    const cerrar = () => {
      if (pop) { pop.remove(); pop = null; }
      document.removeEventListener("mousedown", fuera, true);
    };
    const fuera = (e) => { if (!wrap.contains(e.target)) cerrar(); };
    const abrir = () => {
      if (pop) return cerrar();
      const base = input.dataset.iso || isoHoy();
      let view = new Date(base + "T12:00");
      pop = document.createElement("div");
      pop.className = "osui-cal";
      const render = () => {
        const y = view.getFullYear(), m = view.getMonth();
        const start = (new Date(y, m, 1).getDay() + 6) % 7;
        const nDias = new Date(y, m + 1, 0).getDate();
        const hoy = isoHoy();
        const mesTxt = view.toLocaleDateString("es", { month: "long", year: "numeric" });
        let html = `<div class="cal-h"><span class="cal-t">${mesTxt.charAt(0).toUpperCase() + mesTxt.slice(1)}</span><span class="cal-nav"><button type="button" data-n="-1">‹</button><button type="button" data-n="1">›</button></span></div><div class="cal-g">` +
          ["L", "M", "X", "J", "V", "S", "D"].map((d) => `<span class="cal-d">${d}</span>`).join("");
        for (let i = 0; i < start; i++) html += "<span></span>";
        for (let d = 1; d <= nDias; d++) {
          const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          html += `<button type="button" class="cal-c${iso === input.dataset.iso ? " sel" : ""}${iso === hoy ? " hoy" : ""}" data-iso="${iso}">${d}</button>`;
        }
        html += `</div><div class="cal-f"><button type="button" data-a="hoy">Hoy</button>${input.dataset.opt ? `<button type="button" data-a="quitar">Sin fecha</button>` : ""}</div>`;
        pop.innerHTML = html;
        pop.querySelectorAll("[data-n]").forEach((b) => { b.onclick = () => { view.setMonth(view.getMonth() + Number(b.dataset.n)); render(); }; });
        pop.querySelectorAll(".cal-c").forEach((b) => { b.onclick = () => { setVal(b.dataset.iso); cerrar(); }; });
        pop.querySelector('[data-a="hoy"]').onclick = () => { setVal(isoHoy()); cerrar(); };
        const q = pop.querySelector('[data-a="quitar"]');
        if (q) q.onclick = () => { setVal(""); cerrar(); };
      };
      render();
      wrap.appendChild(pop);
      document.addEventListener("mousedown", fuera, true);
    };
    input.addEventListener("click", abrir);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
  }

  /* campo hora con máscara HH:MM — sin picker del navegador */
  function initTimeInput(input) {
    input.addEventListener("input", () => {
      let v = input.value.replace(/[^\d]/g, "").slice(0, 4);
      if (v.length > 2) v = v.slice(0, 2) + ":" + v.slice(2);
      input.value = v;
    });
    input.addEventListener("blur", () => {
      const m = input.value.match(/^(\d{1,2}):?(\d{0,2})$/);
      if (!m) return;
      const h = Math.min(23, Number(m[1]) || 0);
      const min = Math.min(59, Number(m[2] || 0));
      input.value = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    });
  }

  /* borrar: true añade un botón «Borrar» a la izquierda; el form resuelve con la string "borrar" */
  function form({ titulo = "", texto = "", campos = [], ok = "Guardar", danger = false, borrar = false }) {
    return new Promise((resolve) => {
      const inner = `<h3>${titulo}</h3>` +
        (texto ? `<div class="txt">${texto}</div>` : "") +
        campos.map(campoHTML).join("") +
        `<div class="osui-btns">${borrar ? `<button class="danger-ghost" data-a="del" style="margin-right:auto">${borrar === true ? "Borrar" : borrar}</button>` : ""}<button data-a="no">Cancelar</button><button class="${danger ? "danger" : "primary"}" data-a="si">${ok}</button></div>`;
      const { ov, card } = modal(inner);
      card.querySelectorAll("input.osui-date").forEach(initDateInput);
      card.querySelectorAll("input.osui-time").forEach(initTimeInput);
      const done = (val) => { ov.remove(); resolve(val); };
      card.querySelector('[data-a="no"]').onclick = () => done(null);
      const del = card.querySelector('[data-a="del"]');
      if (del) del.onclick = () => done("borrar");
      card.querySelector('[data-a="si"]').onclick = () => {
        const out = {};
        card.querySelectorAll("input[data-id], select[data-id]").forEach((inp) => {
          out[inp.dataset.id] = inp.classList.contains("osui-date") ? (inp.dataset.iso || "") : inp.value;
        });
        done(campos.length ? out : true);
      };
      ov.onclick = (e) => { if (e.target === ov) done(null); };
      const first = card.querySelector("input:not([readonly])");
      if (first) { first.focus(); first.select(); }
      card.onkeydown = (e) => {
        if (e.key === "Enter" && campos.length && e.target.tagName !== "SELECT") card.querySelector('[data-a="si"]').click();
        if (e.key === "Escape") done(null);
      };
    });
  }
  /* selector de mes tipo calendario — popover anclado a un botón */
  function monthPicker(anchor, { valor, habilitados, onSelect } = {}) {
    const existente = document.querySelector(".osui-cal.meses");
    if (existente) { existente.remove(); return; }
    const wrap = anchor.parentElement;
    let year = Number(String(valor || "").slice(0, 4)) || new Date().getFullYear();
    const hab = habilitados && habilitados.length ? new Set(habilitados) : null;
    const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const pop = document.createElement("div");
    pop.className = "osui-cal meses";
    const cerrar = () => { pop.remove(); document.removeEventListener("mousedown", fuera, true); };
    const fuera = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) cerrar(); };
    const render = () => {
      let html = `<div class="cal-h"><span class="cal-t">${year}</span><span class="cal-nav"><button type="button" data-n="-1">‹</button><button type="button" data-n="1">›</button></span></div><div class="cal-mg">`;
      for (let m = 1; m <= 12; m++) {
        const v = `${year}-${String(m).padStart(2, "0")}`;
        html += `<button type="button" class="cal-m${v === valor ? " sel" : ""}" data-v="${v}" ${hab && !hab.has(v) ? "disabled" : ""}>${MESES[m - 1]}</button>`;
      }
      pop.innerHTML = html + `</div>`;
      pop.querySelectorAll("[data-n]").forEach((b) => { b.onclick = () => { year += Number(b.dataset.n); render(); }; });
      pop.querySelectorAll(".cal-m:not([disabled])").forEach((b) => { b.onclick = () => { cerrar(); if (onSelect) onSelect(b.dataset.v); }; });
    };
    render();
    wrap.appendChild(pop);
    document.addEventListener("mousedown", fuera, true);
  }

  window.OSUI = {
    form,
    monthPicker,
    initDate: initDateInput,
    prompt: async (titulo, valor = "", opts = {}) => {
      const r = await form({ titulo, campos: [{ id: "v", label: opts.label || "", valor, placeholder: opts.placeholder || "", tipo: opts.tipo || "text" }], ok: opts.ok || "Guardar" });
      return r === null ? null : r.v;
    },
    confirm: async (titulo, texto = "", opts = {}) =>
      (await form({ titulo, texto, campos: [], ok: opts.ok || "Sí, seguir", danger: opts.danger !== false })) === true,
  };
})();
