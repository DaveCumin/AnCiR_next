<script>
	import { onMount } from 'svelte';
	import {
		C,
		setupCanvas,
		drawAxes,
		drawHGrid,
		initPalette,
		canvasSize,
		observeResize
	} from '$lib/animUtils.js';

	let { height = '560px' } = $props();

	/* ------------------------------------------------------------------
	   Spectrogram colour ramp (dark background, "thermal" palette):
	   black -> purple -> blue -> cyan -> green -> yellow -> red.
	   Intrinsic to the spectrogram, so it does not follow the palette.
	------------------------------------------------------------------ */
	const SPECTRO_BG_RGB = [8, 8, 16];
	const SPECTRO_BG = 'rgb(8,8,16)';
	const SPECTRO_STOPS = [
		[0.0, [8, 8, 16]],
		[0.18, [60, 0, 130]],
		[0.38, [0, 60, 200]],
		[0.55, [0, 190, 200]],
		[0.72, [50, 210, 50]],
		[0.87, [230, 200, 0]],
		[1.0, [220, 40, 20]]
	];

	function spectroRGB(v) {
		v = Math.max(0, Math.min(1, v));
		for (let i = 1; i < SPECTRO_STOPS.length; i++) {
			const [t0, c0] = SPECTRO_STOPS[i - 1];
			const [t1, c1] = SPECTRO_STOPS[i];
			if (v <= t1) {
				const f = (v - t0) / (t1 - t0);
				return [
					Math.round(c0[0] + f * (c1[0] - c0[0])),
					Math.round(c0[1] + f * (c1[1] - c0[1])),
					Math.round(c0[2] + f * (c1[2] - c0[2]))
				];
			}
		}
		return [220, 40, 20];
	}

	/* ------------------------------------------------------------------
	   DEMO SIGNAL
	   Three pure sine waves: 250 Hz, 700 Hz, 1300 Hz, each with a slowly
	   varying amplitude envelope, so the spectrogram shows three bands.
	   Virtual sample rate FS = 4000 Hz, FFT size NFFT = 512 (7.8 Hz/bin):
	   250 Hz is bin 32, 700 Hz bin ~90, 1300 Hz bin ~166.
	------------------------------------------------------------------ */
	const FS = 4000;
	const NFFT = 512;
	const HOP = 64;
	const TOTAL_SECS = 12;
	const TOTAL_SAMPLES = TOTAL_SECS * FS;
	const DEMO_END = TOTAL_SAMPLES - NFFT;

	/* Amplitude envelopes (t in 0..1) */
	const COMPONENTS = [
		{ freq: 250, amp: (t) => 0.15 + 0.85 * Math.pow(Math.sin(Math.PI * t * 0.9 + 0.1), 2) },
		{ freq: 700, amp: (t) => 0.9 - 0.7 * Math.pow(Math.sin(Math.PI * t * 1.1), 2) },
		{ freq: 1300, amp: (t) => 0.1 + 0.85 * Math.abs(Math.sin(Math.PI * t * 2.0 - 0.5)) }
	];

	/* Pre-synthesise the full buffer */
	const demoSig = new Float32Array(TOTAL_SAMPLES);
	for (let n = 0; n < TOTAL_SAMPLES; n++) {
		const t = n / TOTAL_SAMPLES;
		let v = 0;
		for (const comp of COMPONENTS) v += comp.amp(t) * Math.sin((2 * Math.PI * comp.freq * n) / FS);
		demoSig[n] = v;
	}

	/* ------------------------------------------------------------------
	   Hann-windowed DFT -> one-sided magnitude. The window and the
	   twiddle factors are tabulated once (same maths as recomputing
	   them in the inner loop, but cheap enough to run once per hop).
	------------------------------------------------------------------ */
	const HANN = new Float64Array(NFFT);
	const COS = new Float64Array(NFFT);
	const SIN = new Float64Array(NFFT);
	for (let n = 0; n < NFFT; n++) {
		HANN[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (NFFT - 1));
		COS[n] = Math.cos((2 * Math.PI * n) / NFFT);
		SIN[n] = Math.sin((2 * Math.PI * n) / NFFT);
	}

	function computeFFT(buf) {
		const N = buf.length;
		const half = N >> 1;
		const mag = new Float32Array(half + 1);
		for (let k = 0; k <= half; k++) {
			let re = 0,
				im = 0;
			for (let n = 0; n < N; n++) {
				const idx = (k * n) % N;
				const x = HANN[n] * buf[n];
				re += x * COS[idx];
				im -= x * SIN[idx];
			}
			mag[k] = (2 / N) * Math.sqrt(re * re + im * im);
		}
		return mag;
	}

	function peakFreqLabel(mag, maxBin, hzPerBin = FS / NFFT) {
		let peak = 0,
			pk = 1;
		for (let k = 1; k < maxBin; k++) {
			if (mag[k] > peak) {
				peak = mag[k];
				pk = k;
			}
		}
		return `Peak: ${Math.round(pk * hzPerBin)} Hz`;
	}

	const MAX_FREQ_DEMO = 1600;
	const MAX_BIN_DEMO = Math.round(MAX_FREQ_DEMO / (FS / NFFT));
	const MAX_FREQ_LIVE = 4000;
	const LIVE_FLOOR_DB = -80;

	/* Shared plot margins, so the three panels line up. */
	const PAD_L = 44,
		PAD_R = 8,
		PAD_T = 8;

	let cWave, cFft, cSpec;
	let btnPlay, progFill, progWrap, stepInd, noteInfo, liveFreqInfo;

	let mode = $state('demo');
	let micDenied = $state(false);
	let liveOn = $state(false);

	/* The last thing drawn, so a resize can repaint without new data. */
	let lastWave = demoSig.slice(0, NFFT);
	let lastMag = computeFFT(lastWave);
	let lastMaxBin = MAX_BIN_DEMO;
	let lastHz = FS / NFFT;

	/* ------------------------------------------------------------------
	   WAVEFORM
	------------------------------------------------------------------ */
	function drawWaveform(buf) {
		const ctx = cWave.getContext('2d');
		const { W, H } = canvasSize(cWave);
		if (!W || !H) return;
		ctx.clearRect(0, 0, W, H);

		const padB = 18;
		const pW = W - PAD_L - PAD_R;
		const pH = H - PAD_T - padB;
		if (pW <= 0 || pH <= 0) return;

		ctx.fillStyle = C.bg;
		ctx.fillRect(PAD_L, PAD_T, pW, pH);
		drawHGrid(ctx, PAD_L, PAD_T, pW, pH, 3);
		drawAxes(ctx, PAD_L, PAD_T, pW, pH, '', 'Pressure');

		ctx.strokeStyle = C.border;
		ctx.lineWidth = 0.8;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(PAD_L, PAD_T + pH / 2);
		ctx.lineTo(PAD_L + pW, PAD_T + pH / 2);
		ctx.stroke();
		ctx.setLineDash([]);

		ctx.strokeStyle = C.data1;
		ctx.lineWidth = 1.5;
		ctx.lineJoin = 'round';
		ctx.beginPath();
		const N = buf.length;
		for (let i = 0; i < N; i++) {
			const x = PAD_L + (i / N) * pW;
			const y = PAD_T + pH / 2 - (buf[i] / 2.5) * (pH / 2);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}

	/* ------------------------------------------------------------------
	   FFT BAR GRAPH
	------------------------------------------------------------------ */
	function fmtHz(f) {
		return f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${f} Hz`;
	}

	function drawFFTBars(mag, nBins, hzPerBin) {
		const ctx = cFft.getContext('2d');
		const { W, H } = canvasSize(cFft);
		if (!W || !H) return;
		ctx.clearRect(0, 0, W, H);

		const padB = 22;
		const pW = W - PAD_L - PAD_R;
		const pH = H - PAD_T - padB;
		if (pW <= 0 || pH <= 0) return;

		ctx.fillStyle = C.bg;
		ctx.fillRect(PAD_L, PAD_T, pW, pH);

		const barW = Math.max(1, pW / nBins - 0.5);
		const grad = ctx.createLinearGradient(0, PAD_T + pH, 0, PAD_T);
		grad.addColorStop(0.0, C.navy);
		grad.addColorStop(0.5, C.blue);
		grad.addColorStop(0.8, C.gold);
		grad.addColorStop(1.0, C.red);

		ctx.fillStyle = grad;
		for (let k = 0; k < nBins; k++) {
			const v = Math.min(1, mag[k] * 1.8);
			const bH = v * pH;
			if (bH < 1) continue;
			ctx.fillRect(PAD_L + (k / nBins) * pW, PAD_T + pH - bH, barW, bH);
		}

		drawHGrid(ctx, PAD_L, PAD_T, pW, pH, 4);
		drawAxes(ctx, PAD_L, PAD_T, pW, pH, '', 'Amplitude');

		ctx.fillStyle = C.muted;
		ctx.font = '9px Inter,sans-serif';
		ctx.textAlign = 'right';
		for (let i = 0; i <= 4; i++) {
			const y = PAD_T + pH - (i / 4) * pH;
			ctx.fillText((i * 0.25).toFixed(2), PAD_L - 4, y + 3);
		}

		/* Frequency axis: seven evenly spaced labels, 0 to the maximum shown. */
		const maxFreq = nBins * hzPerBin;
		for (let i = 0; i <= 6; i++) {
			const x = PAD_L + (i / 6) * pW;
			ctx.textAlign = i === 0 ? 'left' : i === 6 ? 'right' : 'center';
			ctx.fillText(fmtHz(Math.round((i / 6) * maxFreq)), x, PAD_T + pH + 14);
		}
	}

	/* ------------------------------------------------------------------
	   SPECTROGRAM
	   Columns live in a JS history (one RGBA column per FFT frame, newest
	   last) and in an offscreen canvas with one raw pixel per column and
	   per bin. The offscreen canvas has an identity transform, so scrolling
	   it by one pixel is exact; the visible canvas then draws it with an
	   explicit destination size in drawing units, which is correct at any
	   device pixel ratio or presentation scale. A resize rebuilds the
	   offscreen canvas from the history, so nothing is lost or stretched.
	------------------------------------------------------------------ */
	const SPEC_PAD_B = 8;
	const SPEC_HISTORY = 4096;
	let specCols = [];
	let specBins = 0;
	let specHz = FS / NFFT;
	let specN = 0;
	let specOff = null;
	let specOffCtx = null;

	function specPlotWidth() {
		const { W } = canvasSize(cSpec);
		return Math.max(1, Math.floor(W - PAD_L - PAD_R));
	}

	function rebuildSpecOffscreen() {
		if (!specOff) return;
		specN = specPlotWidth();
		const rows = Math.max(1, specBins);
		specOff.width = specN;
		specOff.height = rows;
		const img = specOffCtx.createImageData(specN, rows);
		const d = img.data;
		for (let p = 0; p < d.length; p += 4) {
			d[p] = SPECTRO_BG_RGB[0];
			d[p + 1] = SPECTRO_BG_RGB[1];
			d[p + 2] = SPECTRO_BG_RGB[2];
			d[p + 3] = 255;
		}
		if (specBins > 0) {
			const count = Math.min(specN, specCols.length);
			const start = specCols.length - count;
			for (let c = 0; c < count; c++) {
				const col = specCols[start + c];
				const x = specN - count + c;
				for (let r = 0; r < specBins; r++) {
					const o = (r * specN + x) * 4;
					d[o] = col[r * 4];
					d[o + 1] = col[r * 4 + 1];
					d[o + 2] = col[r * 4 + 2];
					d[o + 3] = 255;
				}
			}
		}
		specOffCtx.putImageData(img, 0, 0);
	}

	function pushSpecColumn(mag, nBins, hzPerBin) {
		if (nBins !== specBins || hzPerBin !== specHz) {
			specCols = [];
			specBins = nBins;
			specHz = hzPerBin;
			rebuildSpecOffscreen();
		}
		/* Row 0 is the top (highest bin); bin 0 (DC) is left dark.
		   Gain x2.5: the Hann peak for an amplitude-1 pure tone is ~0.5. */
		const col = new Uint8ClampedArray(nBins * 4);
		for (let r = 0; r < nBins; r++) {
			const k = nBins - 1 - r;
			const rgb = k === 0 ? SPECTRO_BG_RGB : spectroRGB(Math.min(1, mag[k] * 2.5));
			col[r * 4] = rgb[0];
			col[r * 4 + 1] = rgb[1];
			col[r * 4 + 2] = rgb[2];
			col[r * 4 + 3] = 255;
		}
		specCols.push(col);
		if (specCols.length > SPEC_HISTORY * 2) specCols = specCols.slice(-SPEC_HISTORY);

		if (!specOff) return;
		if (specN !== specPlotWidth() || specOff.height !== nBins) {
			rebuildSpecOffscreen();
			return;
		}
		specOffCtx.drawImage(specOff, -1, 0);
		specOffCtx.putImageData(new ImageData(col, 1, nBins), specN - 1, 0);
	}

	function clearSpectrogram() {
		specCols = [];
		rebuildSpecOffscreen();
		drawSpectrogram();
	}

	function fmtTick(f) {
		return f >= 1000 ? `${f / 1000}k` : `${f}`;
	}

	function drawSpectrogram() {
		const ctx = cSpec.getContext('2d');
		const { W, H } = canvasSize(cSpec);
		if (!W || !H) return;
		ctx.clearRect(0, 0, W, H);

		const pH = H - PAD_T - SPEC_PAD_B;
		if (W - PAD_L - PAD_R <= 0 || pH <= 0) return;
		if (specN !== specPlotWidth()) rebuildSpecOffscreen();

		ctx.fillStyle = SPECTRO_BG;
		ctx.fillRect(PAD_L, PAD_T, specN, pH);
		if (specOff && specBins > 0) {
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(specOff, 0, 0, specN, specBins, PAD_L, PAD_T, specN, pH);
			ctx.imageSmoothingEnabled = true;
		}

		drawAxes(ctx, PAD_L, PAD_T, specN, pH, '', 'Frequency (Hz)');

		/* Frequency ticks on the vertical (frequency) axis. */
		if (specBins > 0) {
			const maxFreq = specBins * specHz;
			const ticks =
				maxFreq <= 2000 ? [200, 400, 600, 800, 1000, 1200, 1600] : [500, 1000, 2000, 4000, 8000];
			ctx.fillStyle = C.muted;
			ctx.font = '9px Inter,sans-serif';
			ctx.textAlign = 'right';
			ctx.strokeStyle = C.axis;
			ctx.lineWidth = 1;
			for (const f of ticks) {
				if (f >= maxFreq) continue;
				const y = PAD_T + pH * (1 - (f / specHz + 0.5) / specBins);
				ctx.beginPath();
				ctx.moveTo(PAD_L - 3, y);
				ctx.lineTo(PAD_L, y);
				ctx.stroke();
				ctx.fillText(fmtTick(f), PAD_L - 5, y + 3);
			}
		}
	}

	/* ------------------------------------------------------------------
	   Draw everything from the last data
	------------------------------------------------------------------ */
	function render(wave, mag, maxBin, hzPerBin) {
		lastWave = wave;
		lastMag = mag;
		lastMaxBin = maxBin;
		lastHz = hzPerBin;
		drawWaveform(wave);
		drawFFTBars(mag, maxBin, hzPerBin);
		drawSpectrogram();
	}

	function resize() {
		[cWave, cFft, cSpec].forEach((c) => setupCanvas(c));
		rebuildSpecOffscreen();
		render(lastWave, lastMag, lastMaxBin, lastHz);
	}

	function setNoteInfo(text) {
		// eslint-disable-next-line svelte/no-dom-manipulating -- imperative animation transport; these label/button nodes are written by the rAF loop, not rendered by Svelte
		noteInfo.textContent = text;
	}

	function setPlayLabel() {
		// eslint-disable-next-line svelte/no-dom-manipulating -- imperative animation transport; these label/button nodes are written by the rAF loop, not rendered by Svelte
		btnPlay.textContent = demoPlaying ? '⏸ Pause' : '▶ Play';
	}

	/* ------------------------------------------------------------------
	   DEMO MODE
	------------------------------------------------------------------ */
	let demoCursor = 0;
	let demoPlaying = false;
	let demoRaf = null;
	let demoSpeed = 1;
	let lastTs = null;
	let accumSamples = 0;

	function demoFrame(ts) {
		if (!demoPlaying) return;
		demoRaf = requestAnimationFrame(demoFrame);
		/* Clamp dt so a backgrounded tab does not replay seconds of hops at once. */
		const dt = Math.min(250, ts - (lastTs ?? ts));
		lastTs = ts;
		accumSamples += (dt / 1000) * FS * demoSpeed;
		const steps = Math.floor(accumSamples / HOP);
		if (steps < 1) return;
		accumSamples -= steps * HOP;

		/* One spectrogram column per hop, so its time axis is linear at any speed. */
		let slice = null,
			mag = null;
		for (let s = 0; s < steps && demoCursor < DEMO_END; s++) {
			demoCursor = Math.min(demoCursor + HOP, DEMO_END);
			slice = demoSig.slice(demoCursor, demoCursor + NFFT);
			mag = computeFFT(slice);
			pushSpecColumn(mag, MAX_BIN_DEMO, FS / NFFT);
		}
		if (mag) showDemo(slice, mag);

		if (demoCursor >= DEMO_END) {
			demoPlaying = false;
			cancelAnimationFrame(demoRaf);
			demoRaf = null;
			setPlayLabel();
			progFill.style.width = '100%';
		}
	}

	function showDemo(slice, mag) {
		render(slice, mag, MAX_BIN_DEMO, FS / NFFT);
		setNoteInfo(peakFreqLabel(mag, MAX_BIN_DEMO));
		progFill.style.width = ((demoCursor / DEMO_END) * 100).toFixed(1) + '%';
		// eslint-disable-next-line svelte/no-dom-manipulating -- imperative animation transport; these label/button nodes are written by the rAF loop, not rendered by Svelte
		stepInd.textContent = `t = ${(demoCursor / FS).toFixed(2)} s`;
	}

	function demoToggle() {
		if (demoCursor >= DEMO_END) demoReset();
		demoPlaying = !demoPlaying;
		setPlayLabel();
		if (demoPlaying) {
			lastTs = null;
			demoRaf = requestAnimationFrame(demoFrame);
		} else {
			cancelAnimationFrame(demoRaf);
			demoRaf = null;
		}
	}

	function demoStop() {
		demoPlaying = false;
		if (demoRaf) {
			cancelAnimationFrame(demoRaf);
			demoRaf = null;
		}
		setPlayLabel();
	}

	function demoReset() {
		demoStop();
		demoCursor = 0;
		accumSamples = 0;
		progFill.style.width = '0%';
		// eslint-disable-next-line svelte/no-dom-manipulating -- imperative animation transport; these label/button nodes are written by the rAF loop, not rendered by Svelte
		stepInd.textContent = 't = 0 s';
		specCols = [];
		specBins = MAX_BIN_DEMO;
		specHz = FS / NFFT;
		rebuildSpecOffscreen();
		const slice = demoSig.slice(0, NFFT);
		render(slice, computeFFT(slice), MAX_BIN_DEMO, FS / NFFT);
		setNoteInfo('Peak: -');
	}

	function demoSeek(e) {
		const rect = progWrap.getBoundingClientRect();
		const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		demoCursor = Math.floor(t * DEMO_END);
		accumSamples = 0;
		const slice = demoSig.slice(demoCursor, demoCursor + NFFT);
		const mag = computeFFT(slice);
		pushSpecColumn(mag, MAX_BIN_DEMO, FS / NFFT);
		showDemo(slice, mag);
	}

	/* ------------------------------------------------------------------
	   LIVE MODE (Web Audio API)
	------------------------------------------------------------------ */
	let liveAudioCtx = null;
	let liveAnalyser = null;
	let liveStream = null;
	let liveRaf = null;
	let liveDataBuf = null;
	let liveTimeBuf = null;
	/* Bumped by stopLive, so a getUserMedia that resolves after the user
	   has left live mode (or the component has unmounted) is discarded. */
	let liveSession = 0;

	async function startLive() {
		demoStop();
		const session = ++liveSession;

		let stream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
		} catch {
			if (session === liveSession) micDenied = true;
			return;
		}
		if (session !== liveSession) {
			stream.getTracks().forEach((t) => t.stop());
			return;
		}
		micDenied = false;
		liveStream = stream;

		liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
		const source = liveAudioCtx.createMediaStreamSource(liveStream);
		liveAnalyser = liveAudioCtx.createAnalyser();
		liveAnalyser.fftSize = 2048;
		liveAnalyser.smoothingTimeConstant = 0.75;
		source.connect(liveAnalyser);

		liveDataBuf = new Float32Array(liveAnalyser.frequencyBinCount);
		liveTimeBuf = new Float32Array(liveAnalyser.fftSize);

		liveOn = true;
		specCols = [];
		rebuildSpecOffscreen();
		liveFrame();
	}

	function stopLive() {
		liveSession++;
		liveOn = false;
		if (liveRaf) {
			cancelAnimationFrame(liveRaf);
			liveRaf = null;
		}
		if (liveStream) {
			liveStream.getTracks().forEach((t) => t.stop());
			liveStream = null;
		}
		if (liveAudioCtx) {
			liveAudioCtx.close();
			liveAudioCtx = null;
		}
		liveAnalyser = null;
	}

	function liveFrame() {
		if (!liveOn || !liveAnalyser) return;
		liveRaf = requestAnimationFrame(liveFrame);

		liveAnalyser.getFloatFrequencyData(liveDataBuf);
		liveAnalyser.getFloatTimeDomainData(liveTimeBuf);

		const liveHz = liveAudioCtx.sampleRate / liveAnalyser.fftSize;
		const maxBin = Math.round(MAX_FREQ_LIVE / liveHz);
		const mag = new Float32Array(maxBin + 1);
		for (let k = 0; k <= maxBin; k++) {
			mag[k] = Math.max(0, (liveDataBuf[k] - LIVE_FLOOR_DB) / -LIVE_FLOOR_DB);
		}

		const waveSlice = liveTimeBuf.slice(liveTimeBuf.length - NFFT);
		pushSpecColumn(mag, maxBin, liveHz);
		render(waveSlice, mag, maxBin, liveHz);
		const label = peakFreqLabel(mag, maxBin, liveHz);
		setNoteInfo(label);
		// eslint-disable-next-line svelte/no-dom-manipulating -- imperative animation transport; these label/button nodes are written by the rAF loop, not rendered by Svelte
		liveFreqInfo.textContent = label;
	}

	/* ------------------------------------------------------------------
	   MODE SWITCHING
	------------------------------------------------------------------ */
	function switchMode(next) {
		mode = next;
		if (next === 'live') {
			startLive();
		} else {
			stopLive();
			micDenied = false;
			demoReset();
		}
	}

	onMount(() => {
		initPalette();
		specOff = document.createElement('canvas');
		specOffCtx = specOff.getContext('2d');
		[cWave, cFft, cSpec].forEach((c) => setupCanvas(c));
		demoReset();
		const stopResize = observeResize([cWave, cFft, cSpec], resize);
		return () => {
			stopResize();
			demoStop();
			stopLive();
		};
	});
</script>

<div class="anim-embed" style={height ? `height: ${height}` : undefined}>
	<div class="mode-tabs">
		<button class="mode-tab" class:active={mode === 'demo'} onclick={() => switchMode('demo')}>
			Demo signal
		</button>
		<button class="mode-tab" class:active={mode === 'live'} onclick={() => switchMode('live')}>
			&#127897; Live microphone
		</button>
		{#if liveOn}
			<span class="live-badge">&#9679; LIVE</span>
		{/if}
	</div>

	{#if micDenied}
		<div class="mic-warn">
			Microphone access was denied or is not available. Please allow microphone permission and click
			<strong>Live microphone</strong> again.
		</div>
	{/if}

	<div class="viz-row one-col wave-row">
		<div class="chart-panel">
			<h3>
				{mode === 'live' ? 'Waveform (microphone input)' : 'Waveform (250 Hz + 700 Hz + 1300 Hz)'}
			</h3>
			<canvas bind:this={cWave}></canvas>
		</div>
	</div>

	<div class="viz-row one-col">
		<div class="chart-panel">
			<h3>Frequency Spectrum (FFT bar graph)</h3>
			<canvas bind:this={cFft}></canvas>
			<div class="note-info" bind:this={noteInfo}>Peak: -</div>
		</div>
	</div>

	<div class="viz-row one-col">
		<div class="chart-panel">
			<h3>Spectrogram (frequency &times; time)</h3>
			<canvas bind:this={cSpec}></canvas>
		</div>
	</div>

	<div class="controls" style:display={mode === 'demo' ? null : 'none'}>
		<button class="btn" bind:this={btnPlay} onclick={demoToggle}>&#9654; Play</button>
		<button class="btn secondary" onclick={demoReset}>&#8634; Reset</button>
		<div class="progress-wrap" bind:this={progWrap} onclick={demoSeek}>
			<div class="progress-fill" bind:this={progFill}></div>
		</div>
		<div class="speed-wrap">
			<span>Speed</span>
			<input
				type="range"
				min="0.1"
				max="5"
				step="0.05"
				value="1"
				oninput={(e) => {
					demoSpeed = +e.target.value;
				}}
			/>
		</div>
		<div class="step-indicator" bind:this={stepInd}>t = 0 s</div>
	</div>

	<div class="controls" style:display={mode === 'live' ? null : 'none'}>
		<button class="btn secondary" onclick={clearSpectrogram}>&#9003; Clear spectrogram</button>
		<div class="step-indicator" bind:this={liveFreqInfo}>Peak: -</div>
	</div>
</div>

<style>
	/* Relative panel heights: waveform 0.8 : spectrum 1 : spectrogram 1. */
	.wave-row {
		flex-grow: 0.8;
	}

	.mode-tabs {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
		margin: 0 0 0.5rem;
		flex-shrink: 0;
	}
	.mode-tab {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--muted);
		border-radius: 0.3125rem;
		padding: 0.375rem 1.125rem;
		font-family: var(--font-sans);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.mode-tab.active {
		background: var(--navy);
		color: #fff;
		border-color: var(--navy);
	}
	.mode-tab:hover:not(.active) {
		border-color: var(--navy);
		color: var(--navy);
	}

	.live-badge {
		display: inline-block;
		background: var(--red);
		color: #fff;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		border-radius: 0.25rem;
		padding: 0.125rem 0.4375rem;
		animation: livepulse 1.2s ease-in-out infinite;
	}
	@keyframes livepulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.mic-warn {
		background: var(--gold-lt);
		border: 1px solid var(--gold);
		border-left: 4px solid var(--gold);
		border-radius: 0.375rem;
		padding: 0.625rem 1rem;
		font-size: 0.82rem;
		color: var(--text);
		margin: 0 0 0.5rem;
		flex-shrink: 0;
	}

	.note-info {
		text-align: center;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--navy);
		margin-top: 0.3125rem;
		min-height: 1.3em;
		letter-spacing: 0.02em;
		flex-shrink: 0;
	}
</style>
