// Widgets del panel para iPhone (app Scriptable, gratis en la App Store).
// Este script se genera en Configuración → Widgets del móvil con tu URL y tu token ya puestos.
//
// Parámetro del widget (mantén pulsado el widget → Editar widget → Parameter):
//   pantalla de inicio · pequeño y mediano: hoy (por defecto) · ahora · frase · grande: todo junto
//   pantalla de bloqueo · rectangular: frase (por defecto) · ahora · hoy
//                         circular: score (por defecto) · faltan
//                         en línea (encima de la hora): ahora
// Tocar el widget abre el panel.

const OS_URL = "__OS_URL__";
const OS_TOKEN = "__OS_TOKEN__";

const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "os-widget-cache.json");

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const pad = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minDe = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const sinCero = (s) => s.replace(/^0/, "");

/* ---------- colores: siguen el modo claro/oscuro del iPhone ---------- */
const dyn = (claro, oscuro) => Color.dynamic(new Color(claro), new Color(oscuro));
const C = {
  bg: dyn("#ffffff", "#141417"),
  ink: dyn("#17171c", "#f4f4f6"),
  ink2: dyn("#55555f", "#b8b8c2"),
  ink3: dyn("#9a9aa5", "#70707b"),
  accent: dyn("#5546e8", "#8b80ff"),
  ok: dyn("#1baf7a", "#34d399"),
  hair: dyn("#ececf1", "#26262c"),
};
// DrawContext pinta una imagen fija: no entiende colores dinámicos, así que el anillo
// usa tonos que funcionan en los dos modos
const RING = { fill: new Color("#6c5ff5"), track: new Color("#6c5ff5", 0.2) };

/* ---------- datos ---------- */
async function cargar() {
  const now = new Date();
  const url = `${OS_URL}/api/widget?fecha=${isoLocal(now)}&hora=${encodeURIComponent(hhmm(now))}`;
  try {
    const r = new Request(url);
    r.headers = { Authorization: `Bearer ${OS_TOKEN}` };
    r.timeoutInterval = 12;
    const data = await r.loadJSON();
    const code = r.response ? r.response.statusCode : 200;
    if (code !== 200) throw new Error(data && data.error ? data.error : `HTTP ${code}`);
    fm.writeString(CACHE, JSON.stringify(data));
    return { data, viejo: false };
  } catch (e) {
    if (fm.fileExists(CACHE)) {
      const data = JSON.parse(fm.readString(CACHE));
      // la caché de otro día no dice nada de hoy: los hábitos salen a cero
      if (data.fecha !== isoLocal(now)) {
        data.habitos = (data.habitos || []).map((h) => ({ ...h, hecho: false, parcial: 0, detalle: null }));
        data.faltan = data.habitos.map((h) => h.corto);
        data.hechos = 0;
        data.score = 0;
      }
      return { data, viejo: true, error: String(e.message || e) };
    }
    return { data: null, viejo: true, error: String(e.message || e) };
  }
}

/* bloque del horario que toca ahora (admite bloques que cruzan medianoche: 23:00–07:00) */
function bloqueActual(data, now) {
  const m = now.getHours() * 60 + now.getMinutes();
  const con = (data.horario || []).filter((b) => b.desde);
  let actual = null, fin = null, siguiente = null, enMin = Infinity;
  for (const b of con) {
    const d = minDe(b.desde);
    const h = b.hasta ? minDe(b.hasta) : d + 1;
    const cruza = h <= d;
    const dentro = cruza ? m >= d || m < h : m >= d && m < h;
    if (dentro && b.hasta) {
      actual = b;
      fin = new Date(now);
      fin.setHours(Math.floor(h / 60), h % 60, 0, 0);
      if (fin <= now) fin.setDate(fin.getDate() + 1);
    }
    const falta = (d - m + 1440) % 1440;
    if (falta > 0 && falta < enMin && b !== actual) { enMin = falta; siguiente = b; }
  }
  const inicioSig = siguiente ? new Date(now.getTime() + enMin * 60000) : null;
  if (inicioSig) inicioSig.setSeconds(0, 0);
  const nota = (data.horario || []).find((b) => !b.desde) || null;
  // lo que se enseña: el bloque en curso → el siguiente si empieza en ≤ 90 min → la nota del día → el siguiente
  let foco = null, tipo = null;
  if (actual) { foco = actual; tipo = "ahora"; }
  else if (siguiente && enMin <= 90) { foco = siguiente; tipo = "siguiente"; }
  else if (nota) { foco = nota; tipo = "nota"; }
  else if (siguiente) { foco = siguiente; tipo = "siguiente"; }
  return { actual, fin, siguiente, inicioSig, nota, foco, tipo };
}

/* ---------- piezas ---------- */
function texto(stack, t, size, color, peso = "regular", lineas = 0) {
  const w = stack.addText(String(t));
  w.font = peso === "bold" ? Font.boldSystemFont(size)
    : peso === "heavy" ? Font.heavySystemFont(size)
    : peso === "semibold" ? Font.semiboldSystemFont(size)
    : peso === "medium" ? Font.mediumSystemFont(size)
    : peso === "rounded" ? Font.boldRoundedSystemFont(size)
    : Font.systemFont(size);
  w.textColor = color;
  if (lineas) w.lineLimit = lineas;
  return w;
}

function etiqueta(stack, t, color = C.ink3) {
  return texto(stack, t.toUpperCase(), 10, color, "semibold", 1);
}

/* los stacks verticales centran a sus hijos: cada línea va en una fila a todo el ancho */
function linea(stack, t, size, color, peso, lineas) {
  const f = stack.addStack();
  f.layoutHorizontally();
  const w = texto(f, t, size, color, peso, lineas);
  f.addSpacer();
  return w;
}

function lineaEtiqueta(stack, t, color = C.ink3) {
  return linea(stack, t.toUpperCase(), 10, color, "semibold", 1);
}

function anillo(pct, lado, grosor, fill = RING.fill, track = RING.track) {
  const ctx = new DrawContext();
  ctx.size = new Size(lado, lado);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const c = lado / 2, r = (lado - grosor) / 2;
  const punto = (f) => {
    const a = (f - 0.25) * 2 * Math.PI;
    return new Point(c + r * Math.cos(a), c + r * Math.sin(a));
  };
  const arco = (hasta, color) => {
    const p = new Path();
    const pasos = Math.max(2, Math.ceil(hasta * 120));
    for (let i = 0; i <= pasos; i++) {
      const pt = punto((hasta * i) / pasos);
      if (i === 0) p.move(pt); else p.addLine(pt);
    }
    ctx.addPath(p);
    ctx.setStrokeColor(color);
    ctx.setLineWidth(grosor);
    ctx.strokePath();
  };
  arco(1, track);
  if (pct > 0) {
    arco(Math.min(pct, 1), fill);
    // puntas redondas
    ctx.setFillColor(fill);
    for (const f of [0, Math.min(pct, 1)]) {
      const pt = punto(f);
      ctx.fillEllipse(new Rect(pt.x - grosor / 2, pt.y - grosor / 2, grosor, grosor));
    }
  }
  return ctx.getImage();
}

function anilloConNumero(stack, score, lado, grosor, size, colorNum = C.ink, fill, track) {
  const s = stack.addStack();
  s.size = new Size(lado, lado);
  s.backgroundImage = anillo(score / 100, lado, grosor, fill, track);
  s.centerAlignContent();
  s.layoutHorizontally();
  s.addSpacer();
  texto(s, score, size, colorNum, "rounded", 1);
  s.addSpacer();
  return s;
}

function puntos(stack, habitos, lado = 7, hueco = 4) {
  const s = stack.addStack();
  s.layoutHorizontally();
  s.centerAlignContent();
  s.spacing = hueco;
  for (const h of habitos) {
    const d = s.addStack();
    d.size = new Size(lado, lado);
    d.cornerRadius = lado / 2;
    d.backgroundColor = h.hecho ? C.ok : h.parcial > 0 ? C.accent : C.hair;
  }
  return s;
}

function temporizador(stack, fecha, size, color) {
  const t = stack.addDate(fecha);
  t.applyTimerStyle();
  t.leftAlignText();
  t.font = Font.mediumMonospacedSystemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}

function fechaLarga(now) {
  return `${DIAS[now.getDay()]} ${now.getDate()} ${MESES[now.getMonth()]}`;
}

function cuandoFecha(f) {
  if (f.dias === 0) return "hoy";
  if (f.dias === 1) return "mañana";
  return `en ${f.dias} días`;
}

function pie(w, estado) {
  if (!estado.viejo) return;
  w.addSpacer(4);
  linea(w, "sin conexión · datos guardados", 9, C.ink3, "medium", 1);
}

/* ---------- widgets de la pantalla de inicio ---------- */
function cabeceraBloque(b) {
  if (b.tipo === "ahora") return `Ahora · hasta ${sinCero(b.actual.hasta)}`;
  if (b.tipo === "siguiente") return `A las ${sinCero(b.siguiente.desde)}`;
  return "Hoy";
}

/* lineasTexto: líneas del detalle del bloque (0 = sin detalle) */
function bloqueAhora(stack, b, tamano, lineasTexto) {
  if (!b.foco) {
    lineaEtiqueta(stack, "Hoy");
    stack.addSpacer(3);
    linea(stack, "Día libre", tamano, C.ink, "bold", 1);
    return;
  }
  lineaEtiqueta(stack, cabeceraBloque(b), C.accent);
  stack.addSpacer(3);
  linea(stack, b.foco.titulo, tamano, C.ink, "bold", 2).minimumScaleFactor = 0.7;
  if (b.foco.texto && lineasTexto) {
    stack.addSpacer(2);
    linea(stack, b.foco.texto, 12, C.ink2, "regular", lineasTexto).minimumScaleFactor = 0.85;
  }
}

/* el reloj en vivo de iOS ocupa el ancho que le sobra: siempre al final de su fila */
function lineaTimer(stack, b) {
  const s = stack.addStack();
  s.layoutHorizontally();
  s.centerAlignContent();
  if (b.tipo === "ahora" && b.fin) {
    texto(s, "quedan ", 11, C.ink3, "medium", 1);
    temporizador(s, b.fin, 12, C.accent);
  } else if (b.tipo === "siguiente" && b.inicioSig) {
    texto(s, "empieza en ", 11, C.ink3, "medium", 1);
    temporizador(s, b.inicioSig, 12, C.accent);
  } else if (b.siguiente) {
    texto(s, `a las ${sinCero(b.siguiente.desde)} · ${b.siguiente.titulo}`, 11, C.ink3, "medium", 1);
    s.addSpacer();
  }
  return s;
}

function lineaLuego(stack, b) {
  if (b.tipo !== "ahora" || !b.siguiente || b.siguiente === b.actual) return false;
  linea(stack, `luego ${sinCero(b.siguiente.desde)} · ${b.siguiente.titulo}`, 11, C.ink3, "medium", 1);
  return true;
}

function smallHoy(w, d, estado, now) {
  const top = w.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  anilloConNumero(top, d.score, 58, 7, 19);
  top.addSpacer(10);
  const der = top.addStack();
  der.layoutVertically();
  linea(der, `${d.hechos}/${d.habitos.length}`, 17, C.ink, "rounded", 1);
  linea(der, "hábitos", 11, C.ink3, "medium", 1);
  if (d.racha > 0) linea(der, `racha ${d.racha}`, 11, C.ok, "semibold", 1);
  w.addSpacer();
  if (!d.faltan.length) {
    linea(w, "Día completo.", 14, C.ok, "bold", 1);
    if (d.ancla) linea(w, d.ancla, 10, C.ink3, "heavy", 1);
  } else {
    lineaEtiqueta(w, `Faltan ${d.faltan.length}`);
    w.addSpacer(3);
    const max = 3;
    d.faltan.slice(0, max).forEach((f) => linea(w, f, 12.5, C.ink2, "medium", 1));
    if (d.faltan.length > max) linea(w, `+${d.faltan.length - max} más`, 11, C.ink3, "medium", 1);
  }
  pie(w, estado);
}

function smallAhora(w, d, estado, now) {
  const b = bloqueActual(d, now);
  bloqueAhora(w, b, 19, 3);
  w.addSpacer();
  lineaTimer(w, b);
  pie(w, estado);
}

function fraseStack(stack, d, tamano, lineas) {
  if (!d.frase) {
    linea(stack, "Añade tus frases en Configuración → Widgets del móvil.", 13, C.ink2, "medium", 4);
    return;
  }
  if (d.frase.tag) {
    lineaEtiqueta(stack, d.frase.tag, C.accent);
    stack.addSpacer(5);
  }
  linea(stack, d.frase.texto, tamano, C.ink, "semibold", lineas).minimumScaleFactor = 0.55;
}

const anclaRepetida = (d) => !d.ancla || (d.frase && d.frase.tag && d.frase.tag.toLowerCase() === d.ancla.toLowerCase());

function smallFrase(w, d, estado) {
  fraseStack(w, d, 16, 6);
  w.addSpacer();
  if (!anclaRepetida(d)) linea(w, d.ancla, 10, C.ink3, "heavy", 1);
  pie(w, estado);
}

function mediumHoy(w, d, estado, now) {
  const b = bloqueActual(d, now);
  const fila = w.addStack();
  fila.layoutHorizontally();
  const izq = fila.addStack();
  izq.layoutVertically();
  bloqueAhora(izq, b, 21, 2);
  izq.addSpacer();
  if (lineaLuego(izq, b)) izq.addSpacer(2);
  lineaTimer(izq, b);
  fila.addSpacer(12);
  const der = fila.addStack();
  der.layoutVertically();
  der.size = new Size(104, 0);
  const r = der.addStack();
  r.layoutHorizontally();
  r.addSpacer();
  anilloConNumero(r, d.score, 62, 7, 20);
  r.addSpacer();
  der.addSpacer(6);
  const c = der.addStack();
  c.layoutHorizontally();
  c.addSpacer();
  texto(c, d.faltan.length ? `faltan ${d.faltan.length} de ${d.habitos.length}` : "día completo", 11, d.faltan.length ? C.ink3 : C.ok, "semibold", 1);
  c.addSpacer();
  der.addSpacer(3);
  d.faltan.slice(0, 2).forEach((f) => {
    const l = der.addStack();
    l.layoutHorizontally();
    l.addSpacer();
    texto(l, f, 11, C.ink2, "medium", 1).minimumScaleFactor = 0.8;
    l.addSpacer();
  });
  der.addSpacer();
  w.addSpacer(8);
  const pts = w.addStack();
  pts.layoutHorizontally();
  puntos(pts, d.habitos, 6, 5);
  pts.addSpacer();
  pie(w, estado);
}

function mediumFrase(w, d, estado) {
  fraseStack(w, d, 19, 4);
  w.addSpacer();
  const s = w.addStack();
  s.layoutHorizontally();
  s.centerAlignContent();
  if (!anclaRepetida(d)) texto(s, d.ancla, 10, C.ink3, "heavy", 1);
  s.addSpacer();
  puntos(s, d.habitos, 6, 4);
  s.addSpacer(8);
  texto(s, d.score, 12, C.ink2, "rounded", 1);
  pie(w, estado);
}

function large(w, d, estado, now) {
  const b = bloqueActual(d, now);
  const cab = w.addStack();
  cab.layoutHorizontally();
  cab.centerAlignContent();
  const t = cab.addStack();
  t.layoutVertically();
  lineaEtiqueta(t, fechaLarga(now));
  linea(t, d.faltan.length ? `Faltan ${d.faltan.length} de ${d.habitos.length}` : "Día completo", 17, d.faltan.length ? C.ink : C.ok, "bold", 1);
  if (d.racha > 0 || d.media7 != null) linea(t, `racha ${d.racha} · media 7 días ${d.media7 ?? "—"}`, 11, C.ink3, "medium", 1);
  cab.addSpacer(8);
  anilloConNumero(cab, d.score, 54, 7, 18);

  w.addSpacer(10);
  bloqueAhora(w, b, 19, 1);
  w.addSpacer(3);
  lineaTimer(w, b);

  w.addSpacer(10);
  const cols = w.addStack();
  cols.layoutHorizontally();
  cols.topAlignContent();
  const mitad = Math.ceil(d.habitos.length / 2);
  [d.habitos.slice(0, mitad), d.habitos.slice(mitad)].forEach((grupo, gi) => {
    const col = cols.addStack();
    col.layoutVertically();
    col.spacing = 4;
    for (const h of grupo) {
      const f = col.addStack();
      f.layoutHorizontally();
      f.centerAlignContent();
      const dot = f.addStack();
      dot.size = new Size(8, 8);
      dot.cornerRadius = 4;
      dot.backgroundColor = h.hecho ? C.ok : h.parcial > 0 ? C.accent : C.hair;
      f.addSpacer(6);
      texto(f, h.corto, 12, h.hecho ? C.ink3 : C.ink, "medium", 1).minimumScaleFactor = 0.8;
      if (h.detalle && !h.hecho) {
        f.addSpacer(4);
        texto(f, h.detalle, 10, C.ink3, "medium", 1);
      }
      f.addSpacer();
    }
    if (gi === 0) cols.addSpacer(10);
  });

  w.addSpacer();
  if (d.fechas && d.fechas.length) {
    const f = d.fechas[0];
    const fl = w.addStack();
    fl.layoutHorizontally();
    fl.centerAlignContent();
    etiqueta(fl, cuandoFecha(f), C.accent);
    fl.addSpacer(6);
    texto(fl, f.texto, 12, C.ink2, "medium", 1).minimumScaleFactor = 0.8;
    fl.addSpacer();
    w.addSpacer(8);
  }
  const sep = w.addStack();
  sep.size = new Size(0, 1);
  sep.backgroundColor = C.hair;
  w.addSpacer(8);
  fraseStack(w, d, 13, 2);
  pie(w, estado);
}

/* ---------- pantalla de bloqueo (iOS la tiñe: solo blanco con opacidades) ---------- */
const BLANCO = Color.white();
const BLANCO2 = new Color("#ffffff", 0.72);

function lockRect(w, d, estado, now, modo) {
  if (modo === "ahora") {
    const b = bloqueActual(d, now);
    const cab = b.tipo === "ahora" ? `hasta ${sinCero(b.actual.hasta)}` : b.tipo === "siguiente" ? `a las ${sinCero(b.siguiente.desde)}` : "hoy";
    const s = w.addStack();
    s.layoutHorizontally();
    s.centerAlignContent();
    texto(s, b.foco ? b.foco.titulo : "Día libre", 15, BLANCO, "bold", 1).minimumScaleFactor = 0.7;
    if (b.tipo !== "nota") {
      s.addSpacer(5);
      texto(s, cab, 11, BLANCO2, "semibold", 1);
    }
    s.addSpacer();
    if (b.foco && b.foco.texto) linea(w, b.foco.texto, 12, BLANCO2, "medium", 2).minimumScaleFactor = 0.8;
    return;
  }
  if (modo === "hoy") {
    const s = w.addStack();
    s.layoutHorizontally();
    s.centerAlignContent();
    texto(s, d.score, 22, BLANCO, "rounded", 1);
    s.addSpacer(6);
    texto(s, `${d.hechos}/${d.habitos.length} hábitos`, 12, BLANCO2, "semibold", 1);
    s.addSpacer();
    linea(w, d.faltan.length ? d.faltan.join(" · ") : "Día completo", 12, BLANCO2, "medium", 2).minimumScaleFactor = 0.75;
    return;
  }
  if (!d.frase) {
    linea(w, "Añade frases en el panel", 13, BLANCO, "semibold", 2);
    return;
  }
  if (d.frase.tag) linea(w, d.frase.tag.toUpperCase(), 10, BLANCO2, "bold", 1);
  linea(w, d.frase.texto, 13, BLANCO, "semibold", 3).minimumScaleFactor = 0.6;
}

function lockCircular(w, d, estado, modo) {
  if (modo === "faltan") {
    w.addAccessoryWidgetBackground = true;
    w.addSpacer();
    const a = w.addStack(); a.layoutHorizontally(); a.addSpacer();
    texto(a, d.faltan.length, 22, BLANCO, "rounded", 1);
    a.addSpacer();
    const b = w.addStack(); b.layoutHorizontally(); b.addSpacer();
    texto(b, "faltan", 9, BLANCO2, "semibold", 1);
    b.addSpacer();
    w.addSpacer();
    return;
  }
  const fila = w.addStack();
  fila.layoutHorizontally();
  fila.addSpacer();
  anilloConNumero(fila, d.score, 58, 6, 18, BLANCO, BLANCO, new Color("#ffffff", 0.25));
  fila.addSpacer();
}

function lockInline(w, d, now) {
  const b = bloqueActual(d, now);
  const t = b.tipo === "ahora" ? `${b.actual.titulo} hasta ${sinCero(b.actual.hasta)}`
    : b.tipo === "siguiente" ? `${sinCero(b.siguiente.desde)} ${b.siguiente.titulo}`
    : b.tipo === "nota" ? b.nota.titulo
    : `${d.score} · faltan ${d.faltan.length}`;
  texto(w, t, 12, BLANCO, "semibold", 1);
}

/* ---------- montaje ---------- */
async function crear(familia, modo) {
  const now = new Date();
  const estado = await cargar();
  const w = new ListWidget();
  w.url = OS_URL;
  const lock = familia.startsWith("accessory");
  if (!lock) {
    w.backgroundColor = C.bg;
    w.setPadding(14, 15, 13, 15);
  }

  if (!estado.data) {
    linea(w, "Sin conexión con el panel", lock ? 12 : 14, lock ? BLANCO : C.ink, "bold", 2);
    if (!lock) linea(w, estado.error || "", 11, C.ink3, "regular", 3);
    w.refreshAfterDate = new Date(Date.now() + 10 * 60000);
    return w;
  }
  const d = estado.data;
  d.habitos = d.habitos || [];
  d.faltan = d.faltan || [];

  if (familia === "accessoryRectangular") lockRect(w, d, estado, now, modo || "frase");
  else if (familia === "accessoryCircular") lockCircular(w, d, estado, modo);
  else if (familia === "accessoryInline") lockInline(w, d, now);
  else if (familia === "small") {
    if (modo === "ahora") smallAhora(w, d, estado, now);
    else if (modo === "frase") smallFrase(w, d, estado);
    else smallHoy(w, d, estado, now);
  } else if (familia === "medium") {
    if (modo === "frase") mediumFrase(w, d, estado);
    else mediumHoy(w, d, estado, now);
  } else large(w, d, estado, now);

  // próxima pintura: al cambiar de bloque del horario, y como mucho en 30 min (hábitos al día)
  const b = bloqueActual(d, now);
  let prox = Date.now() + 30 * 60000;
  if (b.fin) prox = Math.min(prox, b.fin.getTime() + 15000);
  if (b.inicioSig) prox = Math.min(prox, b.inicioSig.getTime() + 15000);
  w.refreshAfterDate = new Date(Math.max(prox, Date.now() + 5 * 60000));
  return w;
}

const modo = String(args.widgetParameter || "").trim().toLowerCase() || null;

if (config.runsInWidget) {
  Script.setWidget(await crear(config.widgetFamily || "small", modo));
} else {
  const opciones = [
    ["Pequeño · hoy", "small", "hoy"], ["Pequeño · ahora", "small", "ahora"], ["Pequeño · frase", "small", "frase"],
    ["Mediano · hoy", "medium", "hoy"], ["Mediano · frase", "medium", "frase"], ["Grande", "large", null],
    ["Bloqueo · frase", "accessoryRectangular", "frase"], ["Bloqueo · ahora", "accessoryRectangular", "ahora"],
    ["Bloqueo · score", "accessoryCircular", null],
  ];
  const a = new Alert();
  a.title = "Vista previa";
  a.message = "Así se verá cada widget. Para ponerlo: mantén pulsada la pantalla de inicio o de bloqueo → + → Scriptable, y elige este script.";
  opciones.forEach((o) => a.addAction(o[0]));
  a.addCancelAction("Cerrar");
  const i = await a.presentSheet();
  if (i >= 0) {
    const [, fam, m] = opciones[i];
    const w = await crear(fam, m);
    const presentar = {
      small: () => w.presentSmall(), medium: () => w.presentMedium(), large: () => w.presentLarge(),
      accessoryRectangular: () => w.presentAccessoryRectangular(), accessoryCircular: () => w.presentAccessoryCircular(),
    };
    await presentar[fam]();
  }
}
Script.complete();
