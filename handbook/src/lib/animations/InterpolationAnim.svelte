<script>
  // Missing-data / interpolation animation. A rhythmic signal is sampled, but a
  // block of points in the middle is missing (a gap). The animation sweeps the
  // GAP SIZE from small to large: for a short gap the straight-line (linear)
  // interpolation hugs the true curve, but as the gap widens past the rhythm's
  // own period the straight chord cuts across real peaks and troughs, and the
  // error grows. The true curve is shown faint for comparison, and the largest
  // interpolation error is marked. Modelled on the other animations here.
  import { onMount } from "svelte";
  import {
    C,
    setupCanvas,
    drawAxes,
    drawHGrid,
    lerp,
    seededRNG,
    initPalette,
  } from "$lib/animUtils.js";

  let { height = "360px" } = $props();

  const N = 96; // 4 days, hourly
  const TAU = 24;
  const CENTER = 54; // gap centred on an inflection (steepest, most linear part),
  // so a small gap interpolates almost perfectly and the error is all in the size
  const HW_MIN = 2; // smallest gap half-width (points = hours)
  const HW_MAX = 18; // largest gap half-width → 36 h gap (1.5 periods)

  // True underlying rhythm and the noisy observed samples.
  const truth = Array.from({ length: N }, (_, i) =>
    0.5 + 0.32 * Math.sin(((2 * Math.PI) / TAU) * i - Math.PI / 2),
  );
  const obs = (() => {
    const rng = seededRNG(11);
    return truth.map((v) => v + (rng() - 0.5) * 0.07);
  })();

  const yMin = -0.05,
    yMax = 1.05;

  const TOTAL = 100; // progress = gap size, from HW_MIN to HW_MAX
  let frame = 0,
    playing = false,
    raf = null,
    lastTime = null,
    accum = 0,
    speed = 0.6;
  let cv, btnPlay, progFill, progWrap, stepInd;

  function mapY(v, padT, pH) {
    return padT + pH - ((v - yMin) / (yMax - yMin)) * pH;
  }

  // Gap geometry and linear interpolation for a given progress (0..100).
  function geom(prog) {
    const hw = Math.round(lerp(HW_MIN, HW_MAX, prog / 100));
    const gapStart = CENTER - hw,
      gapEnd = CENTER + hw;
    const iL = gapStart - 1,
      iR = gapEnd + 1;
    const lerpAt = (i) => obs[iL] + (obs[iR] - obs[iL]) * ((i - iL) / (iR - iL));
    // largest absolute interpolation error across the gap
    let maxErr = 0,
      maxErrI = CENTER;
    for (let i = gapStart; i <= gapEnd; i++) {
      const e = Math.abs(lerpAt(i) - truth[i]);
      if (e > maxErr) {
        maxErr = e;
        maxErrI = i;
      }
    }
    return { hw, gapStart, gapEnd, iL, iR, lerpAt, maxErr, maxErrI };
  }

  function draw(prog) {
    const ctx = cv.getContext("2d");
    const W = cv.offsetWidth, H = cv.offsetHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 40, padT = 14, pW = W - 54, pH = H - 42;
    ctx.fillStyle = C.bg;
    ctx.fillRect(padL, padT, pW, pH);
    drawHGrid(ctx, padL, padT, pW, pH, 4);
    const X = (i) => padL + (i / (N - 1)) * pW;

    const g = geom(prog);

    // shade the gap region
    ctx.fillStyle = C.gold + "22";
    ctx.fillRect(X(g.gapStart - 0.5), padT, X(g.gapEnd + 0.5) - X(g.gapStart - 0.5), pH);
    ctx.fillStyle = C.gold;
    ctx.font = "10px Inter,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`missing (${2 * g.hw} h)`, (X(g.gapStart) + X(g.gapEnd)) / 2, padT + 12);

    // true underlying curve (faint, dashed)
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = X(i), y = mapY(truth[i], padT, pH);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // linear interpolation across the gap (straight chord)
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(X(g.iL), mapY(obs[g.iL], padT, pH));
    ctx.lineTo(X(g.iR), mapY(obs[g.iR], padT, pH));
    ctx.stroke();

    // mark the largest error: a red connector between chord and truth
    const ex = X(g.maxErrI);
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(ex, mapY(truth[g.maxErrI], padT, pH));
    ctx.lineTo(ex, mapY(g.lerpAt(g.maxErrI), padT, pH));
    ctx.stroke();
    ctx.setLineDash([]);

    // known observed samples (navy line + dots), skipping the gap
    ctx.strokeStyle = C.data1;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < N; i++) {
      if (i >= g.gapStart && i <= g.gapEnd) { started = false; continue; }
      const x = X(i), y = mapY(obs[i], padT, pH);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = C.data1;
    for (let i = 0; i < N; i += 2) {
      if (i >= g.gapStart && i <= g.gapEnd) continue;
      const x = X(i), y = mapY(obs[i], padT, pH);
      ctx.beginPath();
      ctx.arc(x, y, 1.7, 0, 2 * Math.PI);
      ctx.fill();
    }

    drawAxes(ctx, padL, padT, pW, pH, "Hour", "Signal");
    if (stepInd)
      stepInd.textContent = `Gap: ${2 * g.hw} h   |   max interpolation error: ${g.maxErr.toFixed(2)}`;
    if (progFill) progFill.style.width = prog + "%";
  }

  function resize() {
    if (cv) setupCanvas(cv);
    draw(frame);
  }

  function loop(ts) {
    if (!playing) return;
    if (lastTime === null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;
    accum += dt * speed * 0.04;
    const steps = Math.floor(accum);
    accum -= steps;
    frame = Math.min(frame + steps, TOTAL);
    draw(frame);
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
    draw(0);
  }

  function seek(e) {
    const rect = progWrap.getBoundingClientRect();
    frame = Math.max(
      0,
      Math.round(
        Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * TOTAL,
      ),
    );
    draw(frame);
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
      <h3>Interpolation error grows with gap size</h3>
      <canvas bind:this={cv}></canvas>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--data1, #04050A)"></div>
      Observed samples
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--color-success, #137333)"></div>
      Linear interpolation
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--muted, #6b7280)"></div>
      True underlying rhythm
    </div>
    <div class="legend-item">
      <div class="legend-swatch" style="background: var(--color-error, #c5221f)"></div>
      Largest error
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
    <div class="step-indicator" bind:this={stepInd}>Gap: 4 h</div>
  </div>
</div>
