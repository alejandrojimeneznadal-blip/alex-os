#!/usr/bin/env node
/* Importa un esquema «Creator Vision» (página HTML con casillas contenteditable marcadas con data-k)
   a la pestaña Instagram → Visión de Daily System.

   Separa la PLANTILLA (estructura y estilos, con las casillas vacías) de los DATOS (lo escrito en cada
   casilla), prefija las clases con «cv-» y deja los estilos bajo .cv con variables --cv-* que el panel
   ata a su tema (claro u oscuro). Cada importación crea una versión nueva: el historial no se borra.

   Uso (necesita playwright instalado en el directorio desde el que se lanza):
     node importar-vision.mjs <archivo.html> <url-del-panel> <usuario:contraseña> ["resumen"]
   Con --solo-json <salida.json> no sube nada: deja el resultado en un fichero para revisarlo. */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const soloJson = args.includes("--solo-json") ? args[args.indexOf("--solo-json") + 1] : null;
const pos = args.filter((a, i) => a !== "--solo-json" && args[i - 1] !== "--solo-json");
const [archivo, base, cred, resumen] = pos;
if (!archivo || (!soloJson && (!base || !cred))) {
  console.error("uso: node importar-vision.mjs <archivo.html> <url-del-panel> <usuario:contraseña> [resumen]  |  <archivo.html> --solo-json <salida.json>");
  process.exit(1);
}
const { chromium } = createRequire(process.cwd() + "/")("playwright");

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto("file://" + path.resolve(archivo));
await page.waitForTimeout(300);

const r = await page.evaluate(() => {
  const wrap = document.querySelector(".wrap");
  if (!wrap) throw new Error("no encuentro el contenedor .wrap del esquema");
  // fuera lo que no es el documento: el guion, la cabecera con «Guardar copia» y la ventana «ver en grande»
  document.querySelectorAll("script").forEach((n) => n.remove());
  wrap.querySelector(":scope > header")?.remove();
  document.getElementById("overlay")?.remove();

  const txt = (n) => (n ? n.textContent.replace(/\s+/g, " ").trim() : "");
  const primerTexto = (n) => {
    if (!n) return "";
    const t = [...n.childNodes].find((c) => c.nodeType === 3 && c.textContent.trim());
    return t ? t.textContent.replace(/\s+/g, " ").trim() : txt(n);
  };
  const corta = (s, n = 70) => (s.length > n ? s.slice(0, n - 1).trim() + "…" : s);
  const antes = (sel, el) => { let m = null; wrap.querySelectorAll(sel).forEach((h) => { if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) m = h; }); return m; };
  const seccionDe = (el) => corta(txt(antes("h2", el)), 80);
  const etiquetaDe = (el) => {
    const pillar = el.closest(".pillar");
    if (pillar) return primerTexto(pillar.querySelector(".name"));
    const sub = el.closest(".sub");
    if (sub) return corta(primerTexto(sub.querySelector(".lab")));
    const story = el.closest(".story");
    if (story) {
      const hermanas = [...story.parentElement.querySelectorAll(":scope > .story")];
      return `Historia ${hermanas.indexOf(story) + 1} · ${primerTexto(el.previousElementSibling) || "parte"}`;
    }
    const td = el.closest("td"), table = el.closest("table");
    if (td && table) {
      const tr = td.parentNode, c = [...tr.cells].indexOf(td);
      const col = txt(table.rows[0]?.cells[c]) || `columna ${c + 1}`;
      const fila = txt(tr.cells[0]) || String([...table.rows].indexOf(tr));
      const h = antes("h2, h3", table);
      return `${corta(txt(h).split(" · ").slice(0, 2).join(" · "), 40)} · fila ${fila} · ${corta(col, 40)}`;
    }
    const grid = el.closest(".ideas .grid");
    if (grid) return `Idea de contenido ${[...grid.querySelectorAll("[data-k]")].indexOf(el) + 1}`;
    const tpl = el.closest(".tpl");
    if (tpl) return `Ganchos · ${corta(txt(tpl.querySelector(".t")) || "libres", 60)}`;
    const prev = el.previousElementSibling;
    return corta(txt(prev) || el.getAttribute("data-ph") || el.dataset.k);
  };

  const campos = [], datos = {};
  wrap.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    campos.push({ k, seccion: seccionDe(el), etiqueta: etiquetaDe(el), tipo: el.querySelector("ol, ul") ? "lista" : el.tagName === "TD" ? "celda" : "texto" });
    if (el.textContent.trim()) datos[k] = el.innerHTML;
    el.innerHTML = "";
    el.removeAttribute("contenteditable");
    el.classList.remove("filled", "clamp");
  });
  // la casilla del pop-up no tenía data-k: si queda alguna editable suelta, fuera la edición
  wrap.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));

  // colores fijos del dibujo (rueda LIFE…) → variables, para que siga al tema del panel
  const MAPA = { "#1c1917": "var(--cv-ink)", "#15803d": "var(--cv-v)", "#22c55e": "var(--cv-vv)", "#ffffff": "var(--cv-paper)", "#fff": "var(--cv-paper)", white: "var(--cv-paper)", "#f5f0e8": "var(--cv-bg)", "#e6f3ea": "var(--cv-soft)", "#6b665c": "var(--cv-muted)", "#d9d2c5": "var(--cv-line)", "#b9b2a4": "var(--cv-dash)" };
  const sinMapear = new Set();
  wrap.querySelectorAll("svg, svg *").forEach((n) => {
    for (const a of ["fill", "stroke"]) {
      const v = (n.getAttribute(a) || "").trim().toLowerCase();
      if (!v || v === "none" || v.startsWith("url(")) continue;
      if (MAPA[v]) { n.style.setProperty(a, MAPA[v]); n.removeAttribute(a); } else sinMapear.add(v);
    }
  });

  // clases con prefijo cv- para no chocar con las del panel (.card, .wrap, .sub…)
  const pref = (el) => { const c = el.getAttribute("class"); if (c) el.setAttribute("class", c.split(/\s+/).filter(Boolean).map((x) => "cv-" + x).join(" ")); };
  pref(wrap);
  wrap.querySelectorAll("[class]").forEach(pref);

  // estilos: todos bajo .cv, clases con prefijo, @media → @container (el documento vive dentro del panel)
  const sheet = [...document.styleSheets].find((s) => s.ownerNode && s.ownerNode.tagName === "STYLE");
  const transSel = (sel) => sel.split(",").map((s) => {
    s = s.trim();
    s = s.replace(/\.([A-Za-z_][\w-]*)/g, ".cv-$1");
    return ".cv " + s;
  }).join(", ");
  const reglas = (lista) => [...lista].map((rule) => {
    if (rule instanceof CSSStyleRule) {
      if (/^\s*(:root|body|html)\s*$/.test(rule.selectorText)) return ""; // variables, color y letra los pone el panel
      return `${transSel(rule.selectorText)} { ${rule.style.cssText} }`;
    }
    if (rule instanceof CSSMediaRule) {
      const cond = rule.conditionText || rule.media.mediaText;
      if (/print/.test(cond)) return "";
      return `@container cv ${cond} { ${reglas(rule.cssRules)} }`;
    }
    return ""; // @page y demás
  }).filter(Boolean).join("\n");
  const vars = (s) => s.replace(/var\(--(vv|v|bg|paper|ink|muted|line|soft|dash|warn)\)/g, "var(--cv-$1)").replace(/rgba\(255, 255, 255, 0\)/g, "transparent");

  return {
    plantilla: vars(wrap.outerHTML),
    css: vars(reglas(sheet.cssRules)),
    campos, datos,
    guardado: Number(document.body.getAttribute("data-saved-ts") || 0) || null,
    sin_mapear: [...sinMapear],
  };
});
await browser.close();

const rellenas = Object.keys(r.datos).length;
console.log(`plantilla ${(r.plantilla.length / 1024).toFixed(1)} KB · css ${(r.css.length / 1024).toFixed(1)} KB · ${r.campos.length} casillas (${rellenas} con texto)` + (r.sin_mapear.length ? ` · colores sin mapear: ${r.sin_mapear.join(", ")}` : ""));
const fecha = r.guardado ? new Date(r.guardado).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "";
const payload = {
  plantilla: r.plantilla, css: r.css, campos: r.campos, datos: r.datos,
  resumen: resumen || `Importada del esquema original${fecha ? ` (guardado el ${fecha})` : ""}`,
};
if (soloJson) { fs.writeFileSync(soloJson, JSON.stringify(payload, null, 1)); console.log("escrito", soloJson); process.exit(0); }

const res = await fetch(base.replace(/\/$/, "") + "/api/vision/importar", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(cred).toString("base64") },
  body: JSON.stringify(payload),
});
const j = await res.json().catch(() => ({}));
if (!res.ok) { console.error("falló:", res.status, j.error || j); process.exit(2); }
console.log("subida:", JSON.stringify(j));
