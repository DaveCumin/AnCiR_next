<script>
  import { onMount } from "svelte";
  import { C, setupCanvas, seededRNG, initPalette } from "$lib/animUtils.js";

  let { height = "520px" } = $props();

  // ── two groups, fixed so the animation is reproducible ────────────────────
  const rng = seededRNG(17);
  function gauss() {
    let u = 0, v = 0;
    while (!u) u = rng();
    while (!v) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const NA = 12, NB = 12;
  const A = Array.from({ length: NA }, () => 52 + gauss() * 6);
  const B = Array.from({ length: NB }, () => 44 + gauss() * 6);
  const ALL = [...A, ...B];
  const N = ALL.length;

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const OBS = mean(A) - mean(B); // the observed difference

  // ── the permutation null: shuffle labels, recompute the difference ────────
  const NPERM = 400;
  const prng = seededRNG(29);
  const NULLS = [];
  const ASSIGN = []; // remember each shuffle so we can show it
  {
    const idx = [...Array(N).keys()];
    for (let p = 0; p < NPERM; p++) {
      for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(prng() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      const inA = new Set(idx.slice(0, NA));
      const a = [], b = [];
      ALL.forEach((v, i) => (inA.has(i) ? a : b).push(v));
      NULLS.push(mean(a) - mean(b));
      ASSIGN.push(new Set(inA));
    }
  }
  // two-sided p, with the observed value included in its own reference set
  const pAt = (k) => {
    const seen = NULLS.slice(0, k);
    const extreme = seen.filter((d) => Math.abs(d) >= Math.abs(OBS)).length;
    return (extreme + 1) / (seen.length + 1);
  };

  const LO = Math.min(...NULLS, -Math.abs(OBS)) - 1;
  const HI = Math.max(...NULLS, Math.abs(OBS)) + 1;
  const NBIN = 40;
  const binOf = (d) => Math.min(NBIN - 1, Math.max(0, Math.floor(((d - LO) / (HI - LO)) * NBIN)));

  const TOTAL = NPERM;
  let frame = 0, playing = false, raf = null, lastTime = null, accum = 0, speed = 1;
  let cTop, cBot, btnPlay, progFill, progWrap, stepInd;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function resize() { if (cTop) setupCanvas(cTop); if (cBot) setupCanvas(cBot); draw(frame); }

  function draw(f) {
    const k = clamp(f, 0, TOTAL);
    drawGroups(k);
    drawNull(k);
    if (progFill) progFill.style.width = (k / TOTAL) * 100 + "%";
    if (stepInd) {
      stepInd.textContent = k === 0
        ? `Observed difference = ${OBS.toFixed(2)}`
        : `${k} shuffles · p = ${pAt(k).toFixed(3)}`;
    }
  }

  // top: the data, coloured by the CURRENT label assignment
  function drawGroups(k) {
    const ctx = cTop.getContext("2d");
    const W = cTop.offsetWidth, H = cTop.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const L = 60, R = 16, T = 26, B = 30;
    const pw = W - L - R, ph = H - T - B;
    const F = "Inter,system-ui,sans-serif";
    const vmin = Math.min(...ALL) - 3, vmax = Math.max(...ALL) + 3;
    const X = (v) => L + ((v - vmin) / (vmax - vmin)) * pw;

    const shuffling = k > 0;
    const inA = shuffling ? ASSIGN[Math.min(k - 1, NPERM - 1)] : new Set([...Array(NA).keys()]);

    ctx.fillStyle = C.muted; ctx.font = "11px " + F; ctx.textAlign = "right";
    ctx.fillText(shuffling ? "shuffled A" : "group A", L - 8, T + ph * 0.30 + 4);
    ctx.fillText(shuffling ? "shuffled B" : "group B", L - 8, T + ph * 0.72 + 4);

    const rowA = T + ph * 0.30, rowB = T + ph * 0.72;
    const a = [], b = [];
    ALL.forEach((v, i) => (inA.has(i) ? a : b).push(v));

    ALL.forEach((v, i) => {
      const isA = inA.has(i);
      ctx.beginPath();
      ctx.arc(X(v), isA ? rowA : rowB, 4.2, 0, 2 * Math.PI);
      ctx.fillStyle = isA ? C.navy : C.data2;
      ctx.globalAlpha = shuffling ? 0.75 : 0.9;
      ctx.fill(); ctx.globalAlpha = 1;
    });

    // group means
    [[a, rowA, C.navy], [b, rowB, C.data2]].forEach(([g, row, col]) => {
      if (!g.length) return;
      const m = mean(g);
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(X(m), row - 14); ctx.lineTo(X(m), row + 14); ctx.stroke();
    });

    ctx.fillStyle = C.text; ctx.font = "bold 11px " + F; ctx.textAlign = "center";
    const d = a.length && b.length ? mean(a) - mean(b) : 0;
    ctx.fillText(
      shuffling ? `difference for this shuffle = ${d.toFixed(2)}` : `observed difference = ${OBS.toFixed(2)}`,
      L + pw / 2, T - 10
    );
    ctx.fillStyle = C.muted; ctx.font = "10px " + F;
    ctx.fillText("measured value", L + pw / 2, T + ph + 20);
  }

  // bottom: the null distribution building, with the observed value marked
  function drawNull(k) {
    const ctx = cBot.getContext("2d");
    const W = cBot.offsetWidth, H = cBot.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const L = 60, R = 16, T = 20, B = 34;
    const pw = W - L - R, ph = H - T - B;
    const F = "Inter,system-ui,sans-serif";
    const X = (d) => L + ((d - LO) / (HI - LO)) * pw;

    ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);

    const counts = new Array(NBIN).fill(0);
    for (let i = 0; i < k; i++) counts[binOf(NULLS[i])]++;
    const cmax = Math.max(4, ...counts);
    const bw = pw / NBIN;

    counts.forEach((c, i) => {
      if (!c) return;
      const centre = LO + ((i + 0.5) / NBIN) * (HI - LO);
      const isExtreme = Math.abs(centre) >= Math.abs(OBS);
      const h = (c / cmax) * ph * 0.92;
      ctx.fillStyle = isExtreme ? C.gold : C.blue;
      ctx.fillRect(L + i * bw + 0.5, T + ph - h, bw - 1, h);
    });

    // the observed difference, and its mirror (two-sided)
    [OBS, -OBS].forEach((v, i) => {
      ctx.strokeStyle = C.red; ctx.lineWidth = i ? 1.2 : 2.2;
      ctx.setLineDash(i ? [4, 3] : []);
      ctx.beginPath(); ctx.moveTo(X(v), T); ctx.lineTo(X(v), T + ph); ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.fillStyle = C.red; ctx.font = "bold 10px " + F; ctx.textAlign = "left";
    ctx.fillText("observed", X(OBS) + 5, T + 12);

    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "center";
    for (let d = Math.ceil(LO / 4) * 4; d <= HI; d += 4) ctx.fillText(d.toFixed(0), X(d), T + ph + 15);
    ctx.fillText("difference in means if the labels meant nothing", L + pw / 2, T + ph + 30);
    ctx.textAlign = "right"; ctx.fillText("count", L - 8, T + 10);
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime; lastTime = ts;
    accum += dt * speed * 0.05;
    const steps = Math.floor(accum); accum -= steps;
    frame = Math.min(frame + steps, TOTAL);
    draw(frame);
    if (frame >= TOTAL) { playing = false; btnPlay.textContent = "▶ Play"; return; }
    raf = requestAnimationFrame(loop);
  }
  function toggle() {
    if (frame >= TOTAL) reset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) { lastTime = null; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
  }
  function reset() {
    playing = false; cancelAnimationFrame(raf);
    frame = 0; lastTime = null; accum = 0; btnPlay.textContent = "▶ Play"; draw(0);
  }
  function seek(e) {
    const r = progWrap.getBoundingClientRect();
    frame = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * TOTAL);
    draw(frame);
  }

  onMount(() => {
    initPalette(); resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); cancelAnimationFrame(raf); };
  });
</script>

<div class="anim-embed" style={height ? `height: ${height}` : undefined}>
  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>The data — relabelled at random on every shuffle</h3>
      <canvas bind:this={cTop}></canvas>
    </div>
  </div>
  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>The null distribution, built one shuffle at a time</h3>
      <canvas bind:this={cBot}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="background: var(--navy)"></div>Group A</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--data2)"></div>Group B</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--blue)"></div>Shuffles less extreme</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--gold)"></div>Shuffles at least as extreme</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--red)"></div>Observed difference</div>
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
