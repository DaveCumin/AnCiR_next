<script>
  import { onMount } from "svelte";
  import {
    C,
    setupCanvas,
    drawAxes,
    seededRNG,
    initPalette,
  } from "$lib/animUtils.js";

  let { height = "500px" } = $props();

  const DAYS = 7,
    BINS = 48;
  const TOTAL = DAYS * BINS;

  function generateData() {
    const rng = seededRNG(42);
    const data = [];
    for (let d = 0; d < DAYS; d++) {
      const row = [];
      for (let b = 0; b < BINS; b++) {
        const hr = b * 0.5;
        const offset = d * 0.18;
        const active = hr >= 8 && hr < 22;
        const phase = ((hr - 8 - offset + 24) % 24) / 14;
        const base = active ? 0.6 + 0.4 * Math.sin(Math.PI * phase) : 0.07;
        row.push(Math.max(0, base + (rng() - 0.5) * 0.35));
      }
      data.push(row);
    }
    return data;
  }
  const actoData = generateData();

  let frame = 0,
    playing = false,
    raf = null,
    lastTime = null,
    accum = 0;
  let actoSpeed = 0.03;

  let cTS, cActo, btnPlay, progFill, progWrap, stepInd;

  function resize() {
    setupCanvas(cTS);
    setupCanvas(cActo);
    drawAll(frame);
  }

  function drawTS(f) {
    const ctx = cTS.getContext("2d");
    const W = cTS.offsetWidth,
      H = cTS.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 42,
      padR = 10,
      padT = 14,
      padB = 38;
    const pW = W - padL - padR,
      pH = H - padT - padB;

    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);

    for (let d = 0; d < DAYS; d++) {
      const x = padL + (d / DAYS) * pW;
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + pH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.muted;
      ctx.font = "9px Inter,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Day ${d + 1}`, x + pW / DAYS / 2, padT + pH + 16);
    }

    drawAxes(ctx, padL, padT, pW, pH, "", "Activity");

    const curDay = Math.floor(f / BINS),
      curBin = f % BINS;
    for (let d = 0; d < DAYS; d++) {
      for (let b = 0; b < BINS; b++) {
        const val = actoData[d][b];
        const xPos = padL + ((d * BINS + b) / TOTAL) * pW;
        const yPos = padT + pH - val * pH * 0.88;
        const isCur = d === curDay && b === curBin;
        const isPast = d * BINS + b <= f;
        ctx.globalAlpha = isCur ? 1 : isPast ? 0.85 : 0.22;
        ctx.fillStyle = C.data1;
        const r = isCur ? 5 : 2.5;
        ctx.beginPath();
        ctx.arc(xPos, yPos, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (f < TOTAL) {
      const sx = padL + (f / TOTAL) * pW;
      ctx.strokeStyle = C.gold + "a6";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, padT);
      ctx.lineTo(sx, padT + pH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawActogram(f) {
    const ctx = cActo.getContext("2d");
    const W = cActo.offsetWidth,
      H = cActo.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 42,
      padR = 10,
      padT = 14,
      padB = 38;
    const pW = W - padL - padR,
      pH = H - padT - padB;

    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);

    const rowH = pH / DAYS;
    const binW = pW / (BINS * 2);
    const curDay = Math.floor(f / BINS),
      curBin = f % BINS;

    for (let d = 0; d < DAYS; d++) {
      const y = padT + d * rowH;
      if (d > 0) {
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + pW, y);
        ctx.stroke();
      }
      const show = d < curDay ? BINS : d === curDay ? curBin + 1 : 0;
      for (let b = 0; b < show; b++) {
        const val = actoData[d][b];
        const barH = val * rowH * 0.88;
        ctx.fillStyle = C.data1;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(padL + b * binW, y + rowH - barH, binW - 0.4, barH);
        if (d > 0) {
          const pv = actoData[d][b];
          const pb = pv * rowH * 0.88;
          ctx.fillStyle = C.data1;
          ctx.fillRect(padL + (b + BINS) * binW, y - pb, binW - 0.4, pb);
        }
      }
    }
    ctx.globalAlpha = 1;

    const midX = padL + BINS * binW;
    ctx.strokeStyle = "rgba(0,59,113,0.25)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(midX, padT);
    ctx.lineTo(midX, padT + pH);
    ctx.stroke();
    ctx.setLineDash([]);

    const hrs = [0, 6, 12, 18, 24, 30, 36, 42, 48];
    const lbls = ["0", "6", "12", "18", "0", "6", "12", "18", "0"];
    ctx.fillStyle = C.muted;
    ctx.font = "8.5px Inter,sans-serif";
    ctx.textAlign = "center";
    hrs.forEach((h, i) =>
      ctx.fillText(lbls[i], padL + (h / 48) * pW, padT + pH + 14),
    );

    drawAxes(ctx, padL, padT, pW, pH, "Hour of Day", "Days");
  }

  function drawAll(f) {
    drawTS(f);
    drawActogram(f);
    progFill.style.width = (f / TOTAL) * 100 + "%";
    const day = Math.min(Math.floor(f / BINS) + 1, DAYS);
    stepInd.textContent = `Day ${day} / ${DAYS}`;
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;
    accum += dt * actoSpeed * 0.006 * BINS;
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

  function actoToggle() {
    if (frame >= TOTAL) actoReset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) {
      lastTime = null;
      raf = requestAnimationFrame(loop);
    } else cancelAnimationFrame(raf);
  }

  function actoReset() {
    playing = false;
    cancelAnimationFrame(raf);
    frame = 0;
    lastTime = null;
    accum = 0;
    btnPlay.textContent = "▶ Play";
    drawAll(0);
  }

  function actoSeek(e) {
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
      <h3>Continuous Time Series (7 days)</h3>
      <canvas bind:this={cTS}></canvas>
    </div>
    <div class="chart-panel">
      <h3>Actogram (Double-plotted)</h3>
      <canvas bind:this={cActo}></canvas>
    </div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={actoToggle}
      >&#9654; Play</button
    >
    <button class="btn secondary" onclick={actoReset}>&#8634; Reset</button>
    <div class="progress-wrap" bind:this={progWrap} onclick={actoSeek}>
      <div class="progress-fill" bind:this={progFill}></div>
    </div>
    <div class="speed-wrap">
      <span>Speed</span>
      <input
        type="range"
        min="0.005"
        max="2"
        step="0.005"
        value="0.03"
        oninput={(e) => {
          actoSpeed = +e.target.value;
        }}
      />
    </div>
    <div class="step-indicator" bind:this={stepInd}>Day 0 / 7</div>
  </div>
</div>
