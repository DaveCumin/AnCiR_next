<script>
  // Fold → bin → statistic → sweep, showing BOTH the Enright amplitude Aₚ and
  // the Sokolove–Bushell χ² Qₚ built from the same period-folded bin means.
  // Ported from the standalone handbook animation; uses the shared canvas
  // helpers so it themes with the rest of the handbook (incl. dark mode).
  import { onMount } from "svelte";
  import {
    C,
    setupCanvas,
    drawAxes,
    drawHGrid,
    seededRNG,
    initPalette,
  } from "$lib/animUtils.js";

  let { height = null } = $props();

  /* ── chi-squared machinery ──────────────────────────────────────────────── */
  function lnGamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
    let s = 1.000000000190015;
    for (let j = 0; j < 6; j++) s += g[j] / ++y;
    return -t + Math.log((2.5066282746310005 * s) / x);
  }
  function lowerGammaReg(a, x) {
    if (x <= 0) return 0;
    if (x < a + 1) {
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 300; n++) { ap++; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
      return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 300; i++) {
      const an = -i * (i - a);
      b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  }
  const chiCDF = (x, k) => lowerGammaReg(k / 2, x / 2);
  function chiCrit(k, alpha = 0.05) {
    let lo = 0, hi = 400;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      chiCDF(mid, k) < 1 - alpha ? (lo = mid) : (hi = mid);
    }
    return (lo + hi) / 2;
  }

  /* ── synthetic rhythm: 10 days, 1 h bins, period 24 h ───────────────────── */
  const rng = seededRNG(23);
  function gauss() {
    let u = 0, v = 0;
    while (!u) u = rng(); while (!v) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const DT = 1, NPT = 240, TRUE_P = 24;
  const SERIES = Array.from({ length: NPT }, (_, i) =>
    50 + 22 * Math.cos((2 * Math.PI * i * DT) / TRUE_P - Math.PI * 0.7) + gauss() * 9);
  const GRAND = SERIES.reduce((a, b) => a + b, 0) / NPT;
  const SSTOT = SERIES.reduce((a, v) => a + (v - GRAND) ** 2, 0);
  const VMIN = Math.min(...SERIES), VMAX = Math.max(...SERIES);

  function fold(period) {
    const P = Math.round(period / DT);
    const K = Math.ceil(NPT / P);
    const sums = new Array(P).fill(0), cnts = new Array(P).fill(0);
    for (let i = 0; i < NPT; i++) { const c = i % P; sums[c] += SERIES[i]; cnts[c]++; }
    const means = sums.map((s, i) => (cnts[i] ? s / cnts[i] : GRAND));
    const num = means.reduce((a, m) => a + (m - GRAND) ** 2, 0);
    return {
      P, K, means, cnts, num,
      Ap: Math.sqrt(num / P),
      Qp: (num * NPT * K) / SSTOT,
      df: P - 1,
    };
  }
  const F24 = fold(TRUE_P);
  const MAXDEV = Math.max(...F24.means.map((m) => Math.abs(m - GRAND)));

  const PERIODS = [];
  for (let p = 18; p <= 30; p += 0.25) PERIODS.push(p);
  const SWEEP = PERIODS.map((p) => { const f = fold(p); return { p, Ap: f.Ap, Qp: f.Qp, crit: chiCrit(f.df) }; });
  const APMAX = Math.max(...SWEEP.map((s) => s.Ap)) * 1.12;
  const QPMAX = Math.max(...SWEEP.map((s) => Math.max(s.Qp, s.crit))) * 1.12;
  const DOM = SWEEP.reduce((best, s, i) => (s.Qp > SWEEP[best].Qp ? i : best), 0);

  /* ── timeline ───────────────────────────────────────────────────────────── */
  const TOTAL = 1000;
  const B = { foldEnd: 0.30, binEnd: 0.56, statEnd: 0.70 };
  const STAGE_START = [0, 0.30, 0.56, 0.70];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

  let frame = 0, playing = false, raf = null, lastTime = null, accum = 0, speed = 1;
  let activeStage = $state(0);

  let cRaw, cFold, cStat, btnPlay, progFill, progWrap, stepInd,
    stepText, statBox, legendEl, foldTitle, statTitle;

  function stageOf(t) {
    if (t < B.foldEnd) return 0;
    if (t < B.binEnd) return 1;
    if (t < B.statEnd) return 2;
    return 3;
  }

  function resize() {
    [cRaw, cFold, cStat].forEach((c) => { if (c) setupCanvas(c); });
    draw(frame);
  }

  /* ── RAW PANEL ── */
  function drawRaw(t) {
    setupCanvas(cRaw);
    const ctx = cRaw.getContext("2d");
    const W = cRaw.offsetWidth, H = cRaw.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const L = 40, R = 12, T = 12, Bm = 26, pw = W - L - R, ph = H - T - Bm;
    ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);
    const X = (i) => L + (i / (NPT - 1)) * pw;
    const Y = (v) => T + ph - ((v - VMIN) / (VMAX - VMIN)) * ph * 0.94 - ph * 0.03;

    const stage = stageOf(t);
    const kShown = stage === 0 ? clamp(Math.floor(prog(t, 0, B.foldEnd) * F24.K) + 1, 0, F24.K) : F24.K;

    for (let k = 0; k < F24.K; k++) {
      const x0 = X(k * F24.P), x1 = X(Math.min((k + 1) * F24.P, NPT - 1));
      const isCurrent = stage === 0 && k === kShown - 1;
      const active = k < kShown;
      ctx.fillStyle = isCurrent ? "rgba(230,168,23,0.16)" : active ? "rgba(0,59,113,0.05)" : "rgba(0,0,0,0)";
      ctx.fillRect(x0, T, x1 - x0, ph);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(x0, T); ctx.lineTo(x0, T + ph); ctx.stroke();
    }
    for (let k = 0; k < F24.K; k++) {
      const isCurrent = stage === 0 && k === kShown - 1;
      const revealed = k < kShown;
      ctx.strokeStyle = isCurrent ? C.gold : revealed ? C.navy : C.axis;
      ctx.globalAlpha = isCurrent ? 1 : revealed ? 0.55 : 0.28;
      ctx.lineWidth = isCurrent ? 2 : 1.1;
      ctx.beginPath();
      let started = false;
      for (let c = 0; c <= F24.P; c++) {
        const i = k * F24.P + c; if (i >= NPT) break;
        const x = X(i), y = Y(SERIES[i]);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    drawAxes(ctx, L, T, pw, ph, "Time (hours) — vertical lines mark each 24 h cycle", "Activity");
  }

  /* ── FOLD PANEL ── */
  function activeFold(t) {
    if (stageOf(t) < 3) return { period: TRUE_P, fd: F24 };
    const upto = clamp(Math.floor(prog(t, B.statEnd, 1) * SWEEP.length), 0, SWEEP.length - 1);
    const period = SWEEP[upto].p;
    return { period, fd: fold(period) };
  }
  function drawFold(t) {
    setupCanvas(cFold);
    const ctx = cFold.getContext("2d");
    const W = cFold.offsetWidth, H = cFold.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const L = 42, R = 14, T = 16, Bm = 30, pw = W - L - R, ph = H - T - Bm;
    ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);

    const stage = stageOf(t);
    const { fd } = activeFold(t);
    const P = fd.P, K = fd.K;
    const X = (c) => L + (c / (P - 1)) * pw;
    const Y = (v) => T + ph - ((v - VMIN) / (VMAX - VMIN)) * ph * 0.94 - ph * 0.03;

    const cyclesShown = stage === 0 ? clamp(Math.floor(prog(t, 0, B.foldEnd) * K) + 1, 0, K) : K;
    const binsShown = stage === 0 ? 0
      : stage === 1 ? clamp(Math.floor(prog(t, B.foldEnd, B.binEnd) * P) + 1, 0, P) : P;

    for (let k = 0; k < cyclesShown; k++) {
      const isCurrent = stage === 0 && k === cyclesShown - 1;
      ctx.strokeStyle = isCurrent ? C.gold : C.axis;
      ctx.globalAlpha = isCurrent ? 0.9 : 0.32;
      ctx.lineWidth = isCurrent ? 1.8 : 1;
      ctx.beginPath();
      let started = false;
      for (let c = 0; c < P; c++) {
        const idx = k * P + c; if (idx >= NPT) break;
        const x = X(c), y = Y(SERIES[idx]);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (stage === 1 && binsShown > 0) {
      const c = binsShown - 1;
      for (let k = 0; k < K; k++) {
        const idx = k * P + c; if (idx >= NPT) break;
        ctx.fillStyle = "rgba(230,168,23,0.85)";
        ctx.beginPath(); ctx.arc(X(c), Y(SERIES[idx]), 2.6, 0, 2 * Math.PI); ctx.fill();
      }
    }

    ctx.strokeStyle = C.red; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(L, Y(GRAND)); ctx.lineTo(L + pw, Y(GRAND)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.red; ctx.font = "9px system-ui,sans-serif"; ctx.textAlign = "left";
    ctx.fillText("grand mean Ȳ", L + 4, Y(GRAND) - 4);

    if (binsShown > 0) {
      ctx.strokeStyle = C.navy; ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let c = 0; c < binsShown; c++) { const x = X(c), y = Y(fd.means[c]); c ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.fillStyle = C.navy;
      for (let c = 0; c < binsShown; c++) { ctx.beginPath(); ctx.arc(X(c), Y(fd.means[c]), 2.2, 0, 2 * Math.PI); ctx.fill(); }
      if (stage === 1) {
        const c = binsShown - 1;
        ctx.strokeStyle = C.gold; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(X(c), Y(fd.means[c])); ctx.lineTo(X(c), Y(GRAND)); ctx.stroke();
      }
    }

    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    drawAxes(ctx, L, T, pw, ph, "Position within the trial period (bin)", "Activity");
  }

  /* ── STAT / PERIODOGRAM PANEL ── */
  function drawStat(t) {
    setupCanvas(cStat);
    const ctx = cStat.getContext("2d");
    const W = cStat.offsetWidth, H = cStat.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const L = 46, R = 40, T = 18, Bm = 32, pw = W - L - R, ph = H - T - Bm;
    const stage = stageOf(t);

    if (stage < 3) {
      ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);
      const P = F24.P;
      const mid = T + ph / 2;
      const X = (c) => L + ((c + 0.5) / P) * pw;
      const Yd = (d) => mid - (d / (MAXDEV * 1.1)) * (ph / 2) * 0.9;
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.4; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(L, mid); ctx.lineTo(L + pw, mid); ctx.stroke(); ctx.setLineDash([]);

      const binsShown = stage === 0 ? 0
        : stage === 1 ? clamp(Math.floor(prog(t, B.foldEnd, B.binEnd) * P) + 1, 0, P) : P;
      const bw = (pw / P) * 0.6;
      let running = 0;
      for (let c = 0; c < binsShown; c++) {
        const d = F24.means[c] - GRAND; running += d * d;
        const x = X(c), y = Yd(d);
        ctx.fillStyle = d >= 0 ? C.navy : C.data2;
        ctx.fillRect(x - bw / 2, Math.min(mid, y), bw, Math.abs(mid - y));
      }
      ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
      ctx.fillStyle = C.muted; ctx.font = "9px system-ui,sans-serif"; ctx.textAlign = "center";
      ctx.fillText("bin", L + pw / 2, T + ph + 14);
      ctx.save(); ctx.translate(13, T + ph / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillText("Ȳₕ − Ȳ", 0, 0); ctx.restore();
      ctx.fillStyle = C.text; ctx.font = "bold 11px system-ui,sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Σ (Ȳₕ − Ȳ)²  =  " + running.toFixed(0), L + pw / 2, T - 5);
    } else {
      ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);
      drawHGrid(ctx, L, T, pw, ph, 4);
      const upto = clamp(Math.floor(prog(t, B.statEnd, 1) * SWEEP.length), 0, SWEEP.length - 1);
      const X = (p) => L + ((p - PERIODS[0]) / (PERIODS[PERIODS.length - 1] - PERIODS[0])) * pw;
      const Yq = (q) => T + ph - (q / QPMAX) * ph;
      const Ya = (a) => T + ph - (a / APMAX) * ph;

      ctx.strokeStyle = C.red; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.beginPath();
      SWEEP.forEach((s, i) => { const x = X(s.p), y = Yq(s.crit); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke(); ctx.setLineDash([]);

      ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= upto; i++) { const x = X(SWEEP[i].p), y = Ya(SWEEP[i].Ap); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.strokeStyle = C.navy; ctx.lineWidth = 2.4; ctx.beginPath();
      for (let i = 0; i <= upto; i++) { const x = X(SWEEP[i].p), y = Yq(SWEEP[i].Qp); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      ctx.fillStyle = C.navy;
      ctx.beginPath(); ctx.arc(X(SWEEP[upto].p), Yq(SWEEP[upto].Qp), 4, 0, 2 * Math.PI); ctx.fill();

      if (upto >= SWEEP.length - 1) {
        const dx = X(SWEEP[DOM].p);
        ctx.strokeStyle = "rgba(230,168,23,0.6)"; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(dx, T); ctx.lineTo(dx, T + ph); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = C.navy; ctx.font = "bold 10px system-ui,sans-serif"; ctx.textAlign = "center";
        ctx.fillText(SWEEP[DOM].p.toFixed(1) + " h", dx, T + 12);
      }

      ctx.fillStyle = C.muted; ctx.font = "9px system-ui,sans-serif"; ctx.textAlign = "center";
      for (let p = 18; p <= 30; p += 3) ctx.fillText(p + " h", X(p), T + ph + 14);
      ctx.fillText("trial period", L + pw / 2, T + ph + 27);
      ctx.fillStyle = C.navy;
      ctx.save(); ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center";
      ctx.fillText("Qₚ (χ²)", 0, 0); ctx.restore();
      ctx.fillStyle = C.gold;
      ctx.save(); ctx.translate(W - 12, T + ph / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = "center";
      ctx.fillText("Aₚ (amplitude)", 0, 0); ctx.restore();
      ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    }
  }

  /* ── legend + readout + step text ── */
  function updateChrome(t) {
    const stage = stageOf(t);
    if (legendEl) {
      legendEl.innerHTML = stage < 3
        ? `<div class="legend-item"><div class="legend-swatch" style="background:${C.axis}"></div>Individual cycles</div>
           <div class="legend-item"><div class="legend-swatch" style="background:${C.navy}"></div>Bin means (form estimate)</div>
           <div class="legend-item"><div class="legend-swatch fp-dash"></div>Grand mean</div>
           <div class="legend-item"><div class="legend-swatch" style="background:${C.gold}"></div>Deviation being added</div>`
        : `<div class="legend-item"><div class="legend-swatch" style="background:${C.navy}"></div>Qₚ — Sokolove–Bushell χ²</div>
           <div class="legend-item"><div class="legend-swatch" style="background:${C.gold}"></div>Aₚ — Enright amplitude</div>
           <div class="legend-item"><div class="legend-swatch fp-dash"></div>χ² p = 0.05 threshold (rises with df)</div>`;
    }

    const a3 = stage === 3 ? activeFold(t) : null;
    const fd = a3 ? a3.fd : F24;
    const period = a3 ? a3.period : TRUE_P;
    let running = 0;
    if (stage === 1) {
      const binsShown = clamp(Math.floor(prog(t, B.foldEnd, B.binEnd) * F24.P) + 1, 0, F24.P);
      for (let c = 0; c < binsShown; c++) running += (F24.means[c] - GRAND) ** 2;
    } else if (stage >= 2) running = fd.num;
    const showStat = stage >= 2;
    if (statBox) {
      statBox.innerHTML =
        `<div class="fp-row"><span class="fp-lab">Trial period P</span><span class="fp-val">${period} h → ${fd.P} bins</span></div>
         <div class="fp-row"><span class="fp-lab">Cycles folded (K) · points (N)</span><span class="fp-val">K = ${fd.K} · N = 240</span></div>
         <div class="fp-row"><span class="fp-lab">Σ (Ȳₕ − Ȳ)²  <em>between-bin sum of squares</em></span><span class="fp-val">${running.toFixed(0)}</span></div>
         <div class="fp-row fp-sep"><span class="fp-lab">Enright amplitude  Aₚ = √( Σ(Ȳₕ−Ȳ)² / P )</span><span class="fp-val gold">${showStat ? fd.Ap.toFixed(2) : "—"}</span></div>
         <div class="fp-row"><span class="fp-lab">Sokolove–Bushell  Qₚ = N·K·Σ(Ȳₕ−Ȳ)² / Σ(xᵢ−Ȳ)²</span><span class="fp-val navy">${showStat ? fd.Qp.toFixed(1) + "  (df = " + fd.df + ")" : "—"}</span></div>`;
    }

    if (stepText) {
      if (stage === 0) {
        stepText.innerHTML = `<strong>1 · Fold.</strong> Each successive 24 h cycle of the record (top) is laid onto a single period (left). Ten cycles overlap to form the Buys–Ballot table — <span class="fp-mono">10 rows × 24 columns</span>.`;
      } else if (stage === 1) {
        stepText.innerHTML = `<strong>2 · Bin &amp; average.</strong> Within each column, the points across all cycles (gold dots) are averaged, giving one <strong>bin mean</strong> <span class="fp-mono">Ȳₕ</span> (navy). The gold stick shows how far each bin mean sits from the grand mean — the quantity both statistics are built from.`;
      } else if (stage === 2) {
        stepText.innerHTML = `<strong>3 · Summarise the spread.</strong> Enright takes the root-mean-square of the deviations, <span class="fp-mono">Aₚ = ${F24.Ap.toFixed(2)}</span> (this equals the SD of the bin means). Sokolove–Bushell scales the <em>same</em> sum of squares by <span class="fp-mono">N·K / Σ(xᵢ−Ȳ)²</span> into <span class="fp-mono">Qₚ = ${F24.Qp.toFixed(1)}</span>, referred to χ² with <span class="fp-mono">df = 23</span>.`;
      } else {
        stepText.innerHTML = `<strong>4 · Sweep the trial period.</strong> Repeating fold → bin → statistic at every candidate period traces the periodogram. <span class="fp-mono">Aₚ</span> and <span class="fp-mono">Qₚ</span> peak at the <strong>same period (${SWEEP[DOM].p.toFixed(1)} h)</strong> — they share a numerator. But only <span class="fp-mono">Qₚ</span> carries a significance threshold, and it <em>rises</em> with period because df = P − 1 grows.`;
      }
    }
  }

  function draw(f) {
    if (!cRaw) return;
    const t = f / TOTAL;
    drawRaw(t); drawFold(t); drawStat(t); updateChrome(t);
    if (progFill) progFill.style.width = t * 100 + "%";
    if (foldTitle) foldTitle.textContent = stageOf(t) < 3 ? "Folded onto one cycle · bin means emerge" : "Folded waveform · at " + activeFold(t).period + " h (the trial period)";
    if (statTitle) statTitle.textContent = stageOf(t) < 3 ? "Spread of the bin means → the statistic" : "Periodogram — Aₚ and Qₚ vs trial period";
    if (stepInd) stepInd.textContent = ["Fold", "Bin", "Statistic", "Sweep"][stageOf(t)];
    activeStage = stageOf(t);
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime; lastTime = ts;
    accum += dt * speed * 0.10;
    const steps = Math.floor(accum); accum -= steps;
    frame = Math.min(frame + steps, TOTAL);
    draw(frame);
    if (frame >= TOTAL) { playing = false; if (btnPlay) btnPlay.textContent = "▶ Play"; return; }
    raf = requestAnimationFrame(loop);
  }
  function toggle() {
    if (frame >= TOTAL) reset();
    playing = !playing;
    if (btnPlay) btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) { lastTime = null; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
  }
  function reset() {
    playing = false; cancelAnimationFrame(raf);
    frame = 0; lastTime = null; accum = 0;
    if (btnPlay) btnPlay.textContent = "▶ Play"; draw(0);
  }
  function seek(e) {
    const r = progWrap.getBoundingClientRect();
    frame = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * TOTAL);
    draw(frame);
  }
  function jump(stage) {
    playing = false; cancelAnimationFrame(raf);
    if (btnPlay) btnPlay.textContent = "▶ Play";
    frame = Math.round((STAGE_START[stage] + 0.01) * TOTAL);
    lastTime = null; accum = 0;
    draw(frame);
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
  <div class="fp-stage-nav">
    {#each ["1 · Fold", "2 · Bin (average)", "3 · Statistic", "4 · Sweep period"] as lbl, i}
      <button class="fp-stage-btn" class:active={activeStage === i} onclick={() => jump(i)}>{lbl}</button>
    {/each}
  </div>

  <div class="fp-step-text" bind:this={stepText}>Press <strong>Play</strong> to begin.</div>

  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>Raw recording — 10 days at 1 h resolution</h3>
      <canvas class="fp-raw" bind:this={cRaw}></canvas>
    </div>
  </div>

  <div class="viz-row two-col">
    <div class="chart-panel">
      <h3 bind:this={foldTitle}>Folded onto one cycle · bin means emerge</h3>
      <canvas class="fp-tall" bind:this={cFold}></canvas>
    </div>
    <div class="chart-panel">
      <h3 bind:this={statTitle}>Spread of the bin means → the statistic</h3>
      <canvas class="fp-tall" bind:this={cStat}></canvas>
    </div>
  </div>

  <div class="legend" bind:this={legendEl}></div>

  <div class="fp-stat-box" bind:this={statBox}></div>

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

<style>
  /* explicit canvas heights, overriding the global canvas max-height clamp */
  .fp-raw { height: 132px; max-height: none; min-height: 110px; }
  .fp-tall { height: 236px; max-height: none; min-height: 180px; }

  .fp-stage-nav { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; }
  .fp-stage-btn {
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    font: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.18s;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
  .fp-stage-btn:hover { border-color: var(--navy); color: var(--navy); }
  .fp-stage-btn.active { background: var(--navy); color: #fff; border-color: var(--navy); }

  .fp-step-text {
    background: var(--color-warning-bg, #fef9e7);
    border: 1px solid var(--color-warning, #e6a817);
    border-left: 4px solid var(--color-warning, #e6a817);
    border-radius: 5px;
    padding: 11px 16px;
    font-size: 0.83rem;
    line-height: 1.6;
    color: var(--text);
    margin-bottom: 8px;
    min-height: 3.1em;
  }
  .fp-step-text :global(strong) { color: var(--navy); }
  .fp-step-text :global(.fp-mono) {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.9em;
  }

  .fp-stat-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 12px 16px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
    font-size: 0.82rem;
    margin-top: 4px;
  }
  .fp-stat-box :global(.fp-row) { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
  .fp-stat-box :global(.fp-row.fp-sep) { border-top: 1px dashed var(--border); margin-top: 4px; padding-top: 6px; }
  .fp-stat-box :global(.fp-lab) { color: var(--muted); }
  .fp-stat-box :global(.fp-val) {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-weight: 600;
    color: var(--navy);
    white-space: nowrap;
  }
  .fp-stat-box :global(.fp-val.gold) { color: var(--gold); }
  .fp-stat-box :global(.fp-val.navy) { color: var(--navy); }

  .legend :global(.legend-swatch.fp-dash) {
    background: none !important;
    border-top: 2px dashed var(--red);
    height: 0;
  }
</style>
