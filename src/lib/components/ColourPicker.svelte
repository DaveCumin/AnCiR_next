<script context="module">
	export function getRandomColor() {
		const letters = '0123456789ABCDEF';
		let color = '#';
		for (let i = 0; i < 6; i++) {
			color += letters[Math.floor(Math.random() * 16)];
		}
		return color;
	}

	export function drawSquares(canvas) {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;
		const squareSize = 4;
		for (let x = 0; x < canvas.width; x += squareSize) {
			for (let y = 0; y < canvas.height; y += squareSize) {
				ctx.fillStyle = (x / squareSize + y / squareSize) % 2 === 0 ? '#ffffff' : '#cccccc';
				ctx.fillRect(x, y, squareSize, squareSize);
			}
		}
	}

	function drawMarker(canvas, x) {
		let ctx = canvas?.getContext('2d');
		if (!ctx) return;
		ctx.beginPath();
		ctx.arc(x * canvas.width, canvas.height / 2, canvas.height / 2 - 2, 0, 2 * Math.PI);
		ctx.strokeStyle = 'black';
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(x * canvas.width, canvas.height / 2, canvas.height / 2 - 1, 0, 2 * Math.PI); // Inner white circle
		ctx.strokeStyle = 'white';
		ctx.lineWidth = 2;
		ctx.stroke();
	}
</script>

<script>
	import { onMount } from 'svelte';
	import Box from './Box.svelte';
	import { appConsts } from '$lib/core/theCore.svelte';

	import { interpolateRgbBasis } from 'd3-interpolate';
	let interpcols = [
		'#031326',
		'#13385A',
		'#47587A',
		'#6B5F76',
		'#8E616C',
		'#BC6461',
		'#BC6461',
		'#BC6461',
		'#E7A279',
		'#E9C99F',
		'#FDF5DA'
	];
	let interpolatedp = $state(0.5);
	let interpolatecanvas;

	// Props
	let { value = $bindable(getRandomColor()), onChange = () => {} } = $props();
	let plot = $state({ x: 0, y: 0, width: 260, height: 400 });
	let container;
	let caneyedrop = false;

	// Reactive state for color components
	let h = $state(0); // Hue (0-360)
	let s = $state(1); // Saturation (0-1)
	let v = $state(1); // Value (0-1)
	let a = $state(1); // Alpha (0-1)
	let initialValue = $state(value);

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
		updateFromHex(value);
		if (window.EyeDropper) {
			caneyedrop = true;
		}
	});

	//hide or show
	let show = $state(false);
	$effect(() => {
		if (show && plot) {
			// plot is so this re-renders with the Box is moved.
			drawPicker();
			drawPalette();

			if (container.parentNode.nodeName != 'BODY') {
				// don't re-float it each update
				document.body.append(container); //make it 'floating'
			}

			//do the interpolated canvas
			const ctx = interpolatecanvas?.getContext('2d');
			if (!ctx) return;

			const width = interpolatecanvas.width;
			const height = interpolatecanvas.height;
			ctx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const p = x / width;
				ctx.fillStyle = interpolateRgbBasis(interpcols)(p);
				ctx.fillRect(x, 0, 1, height);
			}
			let x = interpolatedp;
			drawMarker(interpolatecanvas, x);
		}
	});
	function open(e) {
		show = true;
		plot.x = e.clientX;
		plot.y = e.clientY;
	}
	function cancel() {
		updateFromHex(initialValue);
		show = false;
	}
	function save() {
		value = $state.snapshot(currentColor.hex);
		initialValue = value;
		show = false;
	}

	function onColorChange() {
		value = $state.snapshot(currentColor.hex);
		onChange();
	}

	// Palette canvases
	let paletteCanvases = $state(new Array(appConsts.appColours.length).fill(null));

	//indicator
	let indicatorCanvas = $state();

	//new and old
	let newCanvas = $state();
	let oldCanvas = $state();

	// Input fields
	let hexInput = $state(value);
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

	// sliders
	//HSV
	let hueCanvas;
	let satCanvas;
	let valCanvas;

	//alpha
	let alphaCanvas;

	// RGB
	let redCanvas;
	let greenCanvas;
	let blueCanvas;

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
		// Hue slider
		let ctx = hueCanvas?.getContext('2d');
		if (ctx) {
			const width = hueCanvas.width;
			const height = hueCanvas.height;
			ctx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const hue = (x / width) * 360;
				ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
				ctx.fillRect(x, 0, 1, height);
			}

			const x = currentColor.hsv.h / 360;
			drawMarker(hueCanvas, x);
		}

		// Saturation slider
		ctx = satCanvas?.getContext('2d');
		if (ctx) {
			const width = satCanvas.width;
			const height = satCanvas.height;
			ctx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const sat = x / width;
				ctx.fillStyle = `hsl(${h}, ${sat * 100}%, ${currentColor.hsv.v / 2}%)`;
				ctx.fillRect(x, 0, 1, height);
			}
			const x = currentColor.hsv.s / 100;
			drawMarker(satCanvas, x);
		}

		// Value slider
		ctx = valCanvas?.getContext('2d');
		if (ctx) {
			const width = valCanvas.width;
			const height = valCanvas.height;
			ctx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const val = x / width;
				ctx.fillStyle = `hsl(${h}, ${currentColor.hsv.s}%, ${val * 50}%)`;
				ctx.fillRect(x, 0, 1, height);
			}
			const x = currentColor.hsv.v / 100;
			drawMarker(valCanvas, x);
		}

		// Alpha slider
		ctx = alphaCanvas?.getContext('2d');
		if (ctx) {
			const width = alphaCanvas.width;
			const height = alphaCanvas.height;
			const { r, g, b } = currentColor.rgb;
			ctx.clearRect(0, 0, width, height);

			// Draw checkerboard background for transparency visualization
			drawSquares(alphaCanvas);

			for (let x = 0; x < width; x++) {
				const alpha = x / width;
				ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
				ctx.fillRect(x, 0, 1, height);
			}
			const x = hsvInput.a / 100; // Position based on alpha value (0-100)
			drawMarker(alphaCanvas, x);
		}

		ctx = greenCanvas?.getContext('2d');
		if (ctx) {
			const width = greenCanvas.width;
			const height = greenCanvas.height;
			ctx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const g = (x / width) * 255;
				ctx.fillStyle = `rgb(${rgbInput.r}, ${g}, ${rgbInput.b})`;
				ctx.fillRect(x, 0, 1, height);
			}

			const x = currentColor.rgb.g / 255;
			drawMarker(greenCanvas, x);
		}

		ctx = blueCanvas?.getContext('2d');
		if (ctx) {
			const width = blueCanvas.width;
			const height = blueCanvas.height;
			ctx.clearRect(0, 0, width, height);
			for (let x = 0; x < width; x++) {
				const b = (x / width) * 255;
				ctx.fillStyle = `rgb(${rgbInput.r}, ${rgbInput.g}, ${b})`;
				ctx.fillRect(x, 0, 1, height);
			}

			const x = currentColor.rgb.b / 255;
			drawMarker(blueCanvas, x);
		}
	}

	// Draw palette canvases with checkerboard and color
	function drawPalette() {
		const pal = $state.snapshot(appConsts.appColours);
		const squareSize = 4; // Match alpha slider checkerboard
		pal.forEach((color, index) => {
			const ctx = paletteCanvases[index]?.getContext('2d');
			if (!ctx) return;

			const width = paletteCanvases[index].width;
			const height = paletteCanvases[index].height;

			// Clear canvas
			ctx.clearRect(0, 0, width, height);

			// Draw checkerboard
			drawSquares(paletteCanvases[index]);

			// Draw color with alpha
			const { r, g, b, a: colorAlpha } = hexToRgb(color);
			ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${colorAlpha})`;
			ctx.fillRect(0, 0, width, height);

			// Draw border
			ctx.strokeStyle = 'black';
			ctx.lineWidth = 1;
			ctx.strokeRect(0, 0, width, height);
		});

		//draw the indicator also
		let ctx = indicatorCanvas?.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, indicatorCanvas.width, indicatorCanvas.height);
		// Draw checkerboard
		drawSquares(indicatorCanvas, ctx);
		//draw colour
		ctx.fillStyle = currentColor.hex;
		ctx.fillRect(0, 0, indicatorCanvas.width, indicatorCanvas.height);

		//and the old and new
		ctx = oldCanvas?.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, oldCanvas.width, oldCanvas.height);
		// Draw checkerboard
		drawSquares(oldCanvas);
		//draw colour
		ctx.fillStyle = initialValue;
		ctx.fillRect(0, 0, oldCanvas.width, oldCanvas.height);

		ctx = newCanvas?.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, newCanvas.width, newCanvas.height);
		// Draw checkerboard
		drawSquares(newCanvas, ctx);
		//draw colour
		ctx.fillStyle = currentColor.hex;
		ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
	}

	// Handle mouse/touch events on canvas
	function handleInteraction(event, canvas, updatefunction) {
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

		const cx = Math.max(0, Math.min(1, x / rect.width));
		const cy = Math.max(0, Math.min(1, 1 - y / rect.height));

		updatefunction(cx, cy);
	}

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
		if (!appConsts.appColours.includes(color)) {
			appConsts.appColours.push(color);
			paletteCanvases.push(null);
			drawPalette();
		}
	}

	// Select color from palette
	function selectPaletteColor(color) {
		updateFromHex(color);
		drawPalette();
	}

	function eyedropper() {
		//https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper
		const eyeDropper = new EyeDropper();
		eyeDropper
			.open()
			.then((result) => {
				updateFromHex(result.sRGBHex);
			})
			.catch((e) => {
				console.error(e);
			});
	}
</script>

{#if show}
	<div bind:this={container} style="position:absolute; top:0; left:0;">
		<Box bind:plot overflow="auto">
			<div style="background: white;">
				<div style="position:absolute; top:10xp; right:10px;">
					<button onclick={() => cancel()}>x</button>
				</div>
				<!-- eyedropper -->
				{#if caneyedrop}
					<button onclick={() => eyedropper()}>E</button>
				{/if}
				<!-- Color Preview -->
				<div style="background-color: {currentColor.hex};"></div>

				<!-- Hue/Saturation Picker -->
				<canvas
					bind:this={canvas}
					width="200"
					height="200"
					style="cursor:crosshair;"
					onmousedown={(e) => {
						isDragging = true;
						handlePickerInteraction(e);
					}}
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
					<div style="position: relative; width: 100%; height: 16px; cursor: crosshair;">
						<!-- TODO: consider if this is a better way, compared to the slider approach (more accurate) -->
						<canvas
							id="ALPHA"
							bind:this={alphaCanvas}
							width="200"
							height="16"
							style="width: 100%; height: 16px;"
							onmousedown={(e) => {
								isDragging = true;
								handleInteraction(e, alphaCanvas, (x, y) => {
									hsvInput.a = x * 100;
									updateFromHsv();
									drawMarker(alphaCanvas, x);
								});
							}}
							onmousemove={(e) =>
								handleInteraction(e, alphaCanvas, (x, y) => {
									hsvInput.a = x * 100;
									updateFromHsv();
									drawMarker(alphaCanvas, x);
								})}
							onmouseup={() => (isDragging = false)}
							onmouseleave={() => (isDragging = false)}
							ontouchstart={(e) =>
								handleInteraction(e, alphaCanvas, (x, y) => {
									hsvInput.a = x * 100;
									updateFromHsv();
									drawMarker(alphaCanvas, x);
								})}
							ontouchmove={(e) =>
								handleInteraction(e, alphaCanvas, (x, y) => {
									hsvInput.a = x * 100;
									updateFromHsv();
									drawMarker(alphaCanvas, x);
								})}
							ontouchend={() => (isDragging = false)}
						></canvas>
					</div>

					<!-- RGB -->
					<label>Red</label>

					<div style="position: relative; width: 100%; height: 16px; border:1px solid red;">
						<div style="position: relative; width: 100%; height: 16px;">
							<canvas
								bind:this={redCanvas}
								width="200"
								height="16"
								style="width: 100%; height: 16px;"
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
					</div>
					<label>Green</label>
					<div style="position: relative; width: 100%; height: 16px;">
						<canvas
							bind:this={greenCanvas}
							width="200"
							height="16"
							style="width: 100%; height: 16px;"
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
						<canvas
							bind:this={blueCanvas}
							width="200"
							height="16"
							style="width: 100%; height: 16px;"
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
						{#each appConsts.appColours as color, index}
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
					<div style="width: 24px; height: 24px;">
						<canvas
							bind:this={newCanvas}
							width="24"
							height="24"
							style="width: 24px; height: 24px; cursor: pointer;"
						></canvas>
					</div>
					Old
					<div style="width: 24px; height: 24px;">
						<canvas
							bind:this={oldCanvas}
							width="24"
							height="24"
							style="width: 24px; height: 24px; cursor: pointer;"
						></canvas>
					</div>
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

			<div
				style="border:1px solid black; 
background:{interpolateRgbBasis(interpcols)(interpolatedp)}; width:20px; height:20px;"
			></div>
			<div style="width:20px; height:20px;">
				<input type="number" min="0" max="1" step="0.1" bind:value={interpolatedp} />
				<p>{interpolateRgbBasis(interpcols)(interpolatedp)}</p>
				<canvas bind:this={interpolatecanvas} width="200" height="30" />
			</div>
		</Box>
	</div>
{/if}
<!-- THE INDICATOR-->
<div style="cursor: pointer; width: 24px; height: 24px;}" onclick={(e) => open(e)}>
	<canvas
		bind:this={indicatorCanvas}
		width="24"
		height="24"
		style="width: 24px; height: 24px; cursor: pointer;"
	></canvas>
</div>

<style>
	label {
		display: block;
		font-size: 14px;
		margin-bottom: 4px;
	}
</style>
