/* ═══════════════════════════════════════════════════════════════════
   animUtils.js — Canvas utilities for Svelte animation components
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Shared colour palette. Hardcoded values match app.css :root variables
 * and serve as fallbacks before initPalette() is called.
 * Call initPalette() in onMount to read live values from global CSS.
 */
export const C = {
  navy: "#003b71",
  navyDk: "#002a52",
  blue: "#4a90d9",
  blueLt: "#eaf2fb",
  gold: "#e6a817",
  goldLt: "#fef9e7",
  green: "#137333",
  greenLt: "#e6f4ea",
  red: "#c5221f",
  purple: "#7c3aed",
  bg: "#f0f4fa",
  surface: "#ffffff",
  text: "#1a202c",
  muted: "#6b7280",
  border: "#dde3ee",
  grid: "#e5e8f0",
  axis: "#9ca3af",
  data1: "#04050A",
  data2: "#be796b80",
};

/**
 * Read all animation palette colours from the document's computed CSS custom
 * properties (defined in app.css :root). Call once in each component's
 * onMount so canvas drawings always reflect the global stylesheet.
 */
export function initPalette() {
  const s = getComputedStyle(document.documentElement);
  const v = (name) => s.getPropertyValue(name).trim();
  C.navy = v("--navy") || C.navy;
  C.navyDk = v("--navy-dk") || C.navyDk;
  C.blue = v("--color-info") || C.blue;
  C.blueLt = v("--color-info-bg") || C.blueLt;
  C.gold = v("--color-warning") || C.gold;
  C.goldLt = v("--color-warning-bg") || C.goldLt;
  C.green = v("--color-success") || C.green;
  C.greenLt = v("--color-success-bg") || C.greenLt;
  C.red = v("--color-error") || C.red;
  C.bg = v("--panel-bg") || C.bg;
  C.surface = v("--surface") || C.surface;
  C.text = v("--text") || C.text;
  C.muted = v("--muted") || C.muted;
  C.border = v("--border") || C.border;
  C.grid = v("--grid") || C.grid;
  C.axis = v("--axis") || C.axis;
  C.data1 = v("--data1") || C.data1;
  C.data2 = v("--data2") || C.data2;
}

export function setupCanvas(canvas) {
  const d = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 400;
  const H = canvas.offsetHeight || 200;
  canvas.width = W * d;
  canvas.height = H * d;
  const ctx = canvas.getContext("2d");
  ctx.scale(d, d);
  return { ctx, W, H };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function seededRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function drawAxes(ctx, padL, padT, plotW, plotH, xLabel, yLabel) {
  ctx.strokeStyle = C.axis;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  ctx.fillStyle = C.muted;
  ctx.font = "10px Inter,sans-serif";

  if (xLabel) {
    ctx.textAlign = "center";
    ctx.fillText(xLabel, padL + plotW / 2, padT + plotH + 28);
  }
  if (yLabel) {
    ctx.save();
    ctx.translate(13, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }
}

export function drawHGrid(ctx, padL, padT, plotW, plotH, rows) {
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 0.7;
  for (let r = 0; r <= rows; r++) {
    const y = padT + (r / rows) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }
}
