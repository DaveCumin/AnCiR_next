<script>
  // Detrending animation: a rhythmic signal riding on a slow linear drift.
  // Left panel shows the raw data with the ordinary-least-squares trend line
  // fitted through it; the right panel reveals the residuals (raw − trend)
  // from left to right, showing that removing the drift leaves the rhythm on
  // a flat baseline. Modelled on the other animation components in this dir.
  import { onMount } from "svelte";
  import {
    C,
    setupCanvas,
    drawAxes,
    drawHGrid,
    seededRNG,
    initPalette,
  } from "$lib/animUtils.js";

  let { height = "440px" } = $props();

  const N = 168; // 7 days, hourly
  const TAU = 24;

  // Raw signal = baseline + linear drift + 24 h rhythm + noise.
  const raw = (() => {
    const rng = seededRNG(7);
    return Array.from({ length: N }, (_, i) => {
      const drift = 0.18 + 0.0026 * i; // slow upward baseline drift
      const rhythm = 0.26 * Math.sin(((2 * Math.PI) / TAU) * i - Math.PI / 2);
      const noise = (rng() - 0.5) * 0.09;
      return drift + rhythm + noise;
    });
  })();

  // Ordinary least-squares straight-line fit y = a + b·i (the "trend").
  const { a, b } = (() => {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < N; i++) {
      sx += i; sy += raw[i]; sxx += i * i; sxy += i * raw[i];
    }
    const denom = N * sxx - sx * sx;
    const bb = (N * sxy - sx * sy) / denom;
    const aa = (sy - bb * sx) / N;
    return { a: aa, b: bb };
  })();
  const fit = Array.from({ length: N }, (_, i) => a + b * i);
  const resid = Array.from({ length: N }, (_, i) => raw[i] - fit[i]);

  // Fixed y-ranges so the panels don't jump around.
  const rawMin = Math.min(...raw, ...fit) - 0.05;
  const rawMax = Math.max(...raw, ...fit) + 0.05;
  const rAbs = Math.max(...resid.map(Math.abs)) * 1.15;

  const TOTAL = N;
  let frame = 0,
    playing = false,
    raf = null,
    lastTime = null,
    accum = 0,
    speed = 0.6;

  let cRaw, cRes, btnPlay, progFill, progWrap, stepInd;

  function mapRaw(v, padT, pH) {
    return padT + pH - ((v - rawMin) / (rawMax - rawMin)) * pH;
  }
  function mapRes(v, padT, pH) {
    return padT + pH * 0.5 - (v / rAbs) * pH * 0.5;
  }

  function dayLines(ctx, padL, padT, pW, pH) {
    for (let d = 1; d < 7; d++) {
      const x = padL + ((d * 24) / N) * pW;
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.7;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + pH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawRaw() {
    const ctx = cRaw.getContext("2d");
    const W = cRaw.offsetWidth, H = cRaw.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 40, padT = 12, pW = W - 52, pH = H - 40;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    dayLines(ctx, padL, padT, pW, pH);
    // raw data
    ctx.strokeStyle = C.data1;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = padL + (i / N) * pW, y = mapRaw(raw[i], padT, pH);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // fitted trend line
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(padL, mapRaw(fit[0], padT, pH));
    ctx.lineTo(padL + pW, mapRaw(fit[N - 1], padT, pH));
    ctx.stroke();
    drawAxes(ctx, padL, padT, pW, pH, "Hour", "Signal");
  }

  function drawRes(upTo) {
    const ctx = cRes.getContext("2d");
    const W = cRes.offsetWidth, H = cRes.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 40, padT = 12, pW = W - 52, pH = H - 40;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    dayLines(ctx, padL, padT, pW, pH);
    // zero baseline (where the trend used to be)
    const zY = mapRes(0, padT, pH);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, zY);
    ctx.lineTo(padL + pW, zY);
    ctx.stroke();
    ctx.setLineDash([]);
    // residuals revealed up to `upTo`
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    for (let i = 0; i <= upTo && i < N; i++) {
      const x = padL + (i / N) * pW, y = mapRes(resid[i], padT, pH);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // sweep marker
    if (upTo < N - 1) {
      const x = padL + (upTo / N) * pW;
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + pH);
      ctx.stroke();
    }
    drawAxes(ctx, padL, padT, pW, pH, "Hour", "Residual");
  }

  function drawAll(f) {
    drawRaw();
    drawRes(f);
    const pct = Math.round((f / TOTAL) * 100);
    const lbl = `Trend removed: ${pct}%  |  slope b = ${b >= 0 ? "+" : ""}${b.toFixed(4)}/h`;
    if (stepInd) stepInd.textContent = lbl;
    if (progFill) progFill.style.width = pct + "%";
  }

  function resize() {
    [cRaw, cRes].forEach((c) => c && setupCanvas(c));
    drawAll(frame);
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;
    accum += dt * speed * 0.06;
    const steps = Math.floor(accum);
    accum -= steps;
    frame = Math.min(frame + steps, TOTAL);
    drawAll(frame);
    if (frame >= TOTAL) {
      playing = false;
      btnPlay.textContent = "▶ Play";
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function toggle() {
    if (frame >= TOTAL) reset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) {
      lastTime = null;
      raf = requestAnimationFrame(loop);
    } else cancelAnimationFrame(raf);
  }

  function reset() {
    playing = false;
    cancelAnimationFrame(raf);
    frame = 0;
    lastTime = null;
    accum = 0;
    btnPlay.textContent = "▶ Play";
    drawAll(0);
  }

  function seek(e) {
    const rect = progWrap.getBoundingClientRect();
    frame = Math.max(
      0,
      Math.round(
        Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * TOTAL,
      ),
    );
    drawAll(frame);
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
  <div class="viz-row two-col">
    <div class="chart-panel">
      <h3>Raw signal + fitted trend</h3>
      <canvas bind:this={cRaw}></canvas>
    </div>
    <div class="chart-panel">
      <h3>Detrended residuals (raw − trend)</h3>
      <canvas bind:this={cRes}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--data1, #04050A)"></div>
      Raw data
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--color-warning, #e6a817)"></div>
      Fitted trend (OLS)
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--color-success, #137333)"></div>
      Residuals (rhythm on a flat baseline)
    </div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={toggle}>&#9654; Play</button>
    <button class="btn secondary" onclick={reset}>&#8634; Reset</button>
    <div class="progress-wrap" bind:this={progWrap} onclick={seek}>
      <div class="progress-fill" bind:this={progFill}></div>
    </div>
    <div class="speed-wrap">
      <span>Speed</span>
      <input
        type="range"
        min="0.1"
        max="3"
        step="0.1"
        value="0.6"
        oninput={(e) => {
          speed = +e.target.value;
        }}
      />
    </div>
    <div class="step-indicator" bind:this={stepInd}>Trend removed: 0%</div>
  </div>
</div>
