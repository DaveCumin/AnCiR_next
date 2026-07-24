<script>
  import { onMount } from "svelte";
  import { C, setupCanvas, seededRNG, initPalette } from "$lib/animUtils.js";

  let { height = "460px" } = $props();

  // ── Idealised Type-1 light PRC (nocturnal; CT12 = activity onset) ──
  const AMP = 2.4;
  function prc(ct) {
    const g = (c, mu, s) => Math.exp(-((c - mu) * (c - mu)) / (2 * s * s));
    return -AMP * g(ct, 15.5, 2.6) + AMP * (g(ct, 21.8, 2.4) + g(ct + 24, 21.8, 2.4));
  }

  // ── Reproducible replicate data: several animals per sampled CT ──
  const rng = seededRNG(7);
  function gauss() {
    let u = 0, v = 0;
    while (!u) u = rng();
    while (!v) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const NREP = 6, NOISE = 0.5;
  const SAMPLE_CTS = [];
  for (let t = 1; t < 24; t += 2) SAMPLE_CTS.push(t); // 1,3,…,23 (12 CTs)
  const DATA = SAMPLE_CTS.map((ct) => {
    const reps = Array.from({ length: NREP }, () => ({
      v: prc(ct) + gauss() * NOISE,
      jx: (rng() - 0.5) * 0.9,
    }));
    const vals = reps.map((r) => r.v);
    const mean = vals.reduce((a, b) => a + b, 0) / NREP;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (NREP - 1));
    return { ct, reps, mean, sem: sd / Math.sqrt(NREP) };
  });

  // stage timeline (fractions of the run)
  const COLLECT = 0.55, SUMM = 0.68, FIT = 0.82;
  const YMAX = 3;

  let frame = 0;
  const TOTAL = 1000;
  let playing = false, raf = null, lastTime = null, accum = 0, speed = 1;
  let cv, btnPlay, progFill, progWrap, stepInd;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function resize() {
    if (cv) setupCanvas(cv);
    draw(frame / TOTAL);
  }

  function draw(p) {
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.offsetWidth, H = cv.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);

    const L = 54, R = 14;
    const strip = { x: L, y: 22, w: W - L - R, h: 52 };
    const plotY = strip.y + strip.h + 46;
    const plot = { x: L, y: plotY, w: W - L - R, h: H - plotY - 40 };
    const ctX = (ct) => plot.x + (ct / 24) * plot.w;
    const dY = (d) => plot.y + plot.h / 2 - (d / YMAX) * (plot.h / 2);
    const line = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    const F = "Inter,system-ui,sans-serif";

    const collectF = Math.min(p / COLLECT, 1);
    const shownF = collectF * DATA.length;
    const nFull = Math.floor(shownF);
    const curIdx = Math.min(nFull, DATA.length - 1);
    const collecting = p < COLLECT;
    const summAlpha = clamp((p - COLLECT) / (SUMM - COLLECT), 0, 1);
    const fitProg = clamp((p - SUMM) / (FIT - SUMM), 0, 1);

    // ── top strip: current experiment ──
    ctx.fillStyle = C.goldLt; ctx.fillRect(ctX(0), strip.y, ctX(12) - ctX(0), strip.h);
    ctx.fillStyle = C.blueLt; ctx.fillRect(ctX(12), strip.y, ctX(24) - ctX(12), strip.h);
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(strip.x, strip.y, strip.w, strip.h);
    ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "center";
    ctx.fillText("subjective day (rest)", (ctX(0) + ctX(12)) / 2, strip.y + 13);
    ctx.fillText("subjective night (active)", (ctX(12) + ctX(24)) / 2, strip.y + 13);
    ctx.fillStyle = C.axis; ctx.font = "9px " + F;
    ctx.textAlign = "left"; ctx.fillText("← earlier (advance)", strip.x + 4, strip.y + strip.h - 5);
    ctx.textAlign = "right"; ctx.fillText("later (delay) →", strip.x + strip.w - 4, strip.y + strip.h - 5);

    if (collecting) {
      const d = DATA[curIdx], shift = d.mean, onsetS = 12 - shift;
      ctx.setLineDash([4, 3]); ctx.strokeStyle = C.muted; ctx.lineWidth = 1.4;
      line(ctX(12), strip.y, ctX(12), strip.y + strip.h); ctx.setLineDash([]);
      const col = shift >= 0 ? C.green : C.red;
      ctx.strokeStyle = col; ctx.lineWidth = 2.4; line(ctX(onsetS), strip.y, ctX(onsetS), strip.y + strip.h);
      if (Math.abs(shift) > 0.08) {
        const ay = strip.y + strip.h / 2, x0 = ctX(12), x1 = ctX(onsetS), dir = Math.sign(x1 - x0);
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; line(x0, ay, x1, ay);
        ctx.beginPath(); ctx.moveTo(x1, ay); ctx.lineTo(x1 - dir * 7, ay - 4); ctx.lineTo(x1 - dir * 7, ay + 4); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = C.gold; ctx.fillRect(ctX(d.ct) - 2, strip.y - 6, 4, strip.h + 12);
      star(ctx, ctX(d.ct), strip.y - 11, 6, C.gold);
      ctx.fillStyle = C.navy; ctx.font = "bold 11px " + F; ctx.textAlign = "center";
      ctx.fillText("pulse at CT" + d.ct + " → " + NREP + " animals", ctX(d.ct), strip.y - 16);
    } else {
      ctx.fillStyle = C.muted; ctx.font = "11px " + F; ctx.textAlign = "center";
      ctx.fillText("all circadian times sampled", strip.x + strip.w / 2, strip.y - 9);
    }

    // ── bottom plot ──
    ctx.fillStyle = "rgba(197,34,31,.08)"; ctx.fillRect(ctX(12), plot.y, ctX(18) - ctX(12), plot.h);
    ctx.fillStyle = C.greenLt; ctx.fillRect(ctX(18), plot.y, ctX(24) - ctX(18), plot.h);
    ctx.fillStyle = "rgba(0,0,0,.03)"; ctx.fillRect(ctX(0), plot.y, ctX(12) - ctX(0), plot.h);
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = C.axis; line(plot.x, dY(0), plot.x + plot.w, dY(0)); ctx.setLineDash([]);
    ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "center";
    for (let t = 0; t <= 24; t += 6) { line(ctX(t), plot.y + plot.h, ctX(t), plot.y + plot.h + 4); ctx.fillText("CT" + t, ctX(t), plot.y + plot.h + 16); }
    ctx.fillText("circadian time of light pulse", plot.x + plot.w / 2, plot.y + plot.h + 33);
    ctx.textAlign = "right";
    for (let d = -3; d <= 3; d++) ctx.fillText((d > 0 ? "+" : "") + d, plot.x - 6, dY(d) + 3);
    ctx.save(); ctx.translate(15, plot.y + plot.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center";
    ctx.fillText("phase shift ΔΦ (h)   + advance / − delay", 0, 0); ctx.restore();
    ctx.font = "italic 10px " + F; ctx.textAlign = "center";
    ctx.fillStyle = C.muted; ctx.fillText("dead zone", (ctX(0) + ctX(12)) / 2, plot.y + 13);
    ctx.fillStyle = C.red; ctx.fillText("delays", (ctX(12) + ctX(18)) / 2, plot.y + 13);
    ctx.fillStyle = C.green; ctx.fillText("advances", (ctX(18) + ctX(24)) / 2, plot.y + 13);

    // individual replicate points, revealed CT by CT
    DATA.forEach((d, i) => {
      let a = 0;
      if (i < nFull) a = 1;
      else if (i === nFull && collecting) a = shownF - nFull;
      else if (!collecting) a = 1;
      if (a <= 0) return;
      ctx.fillStyle = hexA(C.blue, 0.85 * a);
      d.reps.forEach((r) => {
        ctx.beginPath();
        ctx.arc(ctX(d.ct) + r.jx * (plot.w / 24) * 0.5, dY(r.v), 3, 0, 2 * Math.PI);
        ctx.fill();
      });
    });

    // mean ± SEM
    if (summAlpha > 0) {
      ctx.strokeStyle = hexA(C.text, summAlpha); ctx.fillStyle = hexA(C.text, summAlpha); ctx.lineWidth = 2;
      DATA.forEach((d) => {
        const x = ctX(d.ct), yhi = dY(d.mean + d.sem), ylo = dY(d.mean - d.sem);
        line(x, yhi, x, ylo); line(x - 4, yhi, x + 4, yhi); line(x - 4, ylo, x + 4, ylo);
        ctx.beginPath(); ctx.arc(x, dY(d.mean), 3.5, 0, 2 * Math.PI); ctx.fill();
      });
    }

    // smooth fitted curve, drawn left→right
    if (fitProg > 0) {
      ctx.strokeStyle = C.navy; ctx.lineWidth = 2.6; ctx.beginPath();
      const end = 24 * fitProg;
      for (let t = 0; t <= end + 0.001; t += 0.15) { const x = ctX(t), y = dY(prc(t)); t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }

    if (progFill) progFill.style.width = p * 100 + "%";
    if (stepInd) {
      stepInd.textContent = collecting ? "Sampling CT" + DATA[curIdx].ct + "…"
        : summAlpha < 1 ? "Summarising (mean ± SEM)…"
        : fitProg < 1 ? "Fitting smooth PRC…" : "PRC complete";
    }
  }

  function star(ctx, cx, cy, r, col) {
    ctx.fillStyle = col; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + i * Math.PI / 5;
      const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  }

  // add an alpha to a #rrggbb / rgb() colour
  function hexA(col, a) {
    if (col && col[0] === "#" && col.length >= 7) {
      const n = parseInt(col.slice(1, 7), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    return col;
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime; lastTime = ts;
    accum += dt * speed * 0.067;
    const steps = Math.floor(accum); accum -= steps;
    frame = Math.min(frame + steps, TOTAL);
    draw(frame / TOTAL);
    if (frame >= TOTAL) { playing = false; btnPlay.textContent = "▶ Play"; return; }
    raf = requestAnimationFrame(loop);
  }

  function toggle() {
    if (frame >= TOTAL) reset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) { lastTime = null; raf = requestAnimationFrame(loop); }
    else cancelAnimationFrame(raf);
  }

  function reset() {
    playing = false; cancelAnimationFrame(raf);
    frame = 0; lastTime = null; accum = 0;
    btnPlay.textContent = "▶ Play";
    draw(0);
  }

  function seek(e) {
    const rect = progWrap.getBoundingClientRect();
    frame = Math.round(clamp((e.clientX - rect.left) / rect.width, 0, 1) * TOTAL);
    draw(frame / TOTAL);
  }

  onMount(() => {
    initPalette();
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  });
</script>

<div class="anim-embed" style={height ? `height: ${height}` : undefined}>
  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>Constructing a phase response curve</h3>
      <canvas bind:this={cv}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="background: var(--gold)"></div>Light pulse</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--color-info)"></div>Individual animal (ΔΦ)</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--text)"></div>Mean ± SEM</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--navy)"></div>Smooth fit (PRC)</div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={toggle}>&#9654; Play</button>
    <button class="btn secondary" onclick={reset}>&#8634; Reset</button>
    <div class="progress-wrap" bind:this={progWrap} onclick={seek}>
      <div class="progress-fill" bind:this={progFill}></div>
    </div>
    <div class="speed-wrap">
      <span>Speed</span>
      <input type="range" min="0.2" max="4" step="0.1" value="1" oninput={(e) => { speed = +e.target.value; }} />
    </div>
    <div class="step-indicator" bind:this={stepInd}>Ready</div>
  </div>
</div>
