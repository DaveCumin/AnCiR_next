<script>
	import { onMount } from 'svelte';

	// Props
	let { initialColor = '#00ff00', onColorChange = () => {} } = $props();

	// Reactive state for color components
	let h = $state(0); // Hue (0-360)
	let s = $state(1); // Saturation (0-1)
	let v = $state(1); // Value (0-1)
	let a = $state(1); // Alpha (0-1)

	// Store for current color
	const currentColor = $derived.by(() => {
		const rgb = hsvToRgb(h, s, v);
		return {
			hex: rgbToHex(rgb.r, rgb.g, rgb.b, a),
			rgb: { ...rgb, a },
			hsv: { h, s: s * 100, v: v * 100, a: a * 100 }
		};
	});

	onMount(() => {
		updateFromHex(initialColor);
	});

	//hide or show
	let show = $state(false);
	$effect(() => {
		if (show) {
			drawPicker();
			drawPalette();
		}
	});
	function open() {
		show = true;
	}
	function cancel() {
		updateFromHex(initialColor);
		show = false;
	}
	function save() {
		initialColor = $state.snapshot(currentColor.hex);
		show = false;
	}

	onColorChange = () => {
		// Placeholder for color change callback
		console.log('Color changed:', $state.snapshot(currentColor));
	};

	// Palette to store saved colors
	let palette = $state(['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000']);
	// Palette canvases
	let paletteCanvases = $state(new Array(palette.length).fill(null));
	let paletteContexts = $state(new Array(palette.length).fill(null));

	// Input fields
	let hexInput = $state(initialColor);
	let rgbInput = $state({
		r: currentColor.rgb.r,
		g: currentColor.rgb.g,
		b: currentColor.rgb.b,
		a: currentColor.rgb.a
	});
	let hsvInput = $state({
		h: currentColor.hsv.h,
		s: currentColor.hsv.s,
		v: currentColor.hsv.v,
		a: currentColor.hsv.a
	});

	// Canvas for hue/saturation picker
	let canvas;
	let ctx;
	let isDragging = $state(false);
	// slider
	//HSV
	let hueCanvas;
	let satCanvas;
	let valCanvas;
	let hueCtx;
	let satCtx;
	let valCtx;

	//alpha
	let alphaCanvas;
	let alphaCtx;

	// RGB
	let redCanvas;
	let greenCanvas;
	let blueCanvas;
	let redCtx;
	let greenCtx;
	let blueCtx;

	// Draw hue/saturation picker
	function drawPicker() {
		if (!canvas) {
			return;
		}
		ctx = canvas.getContext('2d');

		const width = canvas.width;
		const height = canvas.height;

		// Saturation gradient (left to right)
		const satGradient = ctx.createLinearGradient(0, 0, width, 0);
		satGradient.addColorStop(0, `hsl(${h}, 0%, 100%)`);
		satGradient.addColorStop(1, `hsl(${h}, 100%, 50%)`);

		// Value gradient (top to bottom)
		const valGradient = ctx.createLinearGradient(0, 0, 0, height);
		valGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
		valGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');

		ctx.fillStyle = satGradient;
		ctx.fillRect(0, 0, width, height);
		ctx.fillStyle = valGradient;
		ctx.fillRect(0, 0, width, height);

		// Draw cursor
		const x = s * width;
		const y = (1 - v) * height;
		ctx.beginPath();
		ctx.arc(x, y, 5, 0, 2 * Math.PI);
		ctx.strokeStyle = 'white';
		ctx.lineWidth = 2;
		ctx.stroke();

		drawSliders();
	}

	// Draw slider gradients
	function drawSliders() {
		hueCtx = hueCanvas?.getContext('2d');
		satCtx = satCanvas?.getContext('2d');
		valCtx = valCanvas?.getContext('2d');

		alphaCtx = alphaCanvas?.getContext('2d');

		redCtx = redCanvas?.getContext('2d');
		greenCtx = greenCanvas?.getContext('2d');
		blueCtx = blueCanvas?.getContext('2d');

		// Hue slider
		if (hueCtx) {
			const width = hueCanvas.width;
			const height = hueCanvas.height;
			hueCtx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const hue = (x / width) * 360;
				hueCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
				hueCtx.fillRect(x, 0, 1, height);
			}

			const x = (currentColor.hsv.h / 360) * width;
			hueCtx.beginPath();
			hueCtx.arc(x, height / 2, 6, 0, 2 * Math.PI);
			hueCtx.strokeStyle = 'black';
			hueCtx.lineWidth = 1;
			hueCtx.stroke();
			hueCtx.beginPath();
			hueCtx.arc(x, height / 2, 5, 0, 2 * Math.PI); // Inner white circle
			hueCtx.strokeStyle = 'white';
			hueCtx.lineWidth = 2;
			hueCtx.stroke();
		}

		// Saturation slider
		if (satCtx) {
			const width = satCanvas.width;
			const height = satCanvas.height;
			satCtx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const sat = x / width;
				satCtx.fillStyle = `hsl(${h}, ${sat * 100}%, ${currentColor.hsv.v / 2}%)`;
				satCtx.fillRect(x, 0, 1, height);
			}
			const x = (currentColor.hsv.s / 100) * width;
			satCtx.beginPath();
			satCtx.arc(x, height / 2, 6, 0, 2 * Math.PI);
			satCtx.strokeStyle = 'black';
			satCtx.lineWidth = 1;
			satCtx.stroke();
			satCtx.beginPath();
			satCtx.arc(x, height / 2, 5, 0, 2 * Math.PI); // Inner white circle
			satCtx.strokeStyle = 'white';
			satCtx.lineWidth = 2;
			satCtx.stroke();
		}

		// Value slider
		if (valCtx) {
			const width = valCanvas.width;
			const height = valCanvas.height;
			valCtx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const val = x / width;
				valCtx.fillStyle = `hsl(${h}, ${currentColor.hsv.s}%, ${val * 50}%)`;
				valCtx.fillRect(x, 0, 1, height);
			}
			const x = (currentColor.hsv.v / 100) * width;
			valCtx.beginPath();
			valCtx.arc(x, height / 2, 6, 0, 2 * Math.PI);
			valCtx.strokeStyle = 'black';
			valCtx.lineWidth = 1;
			valCtx.stroke();
			valCtx.beginPath();
			valCtx.arc(x, height / 2, 5, 0, 2 * Math.PI); // Inner white circle
			valCtx.strokeStyle = 'white';
			valCtx.lineWidth = 2;
			valCtx.stroke();
		}

		// Alpha slider
		if (alphaCtx) {
			const width = alphaCanvas.width;
			const height = alphaCanvas.height;
			const { r, g, b } = currentColor.rgb;
			alphaCtx.clearRect(0, 0, width, height);

			// Draw checkerboard background for transparency visualization
			const squareSize = 4;
			for (let x = 0; x < width; x += squareSize) {
				for (let y = 0; y < height; y += squareSize) {
					alphaCtx.fillStyle = (x / squareSize + y / squareSize) % 2 === 0 ? '#ffffff' : '#cccccc';
					alphaCtx.fillRect(x, y, squareSize, squareSize);
				}
			}

			for (let x = 0; x < width; x++) {
				const alpha = x / width;
				alphaCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
				alphaCtx.fillRect(x, 0, 1, height);
			}
			const x = (hsvInput.a / 100) * width; // Position based on alpha value (0-100)
			alphaCtx.beginPath();
			alphaCtx.arc(x, height / 2, 6, 0, 2 * Math.PI); // Outer black circle
			alphaCtx.strokeStyle = 'black';
			alphaCtx.lineWidth = 1;
			alphaCtx.stroke();
			alphaCtx.beginPath();
			alphaCtx.arc(x, height / 2, 5, 0, 2 * Math.PI); // Inner white circle
			alphaCtx.strokeStyle = 'white';
			alphaCtx.lineWidth = 2;
			alphaCtx.stroke();
		}

		//RGB sliders
		if (redCtx) {
			const width = redCanvas.width;
			const height = redCanvas.height;
			redCtx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const r = (x / width) * 255;
				redCtx.fillStyle = `rgb(${r}, ${rgbInput.g}, ${rgbInput.b})`;
				redCtx.fillRect(x, 0, 1, height);
			}

			const x = (currentColor.rgb.r / 255) * width;
			redCtx.beginPath();
			redCtx.arc(x, height / 2, 6, 0, 2 * Math.PI);
			redCtx.strokeStyle = 'black';
			redCtx.lineWidth = 1;
			redCtx.stroke();
			redCtx.beginPath();
			redCtx.arc(x, height / 2, 5, 0, 2 * Math.PI); // Inner white circle
			redCtx.strokeStyle = 'white';
			redCtx.lineWidth = 2;
			redCtx.stroke();
		}
		if (greenCtx) {
			const width = greenCanvas.width;
			const height = greenCanvas.height;
			greenCtx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const g = (x / width) * 255;
				greenCtx.fillStyle = `rgb(${rgbInput.r}, ${g}, ${rgbInput.b})`;
				greenCtx.fillRect(x, 0, 1, height);
			}

			const x = (currentColor.rgb.g / 255) * width;
			greenCtx.beginPath();
			greenCtx.arc(x, height / 2, 6, 0, 2 * Math.PI);
			greenCtx.strokeStyle = 'black';
			greenCtx.lineWidth = 1;
			greenCtx.stroke();
			greenCtx.beginPath();
			greenCtx.arc(x, height / 2, 5, 0, 2 * Math.PI); // Inner white circle
			greenCtx.strokeStyle = 'white';
			greenCtx.lineWidth = 2;
			greenCtx.stroke();
		}
		if (blueCtx) {
			const width = blueCanvas.width;
			const height = blueCanvas.height;
			blueCtx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const b = (x / width) * 255;
				blueCtx.fillStyle = `rgb(${rgbInput.r}, ${rgbInput.g}, ${b})`;
				blueCtx.fillRect(x, 0, 1, height);
			}

			const x = (currentColor.rgb.b / 255) * width;
			blueCtx.beginPath();
			blueCtx.arc(x, height / 2, 6, 0, 2 * Math.PI);
			blueCtx.strokeStyle = 'black';
			blueCtx.lineWidth = 1;
			blueCtx.stroke();
			blueCtx.beginPath();
			blueCtx.arc(x, height / 2, 5, 0, 2 * Math.PI); // Inner white circle
			blueCtx.strokeStyle = 'white';
			blueCtx.lineWidth = 2;
			blueCtx.stroke();
		}
	}

	// Draw palette canvases with checkerboard and color
	function drawPalette() {
		const pal = $state.snapshot(palette);
		pal.forEach((color, index) => {
			paletteContexts[index] = paletteCanvases[index]?.getContext('2d');
			const ctx = paletteContexts[index];
			if (!ctx) return;

			const width = 24;
			const height = 24;
			const squareSize = 4; // Match alpha slider checkerboard

			// Clear canvas
			ctx.clearRect(0, 0, width, height);

			// Draw checkerboard
			for (let x = 0; x < width; x += squareSize) {
				for (let y = 0; y < height; y += squareSize) {
					ctx.fillStyle = (x / squareSize + y / squareSize) % 2 === 0 ? '#ffffff' : '#cccccc';
					ctx.fillRect(x, y, squareSize, squareSize);
				}
			}

			// Draw color with alpha
			const { r, g, b, a: colorAlpha } = hexToRgb(color);
			ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${colorAlpha})`;
			ctx.fillRect(0, 0, width, height);

			// Draw border
			ctx.strokeStyle = 'black';
			ctx.lineWidth = 1;
			ctx.strokeRect(0, 0, width, height);
		});
	}

	// Handle mouse/touch events on canvas
	function handlePickerInteraction(event) {
		if (!isDragging && event.type !== 'mousedown' && event.type !== 'touchstart') return;

		const rect = canvas.getBoundingClientRect();
		const x =
			(event.type === 'touchstart' || event.type === 'touchmove'
				? event.touches[0].clientX
				: event.clientX) - rect.left;
		const y =
			(event.type === 'touchstart' || event.type === 'touchmove'
				? event.touches[0].clientY
				: event.clientY) - rect.top;

		s = Math.max(0, Math.min(1, x / rect.width));
		v = Math.max(0, Math.min(1, 1 - y / rect.height));
		updateInputs();
		drawPicker();
		onColorChange(currentColor);
	}

	// Convert HSV to RGB
	function hsvToRgb(h, s, v) {
		let r, g, b;
		const i = Math.floor(h / 60);
		const f = h / 60 - i;
		const p = v * (1 - s);
		const q = v * (1 - f * s);
		const t = v * (1 - (1 - f) * s);

		switch (i % 6) {
			case 0:
				r = v;
				g = t;
				b = p;
				break;
			case 1:
				r = q;
				g = v;
				b = p;
				break;
			case 2:
				r = p;
				g = v;
				b = t;
				break;
			case 3:
				r = p;
				g = q;
				b = v;
				break;
			case 4:
				r = t;
				g = p;
				b = v;
				break;
			case 5:
				r = v;
				g = p;
				b = q;
				break;
		}

		return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
	}

	// Convert RGB to Hex
	function rgbToHex(r, g, b, a) {
		const toHex = (n) => n.toString(16).padStart(2, '0');
		return `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(Math.round(a * 255)) : ''}`;
	}

	// Convert Hex to RGB
	function hexToRgb(hex) {
		hex = hex.replace('#', '');
		const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
		const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
		const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);
		const a = hex.length > 6 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
		return { r, g, b, a };
	}

	// Convert RGB to HSV
	function rgbToHsv(r, g, b) {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		let h, s;

		if (d === 0) h = 0;
		else if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;

		s = max === 0 ? 0 : d / max;

		return { h, s, v: max };
	}

	// Update inputs from HSV
	function updateInputs() {
		const rgb = hsvToRgb(h, s, v);
		hexInput = rgbToHex(rgb.r, rgb.g, rgb.b, a);
		rgbInput = { ...rgb, a: a * 100 };
		hsvInput = { h, s: s * 100, v: v * 100, a: a * 100 };
		drawPalette();
	}

	// Update from hex input
	function updateFromHex(hex) {
		try {
			const { r, g, b, a: alpha } = hexToRgb(hex);
			const { h: hue, s: sat, v: val } = rgbToHsv(r, g, b);
			h = hue;
			s = sat;
			v = val;
			a = alpha;
			updateInputs();
			drawPicker();
			onColorChange(currentColor);
		} catch (e) {
			console.error('Invalid hex color');
		}
	}

	// Update from RGB input
	function updateFromRgb() {
		try {
			const { r, g, b, a: alpha } = rgbInput;
			const { h: hue, s: sat, v: val } = rgbToHsv(r, g, b);
			h = hue;
			s = sat;
			v = val;
			a = alpha / 100;
			updateInputs();
			drawPicker();
			onColorChange(currentColor);
		} catch (e) {
			console.error('Invalid RGB values');
		}
	}

	// Update from HSV input
	function updateFromHsv() {
		try {
			h = hsvInput.h;
			s = hsvInput.s / 100;
			v = hsvInput.v / 100;
			a = hsvInput.a / 100;
			updateInputs();
			drawPicker();
			onColorChange(currentColor);
		} catch (e) {
			console.error('Invalid HSV values');
		}
	}

	// Save color to palette
	function saveColor() {
		const color = $state.snapshot(currentColor).hex;
		if (!palette.includes(color)) {
			palette = [...palette, color];
			paletteCanvases = [...paletteCanvases, null];
			paletteContexts = [...paletteContexts, null];
			drawPalette();
		}
		console.log('Pallette updated:', $state.snapshot(palette), color);
	}

	// Select color from palette
	function selectPaletteColor(color) {
		updateFromHex(color);
		drawPalette();
	}
</script>

{#if show}
	<div style="background: white;">
		<div style="position:relative; top:10xp; right:10px;">
			<button onclick={() => cancel()}>x</button>
		</div>
		<!-- Color Preview -->
		<div style="background-color: {currentColor.hex};"></div>

		<!-- Hue/Saturation Picker -->
		<canvas
			bind:this={canvas}
			width="200"
			height="200"
			style="cursor-crosshair"
			onmousedown={() => (isDragging = true)}
			onmousemove={handlePickerInteraction}
			onmouseup={() => (isDragging = false)}
			onmouseleave={() => (isDragging = false)}
			ontouchstart={handlePickerInteraction}
			ontouchmove={handlePickerInteraction}
			ontouchend={() => (isDragging = false)}
		></canvas>

		<!-- Sliders -->
		<div style="margin-bottom: 16px;">
			<!-- HSV -->
			<label>Hue</label>
			<div style="position: relative; width: 100%; height: 16px;">
				<canvas bind:this={hueCanvas} width="200" height="16" style="width: 100%; height: 16px;"
				></canvas>
				<input
					type="range"
					min="0"
					max="360"
					bind:value={h}
					oninput={() => {
						updateInputs();
						drawPicker();
						drawSliders();
						onColorChange($state.snapshot(currentColor));
					}}
					style="position: absolute; top: 0; left: 0; width: 100%; height: 16px; opacity: 0; cursor: pointer;"
				/>
			</div>
			<label>Saturation</label>
			<div style="position: relative; width: 100%; height: 16px;">
				<canvas bind:this={satCanvas} width="200" height="16" style="width: 100%; height: 16px;"
				></canvas>
				<input
					type="range"
					min="0"
					max="100"
					bind:value={hsvInput.s}
					oninput={() => {
						updateFromHsv();
						drawSliders();
						onColorChange($state.snapshot(currentColor));
					}}
					style="position: absolute; top: 0; left: 0; width: 100%; height: 16px; opacity: 0; cursor: pointer;"
				/>
			</div>
			<label>Value</label>
			<div style="position: relative; width: 100%; height: 16px;">
				<canvas bind:this={valCanvas} width="200" height="16" style="width: 100%; height: 16px;"
				></canvas>
				<input
					type="range"
					min="0"
					max="100"
					bind:value={hsvInput.v}
					oninput={() => {
						updateFromHsv();
						drawSliders();
						onColorChange($state.snapshot(currentColor));
					}}
					style="position: absolute; top: 0; left: 0; width: 100%; height: 16px; opacity: 0; cursor: pointer;"
				/>
			</div>

			<!-- ALPHA -->
			<label>Alpha</label>
			<div style="position: relative; width: 100%; height: 16px;">
				<canvas bind:this={alphaCanvas} width="200" height="16" style="width: 100%; height: 16px;"
				></canvas>
				<input
					type="range"
					min="0"
					max="100"
					bind:value={hsvInput.a}
					oninput={() => {
						updateFromHsv();
						drawSliders();
						onColorChange($state.snapshot(currentColor));
					}}
					style="position: absolute; top: 0; left: 0; width: 100%; height: 16px; opacity: 0; cursor: pointer;"
				/>
			</div>

			<!-- RGB -->
			<label>Red</label>
			<div style="position: relative; width: 100%; height: 16px;">
				<canvas bind:this={redCanvas} width="200" height="16" style="width: 100%; height: 16px;"
				></canvas>
				<input
					type="range"
					min="0"
					max="255"
					bind:value={rgbInput.r}
					oninput={() => {
						updateFromRgb();
						onColorChange($state.snapshot(currentColor));
					}}
					style="position: absolute; top: 0; left: 0; width: 100%; height: 16px; opacity: 0; cursor: pointer;"
				/>
			</div>
			<label>Green</label>
			<div style="position: relative; width: 100%; height: 16px;">
				<canvas bind:this={greenCanvas} width="200" height="16" style="width: 100%; height: 16px;"
				></canvas>
				<input
					type="range"
					min="0"
					max="255"
					bind:value={rgbInput.g}
					oninput={() => {
						updateFromRgb();
						onColorChange($state.snapshot(currentColor));
					}}
					style="position: absolute; top: 0; left: 0; width: 100%; height: 16px; opacity: 0; cursor: pointer;"
				/>
			</div>
			<label>Blue</label>
			<div style="position: relative; width: 100%; height: 16px;">
				<canvas bind:this={blueCanvas} width="200" height="16" style="width: 100%; height: 16px;"
				></canvas>
				<input
					type="range"
					min="0"
					max="255"
					bind:value={rgbInput.b}
					oninput={() => {
						updateFromRgb();
						onColorChange($state.snapshot(currentColor));
					}}
					style="position: absolute; top: 0; left: 0; width: 100%; height: 16px; opacity: 0; cursor: pointer;"
				/>
			</div>
		</div>

		<!-- Inputs -->
		<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
			<div>
				<label>Hex</label>
				<input
					type="text"
					bind:value={hexInput}
					oninput={() => updateFromHex(hexInput)}
					style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"
				/>
			</div>
			<div>
				<label>RGB</label>
				<div style="display: flex; gap: 4px;">
					<input
						type="number"
						min="0"
						max="255"
						bind:value={rgbInput.r}
						oninput={updateFromRgb}
						style="width: 33.33%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"
					/>
					<input
						type="number"
						min="0"
						max="255"
						bind:value={rgbInput.g}
						oninput={updateFromRgb}
						style="width: 33.33%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"
					/>
					<input
						type="number"
						min="0"
						max="255"
						bind:value={rgbInput.b}
						oninput={updateFromRgb}
						style="width: 33.33%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"
					/>
				</div>
			</div>
			<div>
				<label>HSV</label>
				<div style="display: flex; gap: 4px;">
					<input
						type="number"
						min="0"
						max="360"
						bind:value={hsvInput.h}
						oninput={updateFromHsv}
						style="width: 33.33%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"
					/>
					<input
						type="number"
						min="0"
						max="100"
						bind:value={hsvInput.s}
						oninput={updateFromHsv}
						style="width: 33.33%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"
					/>
					<input
						type="number"
						min="0"
						max="100"
						bind:value={hsvInput.v}
						oninput={updateFromHsv}
						style="width: 33.33%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"
					/>
				</div>
			</div>
			<label>Alpha</label>
			<div style="display: flex; gap: 4px;">
				<input
					type="number"
					min="0"
					max="100"
					bind:value={hsvInput.a}
					oninput={updateFromHsv}
					style="width: 33.33%; padding: 4px; border: 1px solid #ccc; border-radius: 4px;"
				/>
			</div>
			<div></div>
		</div>

		<!-- Palette -->
		<div>
			<label>Palette</label>
			<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
				{#each palette as color, index}
					<canvas
						bind:this={paletteCanvases[index]}
						width="24"
						height="24"
						style="width: 24px; height: 24px; cursor: pointer;"
						onclick={() => selectPaletteColor(color)}
					></canvas>
				{/each}
			</div>
			New
			<div style="width: 24px; height: 24px; background-color: {currentColor.hex};"></div>
			Old
			<div style="width: 24px; height: 24px; background-color: {initialColor};"></div>
			<button
				onclick={() => {
					saveColor();
					drawPalette();
				}}
				style="padding: 4px 8px; background-color: #3b82f6; color: white; border-radius: 4px; border: none; cursor: pointer;"
			>
				Save to Palette
			</button>
			<button
				onclick={() => {
					save();
				}}>Save</button
			>
		</div>
	</div>
{:else}
	<div
		style="cursor: pointer; width: 24px; height: 24px; background-color: {currentColor.hex};"
		onclick={() => open()}
	></div>
{/if}

<style>
	label {
		display: block;
		font-size: 14px;
		margin-bottom: 4px;
	}
</style>
