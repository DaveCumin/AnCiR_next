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

  const N_HR = 168;
  const TRUE_PERIOD = 23.5;

  const signal = (() => {
    const rng = seededRNG(99);
    return Array.from({ length: N_HR }, (_, i) => {
      const phase = ((i % TRUE_PERIOD) / TRUE_PERIOD) * 2 * Math.PI;
      const active = Math.sin(phase - Math.PI * 0.3) > 0.1;
      const base = active ? 0.6 + 0.35 * Math.sin(phase - Math.PI * 0.3) : 0.05;
      return Math.max(0, base + (rng() - 0.5) * 0.3);
    });
  })();

  const TEST_PERIODS = [];
  for (let p = 8; p <= 30; p += 0.5) TEST_PERIODS.push(p);

  function computeR2(period) {
    const omega = (2 * Math.PI) / period;
    const meanY = signal.reduce((a, b) => a + b, 0) / N_HR;
    let sss = 0,
      ssc = 0,
      scc = 0,
      sy = 0,
      cy = 0;
    for (let i = 0; i < N_HR; i++) {
      const s = Math.sin(omega * i),
        c = Math.cos(omega * i);
      sss += s * s;
      ssc += s * c;
      scc += c * c;
      sy += (signal[i] - meanY) * s;
      cy += (signal[i] - meanY) * c;
    }
    const det = sss * scc - ssc * ssc;
    if (Math.abs(det) < 1e-10) return 0;
    const A = (scc * sy - ssc * cy) / det,
      B = (sss * cy - ssc * sy) / det;
    let ss_res = 0,
      ss_tot = 0;
    for (let i = 0; i < N_HR; i++) {
      const pred = meanY + A * Math.sin(omega * i) + B * Math.cos(omega * i);
      ss_res += (signal[i] - pred) ** 2;
      ss_tot += (signal[i] - meanY) ** 2;
    }
    return Math.max(0, 1 - ss_res / ss_tot);
  }

  const allR2 = TEST_PERIODS.map(computeR2);
  const maxR2 = Math.max(...allR2);
  const dominantIdx = allR2.indexOf(maxR2);
  const TOTAL = TEST_PERIODS.length;

  let frame = 0,
    playing = false,
    raf = null,
    lastTime = null,
    accum = 0;
  let periodSpeed = 0.08;

  let cTest,
    cOverlay,
    cPgram,
    btnPlay,
    progFill,
    progWrap,
    stepInd,
    periodLabel;

  function resize() {
    [cTest, cOverlay, cPgram].forEach((c) => setupCanvas(c));
    drawAll(frame);
  }

  function drawTest(period) {
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
    const omega = (2 * Math.PI) / period;
    ctx.strokeStyle = C.data2;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= pW; x++) {
      const t = (x / pW) * N_HR;
      const y = padT + pH / 2 - Math.sin(omega * t) * pH * 0.42;
      x === 0 ? ctx.moveTo(padL + x, y) : ctx.lineTo(padL + x, y);
    }
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.font = "9px Inter,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Time (hours)", padL + pW / 2, padT + pH + 18);
  }

  function drawOverlay(period) {
    const ctx = cOverlay.getContext("2d");
    const W = cOverlay.offsetWidth,
      H = cOverlay.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 32,
      padT = 10,
      pW = W - 42,
      pH = H - 38;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(padL, padT, pW, pH);
    ctx.strokeStyle = C.data1;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < N_HR; i++) {
      const x = padL + (i / N_HR) * pW,
        y = padT + pH - signal[i] * pH * 0.9;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    // At the end, show the true period in gold; otherwise, show the best-fit for the current period
    let showPeriod = period;
    let showColor = C.data2;
    let phi = 0;
    if (frame >= TOTAL - 1) {
      showPeriod = TRUE_PERIOD;
      showColor = C.gold;
    }
    const omega = (2 * Math.PI) / showPeriod;
    const meanY = signal.reduce((a, b) => a + b, 0) / N_HR;
    let sss = 0,
      ssc = 0,
      scc = 0,
      sy = 0,
      cy = 0;
    for (let i = 0; i < N_HR; i++) {
      const s = Math.sin(omega * i),
        c = Math.cos(omega * i);
      sss += s * s;
      ssc += s * c;
      scc += c * c;
      sy += (signal[i] - meanY) * s;
      cy += (signal[i] - meanY) * c;
    }
    const det = sss * scc - ssc * ssc;
    if (Math.abs(det) > 1e-10) {
      const A = (scc * sy - ssc * cy) / det;
      const B = (sss * cy - ssc * sy) / det;
      phi = Math.atan2(B, A);
    }
    ctx.strokeStyle = showColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= pW; x++) {
      const t = (x / pW) * N_HR;
      const y = padT + pH / 2 - Math.sin(omega * t + phi) * pH * 0.42;
      x === 0 ? ctx.moveTo(padL + x, y) : ctx.lineTo(padL + x, y);
    }
    ctx.stroke();
    ctx.fillStyle = C.data1;

    drawAxes(ctx, padL, padT, pW, pH, "Time", "Activity");
  }

  function drawPeriodogram(upTo) {
    const ctx = cPgram.getContext("2d");
    const W = cPgram.offsetWidth,
      H = cPgram.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 48,
      padT = 18,
      pW = W - 64,
      pH = H - 58;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    for (let r = 0; r <= 4; r++) {
      const y = padT + (r / 4) * pH;
      ctx.fillStyle = C.muted;
      ctx.font = "8px Inter,sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(((1 - r / 4) * maxR2).toFixed(2), padL - 5, y + 3);
    }
    [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30].forEach((tp) => {
      const x = padL + ((tp - 8) / (30 - 8)) * pW;
      ctx.fillStyle = C.muted;
      ctx.font = "8.5px Inter,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(tp + "h", x, padT + pH + 16);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(x, padT + pH);
      ctx.lineTo(x, padT + pH + 4);
      ctx.stroke();
    });
    drawAxes(ctx, padL, padT, pW, pH, "Period (Hours)", "Power (R\u00b2)");
    const barW = pW / TOTAL - 0.5;
    for (let i = 0; i <= Math.min(upTo, TOTAL - 1); i++) {
      const x = padL + (i / TOTAL) * pW;
      const bh = (allR2[i] / maxR2) * pH;
      const isDom = i === dominantIdx && upTo >= TOTAL - 1;
      const isLast = i === upTo;
      ctx.fillStyle = isDom ? C.gold : isLast ? C.navy : C.blue;
      ctx.globalAlpha = isDom || isLast ? 1 : 0.72;
      ctx.fillRect(x, padT + pH - bh, barW, bh);
    }
    ctx.globalAlpha = 1;
    if (upTo >= TOTAL - 1) {
      const dx = padL + (dominantIdx / TOTAL) * pW;
      ctx.fillStyle = C.gold;
      ctx.font = "bold 10px Inter,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        `${TEST_PERIODS[dominantIdx].toFixed(1)} h`,
        dx - 8,
        padT - 6,
      );
    }
    if (upTo < TOTAL) {
      const cx = padL + (upTo / TOTAL) * pW;
      ctx.strokeStyle = C.gold + "a6";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, padT);
      ctx.lineTo(cx, padT + pH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawAll(f) {
    const i = Math.min(f, TOTAL - 1);
    const p = TEST_PERIODS[i];
    const done = f >= TOTAL;
    drawTest(p);
    drawOverlay(p);
    drawPeriodogram(f);
    periodLabel.textContent = done
      ? `Dominant Period: ${TEST_PERIODS[dominantIdx].toFixed(1)} h`
      : `Period: ${p.toFixed(1)} h`;
    stepInd.textContent = done
      ? `Done \u2014 ${TEST_PERIODS[dominantIdx].toFixed(1)} h`
      : `${p.toFixed(1)} h`;
    progFill.style.width = (f / TOTAL) * 100 + "%";
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;
    accum += (dt * periodSpeed * 0.005 * TOTAL) / 10;
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

  function periodToggle() {
    if (frame >= TOTAL) periodReset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) {
      lastTime = null;
      raf = requestAnimationFrame(loop);
    } else cancelAnimationFrame(raf);
  }

  function periodReset() {
    playing = false;
    cancelAnimationFrame(raf);
    frame = 0;
    lastTime = null;
    accum = 0;
    btnPlay.textContent = "▶ Play";
    drawAll(0);
  }

  function periodSeek(e) {
    const rect = progWrap.getBoundingClientRect();
    frame = Math.round(
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * TOTAL,
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
      <h3>Test Sine Wave</h3>
      <canvas bind:this={cTest}></canvas>
      <div class="period-label" bind:this={periodLabel}>Period: &mdash; h</div>
    </div>
    <div class="chart-panel">
      <h3>Data vs Test Wave</h3>
      <canvas bind:this={cOverlay}></canvas>
    </div>
  </div>

  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>Periodogram (R&sup2; vs Period)</h3>
      <canvas bind:this={cPgram}></canvas>
    </div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={periodToggle}
      >&#9654; Play</button
    >
    <button class="btn secondary" onclick={periodReset}>&#8634; Reset</button>
    <div class="progress-wrap" bind:this={progWrap} onclick={periodSeek}>
      <div class="progress-fill" bind:this={progFill}></div>
    </div>
    <div class="speed-wrap">
      <span>Speed</span>
      <input
        type="range"
        min="0.01"
        max="4"
        step="0.01"
        value="0.08"
        oninput={(e) => {
          periodSpeed = +e.target.value;
        }}
      />
    </div>
    <div class="step-indicator" bind:this={stepInd}>Period: &mdash;</div>
  </div>
</div>
