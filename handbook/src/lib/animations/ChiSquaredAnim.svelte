<script>
  import { onMount } from "svelte";
  import { C, setupCanvas, seededRNG, initPalette } from "$lib/animUtils.js";

  // stage="test"        Pearson chi-squared: observed vs expected counts
  // stage="periodogram" the same machine applied to a folded rhythm, then a
  //                     sweep of the trial period that draws the periodogram
  let { stage = "test", height = null } = $props();
  const H = height ?? (stage === "test" ? "440px" : "620px");

  // ── incomplete lower gamma, for the chi-squared CDF ───────────────────────
  function lnGamma(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
               -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5;
    t -= (x + 0.5) * Math.log(t);
    let s = 1.000000000190015;
    for (let j = 0; j < 6; j++) s += g[j] / ++y;
    return -t + Math.log((2.5066282746310005 * s) / x);
  }
  function lowerGammaReg(a, x) {          // P(a,x)
    if (x <= 0) return 0;
    if (x < a + 1) {                      // series
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 300; n++) {
        ap++; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    // continued fraction for Q, then complement
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
  const chiPDF = (x, k) =>
    x <= 0 ? 0 : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - lnGamma(k / 2) - (k / 2) * Math.LN2);
  // critical value by bisection
  function chiCrit(k, alpha = 0.05) {
    let lo = 0, hi = 200;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      chiCDF(mid, k) < 1 - alpha ? (lo = mid) : (hi = mid);
    }
    return (lo + hi) / 2;
  }

  // ══ STAGE 1 data: a categorical test ═════════════════════════════════════
  const CATS = ["Rhythmic", "Weak", "Arrhythmic"];
  const OBS = [34, 18, 8];
  const NTOT = OBS.reduce((a, b) => a + b, 0);
  const EXP = [NTOT / 3, NTOT / 3, NTOT / 3];       // null: equal proportions
  const CONTRIB = OBS.map((o, i) => ((o - EXP[i]) ** 2) / EXP[i]);
  const X2 = CONTRIB.reduce((a, b) => a + b, 0);
  const DF1 = CATS.length - 1;

  // ══ STAGE 2/3 data: a rhythm, folded ═════════════════════════════════════
  const rng = seededRNG(23);
  function gauss() { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const DT = 1, NPT = 240, TRUE_P = 24;             // 10 days, 1 h bins
  const SERIES = Array.from({ length: NPT }, (_, i) =>
    50 + 22 * Math.cos((2 * Math.PI * i * DT) / TRUE_P) + gauss() * 9);
  const GRAND = SERIES.reduce((a, b) => a + b, 0) / NPT;
  const SSTOT = SERIES.reduce((a, v) => a + (v - GRAND) ** 2, 0);

  // Sokolove-Bushell, matching AnCiR's periodogram.js exactly:
  //   Qp = (Σ_h (x̄_h − x̄)² · N · K) / Σ_i (x_i − x̄)²      df = P − 1
  function fold(period) {
    const P = Math.round(period / DT);
    const K = Math.ceil(NPT / P);
    const sums = new Array(P).fill(0), cnts = new Array(P).fill(0);
    for (let i = 0; i < NPT; i++) { const c = i % P; sums[c] += SERIES[i]; cnts[c]++; }
    const means = sums.map((s, i) => (cnts[i] ? s / cnts[i] : GRAND));
    const num = means.reduce((a, m) => a + (m - GRAND) ** 2, 0);
    return { P, K, means, Qp: (num * NPT * K) / SSTOT, df: P - 1 };
  }
  const PERIODS = [];
  for (let p = 18; p <= 30; p += 0.5) PERIODS.push(p);
  const SWEEP = PERIODS.map((p) => { const f = fold(p); return { p, Qp: f.Qp, crit: chiCrit(f.df) }; });
  const QMAX = Math.max(...SWEEP.map((s) => Math.max(s.Qp, s.crit))) * 1.1;
  const FOLD24 = fold(TRUE_P);

  // ── timeline ─────────────────────────────────────────────────────────────
  const TOTAL = 1000;
  const isTest = stage === "test";
  // periodogram stage: 0-.34 fold+accumulate, .34-.5 compare to chi2, .5-1 sweep
  const A_ACC = isTest ? 0.55 : 0.34, A_CMP = isTest ? 1.0 : 0.5;
  let frame = 0, playing = false, raf = null, lastTime = null, accum = 0, speed = 1;
  let cA, cB, btnPlay, progFill, progWrap, stepInd;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function resize() { if (cA) setupCanvas(cA); if (cB) setupCanvas(cB); draw(frame); }

  function draw(f) {
    const t = f / TOTAL;
    isTest ? drawBars(t) : drawFold(t);
    drawRight(t);
    if (progFill) progFill.style.width = t * 100 + "%";
    if (stepInd) stepInd.textContent = label(t);
  }

  function label(t) {
    if (isTest) {
      const k = clamp(Math.floor((t / A_ACC) * CATS.length), 0, CATS.length);
      return t >= A_ACC ? `χ² = ${X2.toFixed(2)}, df = ${DF1}, p = ${(1 - chiCDF(X2, DF1)).toFixed(4)}`
                        : `Adding category ${Math.min(k + 1, CATS.length)} of ${CATS.length}…`;
    }
    if (t < A_ACC) {
      const k = clamp(Math.floor((t / A_ACC) * FOLD24.P), 0, FOLD24.P);
      return `Folding at 24 h — bin ${Math.min(k + 1, FOLD24.P)} of ${FOLD24.P}`;
    }
    if (t < A_CMP) return `Q₍ₚ₎ = ${FOLD24.Qp.toFixed(1)}, df = ${FOLD24.df}`;
    const i = clamp(Math.floor(((t - A_CMP) / (1 - A_CMP)) * SWEEP.length), 0, SWEEP.length - 1);
    return `Trial period ${SWEEP[i].p.toFixed(1)} h — Q₍ₚ₎ = ${SWEEP[i].Qp.toFixed(1)}`;
  }

  // ── LEFT (stage 1): observed vs expected bars ────────────────────────────
  function drawBars(t) {
    const ctx = cA.getContext("2d"); const W = cA.offsetWidth, Hh = cA.offsetHeight;
    if (!W || !Hh) return; ctx.clearRect(0, 0, W, Hh);
    const L = 46, R = 16, T = 26, B = 40, pw = W - L - R, ph = Hh - T - B;
    const F = "Inter,system-ui,sans-serif";
    const vmax = Math.max(...OBS, ...EXP) * 1.25;
    const Y = (v) => T + ph - (v / vmax) * ph;
    const bw = pw / CATS.length;
    const shown = clamp(Math.floor((t / A_ACC) * CATS.length), 0, CATS.length);

    ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);
    CATS.forEach((c, i) => {
      const x = L + i * bw + bw * 0.22, w = bw * 0.56;
      ctx.fillStyle = i < shown ? C.navy : C.axis;
      ctx.globalAlpha = i < shown ? 1 : 0.4;
      ctx.fillRect(x, Y(OBS[i]), w, T + ph - Y(OBS[i])); ctx.globalAlpha = 1;
      // the gap between observed and expected
      if (i < shown) {
        ctx.strokeStyle = C.gold; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(x + w / 2, Y(OBS[i])); ctx.lineTo(x + w / 2, Y(EXP[i])); ctx.stroke();
        ctx.fillStyle = C.gold; ctx.font = "bold 10px " + F; ctx.textAlign = "center";
        ctx.fillText(`+${CONTRIB[i].toFixed(2)}`, x + w / 2, Y(Math.max(OBS[i], EXP[i])) - 6);
      }
      ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "center";
      ctx.fillText(c, L + i * bw + bw / 2, T + ph + 15);
      ctx.fillText(`obs ${OBS[i]}`, L + i * bw + bw / 2, T + ph + 28);
    });
    // expected line
    ctx.strokeStyle = C.red; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(L, Y(EXP[0])); ctx.lineTo(L + pw, Y(EXP[0])); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.red; ctx.font = "10px " + F; ctx.textAlign = "left";
    ctx.fillText(`expected ${EXP[0].toFixed(1)} each`, L + 4, Y(EXP[0]) - 5);

    ctx.strokeStyle = C.border; ctx.strokeRect(L, T, pw, ph);
    ctx.fillStyle = C.text; ctx.font = "bold 11px " + F; ctx.textAlign = "center";
    const run = CONTRIB.slice(0, shown).reduce((a, b) => a + b, 0);
    ctx.fillText(`Σ (O − E)² / E  =  ${run.toFixed(2)}`, L + pw / 2, T - 10);
  }

  // ── LEFT (stages 2/3): the fold, and the bin means ──────────────────────
  function drawFold(t) {
    const ctx = cA.getContext("2d"); const W = cA.offsetWidth, Hh = cA.offsetHeight;
    if (!W || !Hh) return; ctx.clearRect(0, 0, W, Hh);
    const L = 46, R = 16, T = 24, B = 34, pw = W - L - R, ph = Hh - T - B;
    const F = "Inter,system-ui,sans-serif";
    const sweeping = t >= A_CMP;
    const trial = sweeping
      ? SWEEP[clamp(Math.floor(((t - A_CMP) / (1 - A_CMP)) * SWEEP.length), 0, SWEEP.length - 1)].p
      : TRUE_P;
    const fd = fold(trial);
    const vmin = Math.min(...SERIES), vmax = Math.max(...SERIES);
    const X = (i) => L + (i / (fd.P - 1)) * pw;
    const Y = (v) => T + ph - ((v - vmin) / (vmax - vmin)) * ph;

    ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);
    // every cycle, overlaid — this IS the fold
    const cycles = Math.ceil(NPT / fd.P);
    for (let k = 0; k < cycles; k++) {
      ctx.strokeStyle = C.axis; ctx.globalAlpha = 0.30; ctx.lineWidth = 1;
      ctx.beginPath(); let started = false;
      for (let c = 0; c < fd.P; c++) {
        const idx = k * fd.P + c; if (idx >= NPT) break;
        const x = X(c), y = Y(SERIES[idx]);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // grand mean
    ctx.strokeStyle = C.red; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(L, Y(GRAND)); ctx.lineTo(L + pw, Y(GRAND)); ctx.stroke(); ctx.setLineDash([]);
    // bin means, revealed one at a time while accumulating
    const shown = sweeping || t >= A_ACC ? fd.P : clamp(Math.floor((t / A_ACC) * fd.P), 0, fd.P);
    ctx.strokeStyle = C.navy; ctx.lineWidth = 2.2; ctx.beginPath();
    for (let c = 0; c < shown; c++) { const x = X(c), y = Y(fd.means[c]); c ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    if (!sweeping && shown > 0 && shown <= fd.P) {
      const c = Math.min(shown - 1, fd.P - 1);
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(X(c), Y(fd.means[c])); ctx.lineTo(X(c), Y(GRAND)); ctx.stroke();
    }
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    ctx.fillStyle = C.text; ctx.font = "bold 11px " + F; ctx.textAlign = "center";
    ctx.fillText(`folded at ${trial.toFixed(1)} h  —  ${cycles} cycles overlaid`, L + pw / 2, T - 9);
    ctx.fillStyle = C.muted; ctx.font = "10px " + F;
    ctx.fillText("position within the trial period", L + pw / 2, T + ph + 16);
    ctx.textAlign = "left"; ctx.fillStyle = C.red;
    ctx.fillText("grand mean", L + 4, Y(GRAND) - 5);
  }

  // ── RIGHT: the chi-squared curve, or the periodogram being traced ───────
  function drawRight(t) {
    const ctx = cB.getContext("2d"); const W = cB.offsetWidth, Hh = cB.offsetHeight;
    if (!W || !Hh) return; ctx.clearRect(0, 0, W, Hh);
    const L = 46, R = 16, T = 22, B = 36, pw = W - L - R, ph = Hh - T - B;
    const F = "Inter,system-ui,sans-serif";
    const sweeping = !isTest && t >= A_CMP;

    if (!sweeping) {
      // the chi-squared reference distribution, with the statistic and its tail
      const df = isTest ? DF1 : FOLD24.df;
      const stat = isTest
        ? CONTRIB.slice(0, clamp(Math.floor((t / A_ACC) * CATS.length), 0, CATS.length)).reduce((a, b) => a + b, 0)
        : (t >= A_ACC ? FOLD24.Qp : 0);
      const xmax = Math.max(df * 3, stat * 1.25, 12);
      const X = (x) => L + (x / xmax) * pw;
      const pk = Math.max(...Array.from({ length: 200 }, (_, i) => chiPDF((i / 199) * xmax, df)));
      const Y = (y) => T + ph - (y / pk) * ph * 0.92;

      ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);
      // tail beyond the statistic = the p-value, as area
      if (stat > 0) {
        ctx.fillStyle = C.gold + "55"; ctx.beginPath(); ctx.moveTo(X(stat), T + ph);
        for (let x = stat; x <= xmax; x += xmax / 400) ctx.lineTo(X(x), Y(chiPDF(x, df)));
        ctx.lineTo(X(xmax), T + ph); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = C.navy; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 400; i++) { const x = (i / 400) * xmax; const px = X(x), py = Y(chiPDF(x, df)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
      if (stat > 0) {
        ctx.strokeStyle = C.red; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(X(stat), T); ctx.lineTo(X(stat), T + ph); ctx.stroke();
        ctx.fillStyle = C.red; ctx.font = "bold 10px " + F; ctx.textAlign = X(stat) > L + pw * 0.7 ? "right" : "left";
        ctx.fillText(`statistic = ${stat.toFixed(2)}`, X(stat) + (X(stat) > L + pw * 0.7 ? -5 : 5), T + 12);
      }
      ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
      ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "center";
      ctx.fillText(`χ² distribution, df = ${df}`, L + pw / 2, T - 8);
      ctx.fillText("shaded area = p", L + pw / 2, T + ph + 16);
      ctx.fillText("statistic value", L + pw / 2, T + ph + 29);
      return;
    }

    // ── stage 3: the periodogram, traced as the trial period sweeps ──────
    const upto = clamp(Math.floor(((t - A_CMP) / (1 - A_CMP)) * SWEEP.length), 0, SWEEP.length - 1);
    const X = (p) => L + ((p - PERIODS[0]) / (PERIODS[PERIODS.length - 1] - PERIODS[0])) * pw;
    const Y = (q) => T + ph - (q / QMAX) * ph;
    ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);
    // the significance threshold — note it RISES, because df = P − 1 grows
    ctx.strokeStyle = C.red; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]); ctx.beginPath();
    SWEEP.forEach((s, i) => { const x = X(s.p), y = Y(s.crit); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.red; ctx.font = "10px " + F; ctx.textAlign = "right";
    ctx.fillText("p = 0.05 threshold (rises with df)", L + pw - 4, Y(SWEEP[SWEEP.length - 1].crit) - 6);
    // Qp
    ctx.strokeStyle = C.navy; ctx.lineWidth = 2.4; ctx.beginPath();
    for (let i = 0; i <= upto; i++) { const x = X(SWEEP[i].p), y = Y(SWEEP[i].Qp); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.arc(X(SWEEP[upto].p), Y(SWEEP[upto].Qp), 4.5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "center";
    for (let p = 18; p <= 30; p += 3) ctx.fillText(p + " h", X(p), T + ph + 15);
    ctx.fillText("trial period", L + pw / 2, T + ph + 29);
    ctx.textAlign = "center"; ctx.fillText("Q₍ₚ₎", L + pw / 2, T - 8);
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime; lastTime = ts;
    accum += dt * speed * 0.16;
    const steps = Math.floor(accum); accum -= steps;
    frame = Math.min(frame + steps, TOTAL);
    draw(frame);
    if (frame >= TOTAL) { playing = false; btnPlay.textContent = "▶ Play"; return; }
    raf = requestAnimationFrame(loop);
  }
  function toggle() {
    if (frame >= TOTAL) reset();
    playing = !playing; btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) { lastTime = null; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
  }
  function reset() { playing = false; cancelAnimationFrame(raf); frame = 0; lastTime = null; accum = 0; btnPlay.textContent = "▶ Play"; draw(0); }
  function seek(e) { const r = progWrap.getBoundingClientRect();
    frame = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * TOTAL); draw(frame); }

  onMount(() => {
    initPalette(); resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(raf); };
  });
</script>

<div class="anim-embed" style={`height: ${H}`}>
  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>{isTest ? "Observed against expected" : "Every cycle, folded onto one period"}</h3>
      <canvas bind:this={cA}></canvas>
    </div>
  </div>
  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>{isTest ? "The χ² distribution, and the p-value as area" : "χ² reference, then the periodogram it builds"}</h3>
      <canvas bind:this={cB}></canvas>
    </div>
  </div>

  <div class="legend">
    {#if isTest}
      <div class="legend-item"><div class="legend-swatch" style="background: var(--navy)"></div>Observed</div>
      <div class="legend-item"><div class="legend-swatch" style="background: var(--red)"></div>Expected</div>
    {:else}
      <div class="legend-item"><div class="legend-swatch" style="background: var(--axis)"></div>Individual cycles</div>
      <div class="legend-item"><div class="legend-swatch" style="background: var(--navy)"></div>Bin means</div>
      <div class="legend-item"><div class="legend-swatch" style="background: var(--red)"></div>Grand mean / threshold</div>
    {/if}
    <div class="legend-item"><div class="legend-swatch" style="background: var(--gold)"></div>Contribution to χ²</div>
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
