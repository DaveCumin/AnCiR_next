<script>
  import { onMount } from "svelte";
  import { C, setupCanvas, seededRNG, initPalette } from "$lib/animUtils.js";

  let { height = "500px" } = $props();

  // ── a small screen: 60 tests, 12 of them genuinely non-null ───────────────
  const M = 60, NTRUE = 12, ALPHA = 0.05;
  const rng = seededRNG(5);
  const RAW = [];
  for (let i = 0; i < M; i++) {
    // nulls: p ~ Uniform(0,1).  true effects: p concentrated near zero.
    const isTrue = i < NTRUE;
    const p = isTrue ? Math.pow(rng(), 6) * 0.06 : rng();
    RAW.push({ id: i, p, isTrue });
  }
  const SORTED = [...RAW].sort((a, b) => a.p - b.p).map((d, i) => ({ ...d, rank: i + 1 }));

  // Benjamini-Hochberg: largest i with p(i) <= i/m * alpha; reject 1..i
  let kBH = 0;
  SORTED.forEach((d) => { if (d.p <= (d.rank / M) * ALPHA) kBH = d.rank; });
  const BONF = ALPHA / M;
  const nBonf = SORTED.filter((d) => d.p <= BONF).length;

  const tally = (k) => {
    const rej = SORTED.slice(0, k);
    return { tp: rej.filter((d) => d.isTrue).length, fp: rej.filter((d) => !d.isTrue).length };
  };

  // stages: 0 unsorted -> 1 sorting -> 2 line drawn -> 3 threshold found
  const S_SORT = 0.34, S_LINE = 0.55, S_CUT = 0.75;
  const TOTAL = 1000;
  let frame = 0, playing = false, raf = null, lastTime = null, accum = 0, speed = 1;
  let cv, btnPlay, progFill, progWrap, stepInd;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function resize() { if (cv) setupCanvas(cv); draw(frame); }

  function draw(f) {
    const t = f / TOTAL;
    const ctx = cv.getContext("2d");
    const W = cv.offsetWidth, H = cv.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const L = 52, R = 18, T = 22, B = 40;
    const pw = W - L - R, ph = H - T - B;
    const F = "Inter,system-ui,sans-serif";
    const PMAX = 0.35; // zoom on the informative region
    const X = (rank) => L + ((rank - 0.5) / M) * pw;
    const Y = (p) => T + ph - clamp(p / PMAX, 0, 1) * ph;

    ctx.fillStyle = C.bg; ctx.fillRect(L, T, pw, ph);

    const sortT = clamp(t / S_SORT, 0, 1);
    const lineT = clamp((t - S_SORT) / (S_LINE - S_SORT), 0, 1);
    const cutT = clamp((t - S_LINE) / (S_CUT - S_LINE), 0, 1);
    const done = t >= S_CUT;

    // the BH line, drawn left to right
    if (lineT > 0) {
      ctx.strokeStyle = C.navy; ctx.lineWidth = 2;
      ctx.beginPath();
      const end = Math.max(1, Math.round(M * lineT));
      for (let i = 1; i <= end; i++) {
        const x = X(i), y = Y((i / M) * ALPHA);
        i === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = C.navy; ctx.font = "10px " + F; ctx.textAlign = "left";
      ctx.fillText("BH:  i/m × α", X(end) + 4, Y((end / M) * ALPHA) - 4);
    }

    // Bonferroni: a flat line at alpha/m
    if (lineT > 0.6) {
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1.4; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(L, Y(BONF)); ctx.lineTo(L + pw, Y(BONF)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "right";
      ctx.fillText("Bonferroni:  α/m", L + pw - 4, Y(BONF) - 4);
    }

    // the points: interpolate from unsorted position to sorted rank
    SORTED.forEach((d) => {
      const from = d.id + 1;               // original order
      const to = d.rank;                   // sorted order
      const rank = lerp(from, to, sortT);
      const x = X(rank), y = Y(d.p);
      const rejected = done && d.rank <= kBH;
      let fill = C.axis;
      if (cutT > 0) fill = rejected ? (d.isTrue ? C.green : C.red) : C.axis;
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.globalAlpha = d.p > PMAX ? 0.35 : 1;
      ctx.fill(); ctx.globalAlpha = 1;
    });

    // the cut
    if (cutT > 0 && kBH > 0) {
      const xc = X(kBH) + (pw / M) * 0.5;
      ctx.strokeStyle = C.gold; ctx.lineWidth = 2.4; ctx.globalAlpha = cutT;
      ctx.beginPath(); ctx.moveTo(xc, T); ctx.lineTo(xc, T + ph); ctx.stroke();
      ctx.fillStyle = C.gold; ctx.font = "bold 10px " + F; ctx.textAlign = "left";
      ctx.fillText(`reject these ${kBH}`, L + 6, T + 12);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph);
    ctx.fillStyle = C.muted; ctx.font = "10px " + F; ctx.textAlign = "right";
    [0, 0.05, 0.1, 0.2, 0.3].forEach((p) => ctx.fillText(p.toFixed(2), L - 6, Y(p) + 3));
    ctx.textAlign = "center";
    ctx.fillText(sortT < 1 ? "test (original order)" : "test, ranked by p-value", L + pw / 2, T + ph + 18);
    ctx.save(); ctx.translate(14, T + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.fillText("p-value", 0, 0); ctx.restore();

    if (progFill) progFill.style.width = t * 100 + "%";
    if (stepInd) {
      const { tp, fp } = tally(done ? kBH : 0);
      stepInd.textContent = !done
        ? (sortT < 1 ? "Sorting by p-value…" : lineT < 1 ? "Drawing the BH threshold…" : "Finding the cut…")
        : `BH: ${kBH} rejected (${tp} real, ${fp} false) · Bonferroni: ${nBonf}`;
    }
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime; lastTime = ts;
    accum += dt * speed * 0.28;
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
      <h3>Benjamini-Hochberg: sort, compare to a sloping line, cut</h3>
      <canvas bind:this={cv}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="background: var(--green)"></div>Rejected, real effect</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--red)"></div>Rejected, false positive</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--axis)"></div>Not rejected</div>
    <div class="legend-item"><div class="legend-swatch" style="background: var(--navy)"></div>BH threshold</div>
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
