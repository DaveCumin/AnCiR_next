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
    const rng = seededRNG(77);
    return Array.from({ length: N }, (_, i) => {
      const v =
        0.5 +
        0.4 * Math.sin(((2 * Math.PI) / 24) * i - Math.PI / 2) +
        0.18 * Math.sin(((2 * Math.PI) / 12) * i + 0.4) +
        (rng() - 0.5) * 0.1;
      return Math.max(0.05, Math.min(1, v));
    });
  })();

  const KMAX = Math.floor(N / 2);
  const power = new Float64Array(KMAX + 1);
  for (let k = 1; k <= KMAX; k++) {
    let re = 0,
      im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += sig[n] * Math.cos(angle);
      im -= sig[n] * Math.sin(angle);
    }
    power[k] = (Math.sqrt(re * re + im * im) / N) * 2;
  }
  const maxPow = Math.max(...power.slice(1));
  const K24 = Math.round(N / 24);
  const K12 = Math.round(N / 12);
  const K_SHOW = Math.min(KMAX, 42);
  const TOTAL = K_SHOW;

  let frame = 1,
    playing = false,
    raf = null,
    lastTime = null,
    accum = 0;
  let fftSpeed = 0.04;

  let cSig, cTest, cSpec, btnPlay, progFill, progWrap, stepInd, fftLabel;

  function resize() {
    [cSig, cTest, cSpec].forEach((c) => setupCanvas(c));
    drawSignal();
    drawAll(frame);
  }

  function drawSignal() {
    const ctx = cSig.getContext("2d");
    const W = cSig.offsetWidth,
      H = cSig.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 40,
      padT = 12,
      pW = W - 52,
      pH = H - 42;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    for (let d = 0; d <= 7; d++) {
      const x = padL + (d / 7) * pW;
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.7;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + pH);
      ctx.stroke();
      ctx.setLineDash([]);
      if (d > 0 && d < 7) {
        ctx.fillStyle = C.muted;
        ctx.font = "8.5px Inter,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`Day ${d}`, x + pW / (7 * 2), padT + pH + 16);
      }
    }
    ctx.strokeStyle = C.data1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = padL + (i / N) * pW,
        y = padT + pH - (sig[i] - 0.05) * pH * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    drawAxes(ctx, padL, padT, pW, pH, "", "Activity");
  }

  function drawTest(k) {
    const ctx = cTest.getContext("2d");
    const W = cTest.offsetWidth,
      H = cTest.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 12,
      padT = 10,
      pW = W - 24,
      pH = H - 38;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(padL, padT, pW, pH);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(padL, padT + pH / 2);
    ctx.lineTo(padL + pW, padT + pH / 2);
    ctx.stroke();
    ctx.strokeStyle = C.data1;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = padL + (i / N) * pW,
        y = padT + pH - (sig[i] - 0.05) * pH * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Draw the test curve: sin(omega * t + phase) with fixed amplitude
    // Compute re, im for this k (duplicate logic from FFT calculation)
    let re = 0,
      im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += sig[n] * Math.cos(angle);
      im -= sig[n] * Math.sin(angle);
    }
    const phase = Math.atan2(im, re);
    ctx.strokeStyle = C.data2;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= pW; x++) {
      const t = (x / pW) * N;
      const y =
        padT + pH / 2 - Math.sin((2 * Math.PI * k * t) / N + phase) * pH * 0.42;
      x === 0 ? ctx.moveTo(padL + x, y) : ctx.lineTo(padL + x, y);
    }
    ctx.stroke();
    const periodH = (N / k).toFixed(1);
    const label =
      +periodH >= 2 ? `Period: ${periodH} h  (k = ${k})` : `k = ${k}`;
    fftLabel.textContent = label;
    stepInd.textContent = label;
  }

  function drawSpec(upTo) {
    const ctx = cSpec.getContext("2d");
    const W = cSpec.offsetWidth,
      H = cSpec.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 42,
      padT = 14,
      pW = W - 54,
      pH = H - 46;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    const barW = pW / K_SHOW - 0.3;
    for (let k = 1; k <= Math.min(upTo, K_SHOW); k++) {
      const x = padL + ((k - 1) / K_SHOW) * pW;
      const bh = (power[k] / maxPow) * pH;
      const is24 = k === K24,
        is12 = k === K12,
        isLast = k === upTo;
      ctx.fillStyle = C.blue;
      ctx.globalAlpha = is24 || is12 || isLast ? 1 : 0.65;
      ctx.fillRect(x, padT + pH - bh, barW, bh);
    }
    ctx.globalAlpha = 1;
    if (upTo >= K24) {
      const x = padL + ((K24 - 1) / K_SHOW) * pW + barW / 2;
      ctx.fillStyle = C.navy;
      ctx.font = "bold 9px Inter,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("24h", x, padT + pH - (power[K24] / maxPow) * pH - 5);
    }
    if (upTo >= K12) {
      const x = padL + ((K12 - 1) / K_SHOW) * pW + barW / 2;
      ctx.fillStyle = C.navy;
      ctx.font = "bold 9px Inter,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("12h", x, padT + pH - (power[K12] / maxPow) * pH - 5);
    }
    [
      { k: K24, label: "24h" },
      { k: K12, label: "12h" },
      { k: Math.round(N / 8), label: "8h" },
    ].forEach(({ k, label }) => {
      if (k <= K_SHOW) {
        const x = padL + ((k - 1) / K_SHOW) * pW + barW / 2;
        ctx.fillStyle = C.muted;
        ctx.font = "8.5px Inter,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, x, padT + pH + 16);
      }
    });
    if (upTo < K_SHOW) {
      const cx = padL + (upTo / K_SHOW) * pW;
      ctx.strokeStyle = C.gold + "a6";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, padT);
      ctx.lineTo(cx, padT + pH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawAxes(ctx, padL, padT, pW, pH, "Period", "Magnitude");
    progFill.style.width = (upTo / TOTAL) * 100 + "%";
  }

  function drawAll(k) {
    drawTest(Math.max(1, Math.min(k, TOTAL)));
    drawSpec(k);
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;
    accum += dt * fftSpeed * 0.004 * TOTAL;
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

  function fftToggle() {
    if (frame >= TOTAL) fftReset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) {
      lastTime = null;
      raf = requestAnimationFrame(loop);
    } else cancelAnimationFrame(raf);
  }

  function fftReset() {
    playing = false;
    cancelAnimationFrame(raf);
    frame = 1;
    lastTime = null;
    accum = 0;
    btnPlay.textContent = "▶ Play";
    fftLabel.textContent = "Frequency: \u2014";
    drawAll(1);
  }

  function fftSeek(e) {
    const rect = progWrap.getBoundingClientRect();
    frame = Math.max(
      1,
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
  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>Composite Signal (24 h + 12 h components, 7 days)</h3>
      <canvas bind:this={cSig}></canvas>
    </div>
  </div>

  <div class="viz-row two-col">
    <div class="chart-panel">
      <h3>Current Test Frequency</h3>
      <canvas bind:this={cTest}></canvas>
      <div class="period-label" bind:this={fftLabel}>Frequency: &mdash;</div>
    </div>
    <div class="chart-panel">
      <h3>DFT Magnitude Spectrum</h3>
      <canvas bind:this={cSpec}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--data1)"></div>
      Composite signal
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--data2)"></div>
      Test sinusoid
    </div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={fftToggle}
      >&#9654; Play</button
    >
    <button class="btn secondary" onclick={fftReset}>&#8634; Reset</button>
    <div class="progress-wrap" bind:this={progWrap} onclick={fftSeek}>
      <div class="progress-fill" bind:this={progFill}></div>
    </div>
    <div class="speed-wrap">
      <span>Speed</span>
      <input
        type="range"
        min="0.01"
        max="6"
        step="0.01"
        value="0.08"
        oninput={(e) => {
          fftSpeed = +e.target.value;
        }}
      />
    </div>
    <div class="step-indicator" bind:this={stepInd}>Freq: &mdash;</div>
  </div>
</div>
