/* ═══════════════════════════════════════════════════════════════════
   shared.js — Canvas utilities and colour palette for all animations
   ═══════════════════════════════════════════════════════════════════ */

// Canvas drawing colour palette (matches handbook theme)
const C = {
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
  // Data series colours
  data1: "#04050A",
  data2: "#BE796B",
};

/** Device pixel ratio */
function dpr() {
  return window.devicePixelRatio || 1;
}

/**
 * Resize a canvas to fill its CSS layout size at full DPR resolution,
 * and apply the DPR scale so all drawing coordinates are in CSS pixels.
 * Call on init and resize. Always call before drawing.
 */
function setupCanvas(canvas) {
  const d = dpr();
  const W = canvas.offsetWidth || 400;
  const H = canvas.offsetHeight || 200;
  canvas.width = W * d;
  canvas.height = H * d;
  const ctx = canvas.getContext("2d");
  ctx.scale(d, d);
  return { ctx, W, H };
}

/** Linear interpolation */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Reproducible seeded pseudo-random number generator.
 * Returns function that yields [0, 1) values.
 */
function seededRNG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Draw standard L-shaped axes and optional labels */
function drawAxes(ctx, padL, padT, plotW, plotH, xLabel, yLabel) {
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

/** Draw light horizontal grid lines */
function drawHGrid(ctx, padL, padT, plotW, plotH, rows) {
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
