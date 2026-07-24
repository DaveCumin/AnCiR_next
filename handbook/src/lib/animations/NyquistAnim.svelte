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

  const DURATION = 96; // hours displayed
  const TRUE_PERIOD = 24;
  const NYQUIST_LIMIT = 12; // half the true period
  const MIN_IV = 2;
  const MAX_IV = 28;
  // Fraction along slider where Nyquist limit falls: (12-2)/(28-2)
  const NYQUIST_PCT = (
    ((NYQUIST_LIMIT - MIN_IV) / (MAX_IV - MIN_IV)) *
    100
  ).toFixed(2);

  let sampleInterval = $state(4);
  let playing = false;
  let raf = null;
  let lastTime = null;
  let sweepSpeed = 1;
  let prog = (4 - MIN_IV) / (MAX_IV - MIN_IV);

  let cTop, cBot, btnPlay;

  function trueSignal(t) {
    return Math.sin((2 * Math.PI * t) / TRUE_PERIOD);
  }

  function getSamples(T_s) {
    const pts = [];
    for (let t = 0; t <= DURATION + 1e-6; t += T_s) {
      pts.push({ t, y: trueSignal(t) });
    }
    return pts;
  }

  // When T_s ∈ (NYQUIST_LIMIT, TRUE_PERIOD), the aliased sinusoid that passes
  // through every sample point is  y_alias(t) = -sin(2π t / T_alias)
  // Derivation: sin(-2πn·T_s/T_alias) = sin(-2πn(24-T_s)/24) = sin(2πn·T_s/24) ✓
  function aliasedPeriod(T_s) {
    if (T_s < NYQUIST_LIMIT || T_s >= TRUE_PERIOD) return null;
    return (T_s * TRUE_PERIOD) / (TRUE_PERIOD - T_s);
  }

  function drawCanvas(canvas, T_s, isTop) {
    const ctx = canvas.getContext("2d");
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);

    const padL = 44,
      padR = 14,
      padT = 22,
      padB = 30;
    const pW = W - padL - padR;
    const pH = H - padT - padB;

    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    drawAxes(ctx, padL, padT, pW, pH, "Time (hours)", "");

    // X labels every 24 h + faint day markers
    ctx.fillStyle = C.muted;
    ctx.font = "9px Inter,sans-serif";
    ctx.textAlign = "center";
    for (let h = 0; h <= DURATION; h += 24) {
      const x = padL + (h / DURATION) * pW;
      ctx.fillText(h, x, padT + pH + 13);
      if (h > 0) {
        ctx.save();
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 0.7;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + pH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Y labels
    ctx.textAlign = "right";
    ctx.fillText("+1", padL - 4, padT + 5);
    ctx.fillText("0", padL - 4, padT + pH / 2 + 4);
    ctx.fillText("−1", padL - 4, padT + pH - 1);

    const toX = (t) => padL + (t / DURATION) * pW;
    const toY = (y) => padT + pH / 2 - y * (pH / 2 - 5);
    const samples = getSamples(T_s);

    if (isTop) {
      // ── True signal ──
      ctx.strokeStyle = C.data1;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i <= pW; i++) {
        const t = (i / pW) * DURATION;
        i === 0
          ? ctx.moveTo(padL + i, toY(trueSignal(t)))
          : ctx.lineTo(padL + i, toY(trueSignal(t)));
      }
      ctx.stroke();

      // Vertical sample lines (faint)
      ctx.strokeStyle = C.gold + "44";
      ctx.lineWidth = 1;
      samples.forEach(({ t }) => {
        ctx.beginPath();
        ctx.moveTo(toX(t), padT);
        ctx.lineTo(toX(t), padT + pH);
        ctx.stroke();
      });

      // Sample dots
      samples.forEach(({ t, y }) => {
        ctx.beginPath();
        ctx.arc(toX(t), toY(y), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = C.gold;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });

      // Nyquist status badge (top-right of plot)
      const ok = T_s < NYQUIST_LIMIT;
      ctx.fillStyle = ok ? C.green : C.red;
      ctx.font = "bold 9.5px Inter,sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(
        ok
          ? "✓ Nyquist satisfied (Ts < 12 h)"
          : "✗ Below Nyquist (Ts \u2265 12 h)",
        padL + pW - 5,
        padT + 13,
      );
    } else {
      // ── Faint true reference ──
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = C.data1;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let i = 0; i <= pW; i++) {
        const t = (i / pW) * DURATION;
        i === 0
          ? ctx.moveTo(padL + i, toY(trueSignal(t)))
          : ctx.lineTo(padL + i, toY(trueSignal(t)));
      }
      ctx.stroke();
      ctx.restore();

      // ── Linear-interpolation reconstruction ──
      if (samples.length > 1) {
        ctx.strokeStyle = C.data2;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = "round";
        ctx.beginPath();
        samples.forEach(({ t, y }, i) => {
          i === 0 ? ctx.moveTo(toX(t), toY(y)) : ctx.lineTo(toX(t), toY(y));
        });
        ctx.stroke();
      }

      // ── Aliased sinusoid (red dashed) when T_s ∈ (12, 24) ──
      const T_alias = aliasedPeriod(T_s);
      if (T_alias !== null) {
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        for (let i = 0; i <= pW; i++) {
          const t = (i / pW) * DURATION;
          const y = -Math.sin((2 * Math.PI * t) / T_alias);
          i === 0 ? ctx.moveTo(padL + i, toY(y)) : ctx.lineTo(padL + i, toY(y));
        }
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = C.red;
        ctx.font = "bold 9.5px Inter,sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(
          `Apparent period \u2248 ${T_alias.toFixed(1)} h`,
          padL + pW - 5,
          padT + 13,
        );
      } else if (T_s < NYQUIST_LIMIT) {
        ctx.fillStyle = C.green;
        ctx.font = "bold 9.5px Inter,sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("Faithful reconstruction", padL + pW - 5, padT + 13);
      } else {
        ctx.fillStyle = C.red;
        ctx.font = "bold 9.5px Inter,sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("Severely undersampled", padL + pW - 5, padT + 13);
      }

      // Dots on reconstruction canvas
      samples.forEach(({ t, y }) => {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(toX(t), toY(y), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = C.gold;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
    }
  }

  function drawAll() {
    if (cTop) drawCanvas(cTop, sampleInterval, true);
    if (cBot) drawCanvas(cBot, sampleInterval, false);
  }

  function resize() {
    if (cTop) setupCanvas(cTop);
    if (cBot) setupCanvas(cBot);
    drawAll();
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;
    prog = Math.min(1, prog + (dt / 12000) * sweepSpeed);
    sampleInterval = MIN_IV + prog * (MAX_IV - MIN_IV);
    drawAll();
    if (prog >= 1) {
      playing = false;
      btnPlay.textContent = "▶ Play";
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function nyquistToggle() {
    if (prog >= 1) nyquistReset();
    playing = !playing;
    btnPlay.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (playing) {
      lastTime = null;
      raf = requestAnimationFrame(loop);
    } else cancelAnimationFrame(raf);
  }

  function nyquistReset() {
    playing = false;
    cancelAnimationFrame(raf);
    prog = (4 - MIN_IV) / (MAX_IV - MIN_IV);
    sampleInterval = 4;
    lastTime = null;
    btnPlay.textContent = "▶ Play";
    drawAll();
  }

  function sliderInput(e) {
    if (playing) {
      playing = false;
      cancelAnimationFrame(raf);
      btnPlay.textContent = "▶ Play";
    }
    sampleInterval = +e.target.value;
    prog = (sampleInterval - MIN_IV) / (MAX_IV - MIN_IV);
    drawAll();
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
      <h3>True 24 h Rhythm — Sampled Every {sampleInterval.toFixed(1)} h</h3>
      <canvas bind:this={cTop}></canvas>
    </div>
  </div>

  <div class="viz-row one-col">
    <div class="chart-panel">
      <h3>Reconstruction from Samples Only</h3>
      <canvas bind:this={cBot}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item">
      <div class="legend-swatch" style="background: #04050A"></div>
      True 24 h signal
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: #BE796B"></div>
      Sample points / reconstruction
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--red)"></div>
      Aliased apparent signal
    </div>
  </div>

  <div class="controls">
    <button class="btn" bind:this={btnPlay} onclick={nyquistToggle}
      >&#9654; Play</button
    >
    <button class="btn secondary" onclick={nyquistReset}>&#8634; Reset</button>

    <div class="speed-wrap" style="flex: 1; min-width: 100px">
      <span>T<sub>s</sub></span>
      <input
        type="range"
        min={MIN_IV}
        max={MAX_IV}
        step="0.5"
        value={sampleInterval}
        oninput={sliderInput}
        style="width: 0; flex: 1 1 0; background: linear-gradient(to right, var(--green-lt) 0%, var(--green-lt) {NYQUIST_PCT}%, var(--red-lt) {NYQUIST_PCT}%, var(--red-lt) 100%)"
      />
      <span>{sampleInterval.toFixed(1)} h</span>
    </div>

    <div
      class="step-indicator"
      style={sampleInterval < NYQUIST_LIMIT
        ? "color: var(--green); font-weight: 700"
        : "color: var(--red); font-weight: 700"}
    >
      {sampleInterval < NYQUIST_LIMIT ? "✓ Nyquist OK" : "✗ Aliasing"}
    </div>
  </div>
</div>
