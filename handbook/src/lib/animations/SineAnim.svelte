<script>
  import { onMount } from "svelte";
  import {
    C,
    setupCanvas,
    drawAxes,
    drawHGrid,
    initPalette,
  } from "$lib/animUtils.js";

  let { height = "500px" } = $props();

  let prog = 0;
  let playing = false;
  let raf = null;
  let lastTime = null;
  let sineSpeed = 0.8;
  const TOTAL_DUR = 4000;

  let canvas;
  let btnPlay;
  let progFill;
  let progWrap;
  let stepInd;

  function resize() {
    setupCanvas(canvas);
    draw(prog);
  }

  function draw(t) {
    const ctx = canvas.getContext("2d");
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);

    const padL = 58,
      padR = 32,
      padT = 38,
      padB = 52;
    const pW = W - padL - padR;
    const pH = H - padT - padB;

    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);

    const mesorY = padT + pH * 0.5;
    const amp = pH * 0.36;
    const xPerHour = pW / 48;

    drawHGrid(ctx, padL, padT, pW, pH, 4);
    drawAxes(ctx, padL, padT, pW, pH, "Time (hours)", "Activity");

    ctx.fillStyle = C.muted;
    ctx.font = "9.5px Inter,sans-serif";
    ctx.textAlign = "center";
    for (let h = 0; h <= 48; h += 6) {
      const x = padL + h * xPerHour;
      ctx.fillText(h, x, padT + pH + 16);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padT + pH);
      ctx.lineTo(x, padT + pH + 4);
      ctx.stroke();
    }

    ctx.fillStyle = C.muted;
    ctx.font = "9px Inter,sans-serif";
    ctx.textAlign = "right";
    ["High", "Mid", "Low"].forEach((label, i) => {
      const y = padT + i * 0.5 * pH;
      ctx.fillText(label, padL - 6, y + 3);
    });

    const pCurve = Math.min(1, t / 0.3);
    const pMesor = t < 0.3 ? 0 : Math.min(1, (t - 0.3) / 0.25);
    const pAmp = t < 0.55 ? 0 : Math.min(1, (t - 0.55) / 0.2);
    const pBrack = t < 0.75 ? 0 : Math.min(1, (t - 0.75) / 0.25);

    const drawToX = Math.round(pW * pCurve);
    if (drawToX > 1) {
      ctx.strokeStyle = C.data1;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let x = 0; x <= drawToX; x++) {
        const hours = (x / pW) * 48;
        const y = mesorY - amp * Math.sin((2 * Math.PI * hours) / 24);
        x === 0 ? ctx.moveTo(padL + x, y) : ctx.lineTo(padL + x, y);
      }
      ctx.stroke();
    }

    if (pMesor > 0) {
      ctx.globalAlpha = pMesor;
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 5]);
      ctx.beginPath();
      ctx.moveTo(padL, mesorY);
      ctx.lineTo(padL + pW, mesorY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.gold;
      ctx.font = "bold 11px Inter,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Mesor (M)", padL + 560, mesorY - 8);
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL - 10, mesorY);
      ctx.lineTo(padL, mesorY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (pAmp > 0) {
      ctx.globalAlpha = pAmp;
      const peakX = padL + 6 * xPerHour;
      const peakY = mesorY - amp;
      const ax = peakX - 22;
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, peakY);
      ctx.lineTo(ax, mesorY);
      ctx.stroke();
      [
        [peakY, -1],
        [mesorY, 1],
      ].forEach(([y, dir]) => {
        ctx.fillStyle = C.blue;
        ctx.beginPath();
        ctx.moveTo(ax, y);
        ctx.lineTo(ax - 5, y + dir * 8);
        ctx.lineTo(ax + 5, y + dir * 8);
        ctx.closePath();
        ctx.fill();
      });
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(ax, peakY);
      ctx.lineTo(peakX, peakY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.blue;
      ctx.font = "bold 11px Inter,sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("Amplitude (A)", ax + 40, mesorY + 20);
      ctx.globalAlpha = 1;
    }

    if (pBrack > 0) {
      ctx.globalAlpha = pBrack;
      const x1 = padL + 6 * xPerHour;
      const x2 = padL + 30 * xPerHour;
      const by = mesorY - amp - 10;
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, by);
      ctx.lineTo(x2, by);
      ctx.stroke();
      [x1, x2].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, by - 6);
        ctx.lineTo(x, by + 6);
        ctx.stroke();
      });
      ctx.fillStyle = C.green;
      ctx.font = "bold 11px Inter,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Period (\u03c4)", (x1 + x2) / 2, by + 15);
      ctx.globalAlpha = 1;
    }

    progFill.style.width = t * 100 + "%";
    const phase = t < 0.3 ? 1 : t < 0.55 ? 2 : t < 0.75 ? 3 : 4;
    stepInd.textContent = `Phase ${phase} / 4`;
  }

  function animate(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;
    prog = Math.min(1, prog + (dt / TOTAL_DUR) * sineSpeed);
    draw(prog);
    if (prog >= 1) {
      playing = false;
      btnPlay.textContent = "▶ Play";
      return;
    }
    raf = requestAnimationFrame(animate);
  }

  function sineToggle() {
    if (prog >= 1) sineReset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) {
      lastTime = null;
      raf = requestAnimationFrame(animate);
    } else cancelAnimationFrame(raf);
  }

  function sineReset() {
    playing = false;
    cancelAnimationFrame(raf);
    prog = 0;
    lastTime = null;
    btnPlay.textContent = "▶ Play";
    draw(0);
  }

  function sineSeek(e) {
    const rect = progWrap.getBoundingClientRect();
    prog = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    draw(prog);
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
      <h3>Components of a Sinusoidal Rhythm</h3>
      <canvas bind:this={canvas}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item">
      <div
        class="legend-swatch"
        style="background: var(--navy); height: 3px;"
      ></div>
      Sine curve
    </div>
    <div class="legend-item">
      <div
        class="legend-swatch"
        style="background: var(--gold); height: 2px; border-top: 2px dashed var(--gold);"
      ></div>
      Mesor (M)
    </div>
    <div class="legend-item">
      <div
        class="legend-swatch"
        style="background: var(--blue); height: 2px; border-top: 2px dashed var(--blue);"
      ></div>
      Amplitude (A)
    </div>
    <div class="legend-item">
      <div
        class="legend-swatch"
        style="background: var(--green); height: 2px; border-top: 2px dashed var(--green);"
      ></div>
      Period (&tau;)
    </div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={sineToggle}
      >&#9654; Play</button
    >
    <button class="btn secondary" onclick={sineReset}>&#8634; Reset</button>
    <div class="progress-wrap" bind:this={progWrap} onclick={sineSeek}>
      <div class="progress-fill" bind:this={progFill}></div>
    </div>
    <div class="speed-wrap">
      <span>Speed</span>
      <input
        type="range"
        min="0.1"
        max="4"
        step="0.05"
        value="0.8"
        oninput={(e) => {
          sineSpeed = +e.target.value;
        }}
      />
    </div>
    <div class="step-indicator" bind:this={stepInd}>Phase 1 / 4</div>
  </div>
</div>
