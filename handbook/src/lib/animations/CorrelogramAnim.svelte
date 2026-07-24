<script>
  import { onMount } from "svelte";
  import {
    C,
    setupCanvas,
    drawAxes,
    drawHGrid,
    seededRNG,
    initPalette,
  } from "$lib/animUtils.js";

  let { height = "500px" } = $props();

  const N = 168;
  const sig = (() => {
    const rng = seededRNG(99);
    return Array.from({ length: N }, (_, i) => {
      const v =
        0.5 +
        0.4 * Math.sin(((2 * Math.PI) / 23.5) * i - Math.PI / 2) +
        (rng() - 0.5) * 0.12;
      return Math.max(0.05, Math.min(1, v));
    });
  })();

  const mean = sig.reduce((a, v) => a + v, 0) / N;
  const variance = sig.reduce((a, v) => a + (v - mean) ** 2, 0) / N;
  const LAG_MAX = 72;

  const acf = new Float64Array(LAG_MAX + 1);
  for (let lag = 0; lag <= LAG_MAX; lag++) {
    let sum = 0;
    for (let i = 0; i < N - lag; i++)
      sum += (sig[i] - mean) * (sig[i + lag] - mean);
    acf[lag] = sum / (N * variance);
  }

  const CI = 1.96 / Math.sqrt(N);
  const TOTAL = LAG_MAX;

  let frame = 0,
    playing = false,
    raf = null,
    lastTime = null,
    accum = 0;
  let acfSpeed = 0.1;

  let cSig, cLag, cAcf, btnPlay, progFill, progWrap, stepInd, lagLabel;

  function resize() {
    [cSig, cLag, cAcf].forEach((c) => setupCanvas(c));
    drawSig();
    drawAll(frame);
  }

  function drawSig() {
    const ctx = cSig.getContext("2d");
    const W = cSig.offsetWidth,
      H = cSig.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 38,
      padT = 10,
      pW = W - 50,
      pH = H - 38;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    ctx.strokeStyle = C.data1;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = padL + (i / N) * pW,
        y = padT + pH - (sig[i] - 0.05) * pH * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
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
    drawAxes(ctx, padL, padT, pW, pH, "Hour", "Activity");
  }

  function drawLag(lag) {
    const ctx = cLag.getContext("2d");
    const W = cLag.offsetWidth,
      H = cLag.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 38,
      padT = 10,
      pW = W - 50,
      pH = H - 38;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    ctx.strokeStyle = C.data1;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = padL + (i / N) * pW,
        y = padT + pH - (sig[i] - 0.05) * pH * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.data2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = lag; i < N; i++) {
      const x = padL + (i / N) * pW,
        y = padT + pH - (sig[i - lag] - 0.05) * pH * 0.9;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    drawAxes(ctx, padL, padT, pW, pH, "Hour", "Activity");
  }

  function drawAcf(upTo) {
    const ctx = cAcf.getContext("2d");
    const W = cAcf.offsetWidth,
      H = cAcf.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 44,
      padT = 14,
      pW = W - 58,
      pH = H - 46;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    const midY = padT + pH * 0.5;
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    const ciY_pos = padT + pH * (0.5 - CI * 0.5);
    const ciY_neg = padT + pH * (0.5 + CI * 0.5);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, ciY_pos);
    ctx.lineTo(padL + pW, ciY_pos);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padL, ciY_neg);
    ctx.lineTo(padL + pW, ciY_neg);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.gold + "99";
    ctx.font = "8px Inter,sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("+CI", padL - 2, ciY_pos + 3);
    ctx.fillText("-CI", padL - 2, ciY_neg + 3);
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(padL, midY);
    ctx.lineTo(padL + pW, midY);
    ctx.stroke();
    const barW = pW / LAG_MAX - 0.4;
    for (let lag = 0; lag <= Math.min(upTo, LAG_MAX); lag++) {
      const x = padL + (lag / LAG_MAX) * pW;
      const r = acf[lag];
      const barH = Math.abs(r) * pH * 0.5;
      const y = r >= 0 ? midY - barH : midY;
      const isCur = lag === upTo;
      const isSig = lag > 0 && Math.abs(r) > CI;
      ctx.fillStyle = isSig ? C.gold : C.blue;
      ctx.globalAlpha = isSig || isCur ? 1 : 0.65;
      ctx.fillRect(x, y, barW, barH);
    }
    ctx.globalAlpha = 1;
    [0, 12, 24, 36, 48, 60, 72].forEach((lag) => {
      const x = padL + (lag / LAG_MAX) * pW;
      ctx.fillStyle = C.muted;
      ctx.font = "8.5px Inter,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(lag + "h", x, padT + pH + 18);
    });
    [-1, -0.5, 0, 0.5, 1].forEach((v) => {
      const y = padT + pH * (0.5 - v * 0.5);
      ctx.fillStyle = C.muted;
      ctx.font = "8px Inter,sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(v.toFixed(1), padL - 4, y + 3);
    });
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(padL, padT, pW, pH);
    progFill.style.width = (upTo / TOTAL) * 100 + "%";
  }

  function drawAll(lag) {
    drawLag(lag);
    drawAcf(lag);
    const lbl = `Lag: ${lag} h  |  r = ${acf[lag] >= 0 ? "+" : ""}${acf[lag].toFixed(3)}`;
    lagLabel.textContent = lbl;
    stepInd.textContent = lbl;
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;
    accum += dt * acfSpeed * 0.004 * TOTAL;
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

  function acfToggle() {
    if (frame >= TOTAL) acfReset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) {
      lastTime = null;
      raf = requestAnimationFrame(loop);
    } else cancelAnimationFrame(raf);
  }

  function acfReset() {
    playing = false;
    cancelAnimationFrame(raf);
    frame = 0;
    lastTime = null;
    accum = 0;
    btnPlay.textContent = "▶ Play";
    drawAll(0);
  }

  function acfSeek(e) {
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
      <h3>Original Signal (7 days)</h3>
      <canvas bind:this={cSig}></canvas>
      <div class="period-label" bind:this={lagLabel}>Lag: 0 h</div>
    </div>
    <div class="chart-panel">
      <h3>Lagged Signal Overlay</h3>
      <canvas bind:this={cLag}></canvas>
    </div>
  </div>

  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>Autocorrelation Function</h3>
      <canvas bind:this={cAcf}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--data1, #04050A)"></div>
      Original signal
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--data2, #be796b)"></div>
      Lagged copy
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--gold)"></div>
      Significant autocorrelation
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--blue)"></div>
      Non-significant
    </div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={acfToggle}
      >&#9654; Play</button
    >
    <button class="btn secondary" onclick={acfReset}>&#8634; Reset</button>
    <div class="progress-wrap" bind:this={progWrap} onclick={acfSeek}>
      <div class="progress-fill" bind:this={progFill}></div>
    </div>
    <div class="speed-wrap">
      <span>Speed</span>
      <input
        type="range"
        min="0.01"
        max="6"
        step="0.01"
        value="0.10"
        oninput={(e) => {
          acfSpeed = +e.target.value;
        }}
      />
    </div>
    <div class="step-indicator" bind:this={stepInd}>Lag: 0 h</div>
  </div>
</div>
