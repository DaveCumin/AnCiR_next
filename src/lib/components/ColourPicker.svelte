<script context="module">
	export function getRandomColor() {
		const letters = '0123456789ABCDEF';
		let color = '#';
		for (let i = 0; i < 6; i++) {
			color += letters[Math.floor(Math.random() * 16)];
		}
		return color;
	}
</script>

<script>
	import { onMount } from 'svelte';
	import { appConsts } from '$lib/core/theCore.svelte';
	import Box from './Box.svelte';
	let { value = $bindable(getRandomColor()), onChange = () => {} } = $props();
	let plot = $state({ x: 0, y: 0, width: 260, height: 400 });

	let show = $state(false);
	let container;
	let initialColor = $state.snapshot(value);
	let caneyedrop = false;

	let canvas;
	let isDragging = false;
	let hsvInput = $state(rgbToHsv(initialColor));
	let rgbInput = $state({ ...initialColor });
	let hexInput = $state(initialColor);

	function rgbToHex({ r, g, b, a }) {
		const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
		return a < 1
			? `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a * 255)}`
			: `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}

	function hexToRgb(hex) {
		hex = hex.replace('#', '');
		const r = parseInt(hex.length === 8 ? hex.slice(0, 2) : hex.slice(0, 2), 16);
		const g = parseInt(hex.length === 8 ? hex.slice(2, 4) : hex.slice(2, 4), 16);
		const b = parseInt(hex.length === 8 ? hex.slice(4, 6) : hex.slice(4, 6), 16);
		const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
		return { r, g, b, a };
	}

	function rgbToHsv({ r, g, b, a }) {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		let h = 0,
			s = max === 0 ? 0 : d / max,
			v = max;
		if (d !== 0) {
			switch (max) {
				case r:
					h = (g - b) / d + (g < b ? 6 : 0);
					break;
				case g:
					h = (b - r) / d + 2;
					break;
				case b:
					h = (r - g) / d + 4;
					break;
			}
			h /= 6;
		}
		return { h: h * 360, s: s * 100, v: v * 100, a: a * 100 };
	}

	function hsvToRgb({ h, s, v, a }) {
		s /= 100;
		v /= 100;
		const c = v * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = v - c;
		let r = 0,
			g = 0,
			b = 0;
		if (h < 60) [r, g, b] = [c, x, 0];
		else if (h < 120) [r, g, b] = [x, c, 0];
		else if (h < 180) [r, g, b] = [0, c, x];
		else if (h < 240) [r, g, b] = [0, x, c];
		else if (h < 300) [r, g, b] = [x, 0, c];
		else [r, g, b] = [c, 0, x];
		return {
			r: Math.round((r + m) * 255),
			g: Math.round((g + m) * 255),
			b: Math.round((b + m) * 255),
			a: a / 100
		};
	}
	function updateFromRgb() {
		hsvInput = rgbToHsv(rgbInput);
		hexInput = rgbToHex(rgbInput);
		drawPicker();
	}

	function updateFromHsv() {
		rgbInput = { ...hsvToRgb(hsvInput) };
		hexInput = rgbToHex(rgbInput);
		drawPicker();
	}

	function updateFromHex(hex) {
		if (/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(hex)) {
			rgbInput = { ...hexToRgb(hexInput) };
			hsvInput = rgbToHsv(rgbInput);
			drawPicker();
		}
	}

	function eyedropper() {
		//https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper
		const eyeDropper = new EyeDropper();
		eyeDropper
			.open()
			.then((result) => {
				hexInput = result.sRGBHex;
				updateFromHex(hexInput);
			})
			.catch((e) => {
				console.error(e);
			});
	}

	function drawPicker() {
		value = hexInput;
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;
		const width = canvas.width;
		const height = canvas.height;

		// Saturation/Value gradient
		const gradientH = ctx.createLinearGradient(0, 0, width, 0);
		gradientH.addColorStop(0, `hsl(${hsvInput.h}, 0%, 100%)`);
		gradientH.addColorStop(1, `hsl(${hsvInput.h}, 100%, 50%)`);
		ctx.fillStyle = gradientH;
		ctx.fillRect(0, 0, width, height);

		const gradientV = ctx.createLinearGradient(0, 0, 0, height);
		gradientV.addColorStop(0, 'rgba(0,0,0,0)');
		gradientV.addColorStop(1, 'rgba(0,0,0,1)');
		ctx.fillStyle = gradientV;
		ctx.fillRect(0, 0, width, height);

		// Cursor
		const x = (hsvInput.s / 100) * width;
		const y = (1 - hsvInput.v / 100) * height;
		ctx.beginPath();
		ctx.arc(x, y, 5, 0, 2 * Math.PI);
		ctx.strokeStyle = 'white';
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	function handlePickerInteraction(event) {
		if (!isDragging && event.type !== 'touchstart' && event.type !== 'touchmove') return;
		const rect = canvas.getBoundingClientRect();
		const x = (event.touches ? event.touches[0].clientX : event.clientX) - rect.left;
		const y = (event.touches ? event.touches[0].clientY : event.clientY) - rect.top;
		hsvInput.s = Math.max(0, Math.min(100, (x / rect.width) * 100));
		hsvInput.v = Math.max(0, Math.min(100, (1 - y / rect.height) * 100));
		updateFromHsv();
		drawPicker();
	}

	function saveColor() {
		appConsts.appColours.push(hexInput);
	}

	$effect(() => {
		if (show && plot) {
			if (container.parentNode.nodeName != 'BODY') {
				// don't re-float it each update
				document.body.append(container); //make it 'floating'
			}
		}
	});

	function open(e) {
		show = true;
		plot.x = e.clientX;
		plot.y = e.clientY;
	}

	function save() {
		console.log('sving ', value);
		value = hexInput;
		show = false;
	}

	function cancel() {
		value = initialColor;
		show = false;
	}

	$effect(() => {
		if (show && canvas) {
			drawPicker();
			onChange(value);
		}
	});

	onMount(() => {
		updateFromHex(value);
		if (window.EyeDropper) {
			caneyedrop = true;
		}
		initialColor = $state.snapshot(value);
	});
</script>

<!-- Pop-up Color Picker -->
{#if show}
	<div bind:this={container} style="position:absolute; top:0; left:0;">
		<Box bind:plot overflow="auto">
			<!-- eyedropper -->
			{#if caneyedrop}
				<button onclick={() => eyedropper()}>E</button>
			{/if}
			<div style="background:white;">
				<div style="position: absolute; top: 8px; right: 8px;">
					<button
						onclick={() => cancel()}
						style="background: none; border: none; font-size: 16px; cursor: pointer;"
					>
						✕
					</button>
				</div>

				<!-- Color Preview -->
				<div
					style="background-color: {hexInput}; width: 100%; height: 24px; border: 1px solid #ccc; margin-bottom: 16px; position: relative;"
				>
					<div
						style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;"
					></div>
					<div
						style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: {hexInput};"
					></div>
				</div>

				<!-- Hue/Saturation Picker -->
				<canvas
					bind:this={canvas}
					width="200"
					height="200"
					style="cursor: crosshair; width: 100%; margin-bottom: 16px;"
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
					<label>Hue</label>
					<div
						style="position: relative; width: 100%; height: 16px; border-radius: 8px; overflow: hidden;"
					>
						<div
							style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to right, hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%), hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%));"
						></div>
						<input
							class="myslider"
							type="range"
							min="0"
							max="360"
							bind:value={hsvInput.h}
							oninput={() => {
								updateFromHsv();
							}}
							style="position: relative; width: 100%; height: 16px; background: transparent; cursor: crosshair; -webkit-appearance: none;"
						/>
					</div>

					<label>Saturation</label>
					<div
						style="position: relative; width: 100%; height: 16px; border-radius: 8px; overflow: hidden;"
					>
						<div
							style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to right, hsl({hsvInput.h}, 0%, 50%), hsl({hsvInput.h}, 100%, 50%));"
						></div>
						<input
							class="myslider"
							type="range"
							min="0"
							max="100"
							bind:value={hsvInput.s}
							oninput={() => {
								updateFromHsv();
							}}
							style="position: relative; width: 100%; height: 16px; background: transparent; cursor: crosshair; -webkit-appearance: none;"
						/>
					</div>

					<label>Value</label>
					<div
						style="position: relative; width: 100%; height: 16px; border-radius: 8px; overflow: hidden;"
					>
						<div
							style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to right, hsl({hsvInput.h}, {hsvInput.s}%, 0%), hsl({hsvInput.h}, {hsvInput.s}%, 100%));"
						></div>
						<input
							class="myslider"
							type="range"
							min="0"
							max="100"
							bind:value={hsvInput.v}
							oninput={() => {
								updateFromHsv();
							}}
							style="position: relative; width: 100%; height: 16px; background: transparent; cursor: crosshair; -webkit-appearance: none;"
						/>
					</div>
					<label>Alpha</label>
					<div
						style="position: relative; width: 100%; height: 16px; border-radius: 8px; overflow: hidden;"
					>
						<div
							style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;"
						></div>
						<div
							style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to right, rgba({rgbInput.r}, {rgbInput.g}, {rgbInput.b}, 0), rgba({rgbInput.r}, {rgbInput.g}, {rgbInput.b}, 1));"
						></div>
						<input
							class="myslider"
							type="range"
							min="0"
							max="100"
							step="1"
							bind:value={hsvInput.a}
							oninput={() => {
								updateFromHsv();
							}}
							style="position: relative; width: 100%; height: 16px; background: transparent; cursor: crosshair; -webkit-appearance: none;"
						/>
					</div>

					<label>Red</label>
					<div
						style="position: relative; width: 100%; height: 16px; border-radius: 8px; overflow: hidden;"
					>
						<div
							style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to right, rgb(0, {rgbInput.g}, {rgbInput.b}), rgb(255, {rgbInput.g}, {rgbInput.b}));"
						></div>
						<input
							class="myslider"
							type="range"
							min="0"
							max="255"
							bind:value={rgbInput.r}
							oninput={() => {
								updateFromRgb();
							}}
							style="position: relative; width: 100%; height: 16px; background: transparent; cursor: crosshair; -webkit-appearance: none;"
						/>
					</div>

					<label>Green</label>
					<div
						style="position: relative; width: 100%; height: 16px; border-radius: 8px; overflow: hidden;"
					>
						<div
							style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to right, rgb({rgbInput.r}, 0, {rgbInput.b}), rgb({rgbInput.r}, 255, {rgbInput.b}));"
						></div>
						<input
							class="myslider"
							type="range"
							min="0"
							max="255"
							bind:value={rgbInput.g}
							oninput={() => {
								updateFromRgb();
							}}
							style="position: relative; width: 100%; height: 16px; background: transparent; cursor: crosshair; -webkit-appearance: none;"
						/>
					</div>

					<label>Blue</label>
					<div
						style="position: relative; width: 100%; height: 16px; border-radius: 8px; overflow: hidden;"
					>
						<div
							style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to right, rgb({rgbInput.r}, {rgbInput.g}, 0), rgb({rgbInput.r}, {rgbInput.g}, 255));"
						></div>
						<input
							class="myslider"
							type="range"
							min="0"
							max="255"
							bind:value={rgbInput.b}
							oninput={() => {
								updateFromRgb();
							}}
							style="position: relative; width: 100%; height: 16px; background: transparent; cursor: crosshair; -webkit-appearance: none;"
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
					<div>
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
					</div>
				</div>

				<!-- Palette -->
				<div>
					<label>Palette</label>
					<div
						style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; cursor:pointer;"
					>
						{#each appConsts.appColours as color, index}
							<div
								id="palette-{index}"
								style="background-color: {color}; width: 24px; height: 24px; border: 1px solid #ccc; margin-bottom: 16px; position: relative;"
								onclick={() => {
									hexInput = color;
									updateFromHex(color);
								}}
							>
								<div
									style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;"
								></div>
								<div
									style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: {color};"
								></div>
							</div>
						{/each}
					</div>
					<div style="display: flex; gap: 8px; margin-bottom: 8px;">
						<div>
							<span>New</span>
							<div
								style="width: 24px; height: 24px; border: 1px solid #ccc; margin-bottom: 16px; position: relative;"
							>
								<div
									style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;"
								></div>
								<div
									style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: {hexInput};"
								></div>
							</div>
						</div>
						<div>
							<span>Old</span>
							<div
								style="background-color: {initialColor}; width: 24px; height: 24px; border: 1px solid #ccc; margin-bottom: 16px; position: relative;"
							>
								<div
									style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;"
								></div>
								<div
									style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: {initialColor};"
								></div>
							</div>
						</div>
					</div>
					<div style="display: flex; gap: 8px;">
						<button
							onclick={() => {
								saveColor();
							}}
							style="padding: 4px 8px; background-color: #3b82f6; color: white; border-radius: 4px; border: none; cursor: pointer;"
						>
							Save to Palette
						</button>
						<button
							onclick={() => save()}
							style="padding: 4px 8px; background-color: #10b981; color: white; border-radius: 4px; border: none; cursor: pointer;"
						>
							Save
						</button>
					</div>
				</div>
			</div>
		</Box>
	</div>
{/if}
<!-- THE INDICATOR-->

<div
	style="background-color: {hexInput}; width: 24px; height: 24px; border: 1px solid #ccc; position: relative; cursor: pointer;"
	onclick={(e) => open(e)}
>
	<div
		style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;"
	></div>
	<div
		style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: {hexInput};"
	></div>
</div>

<style>
	.myslider::-webkit-slider-thumb,
	.slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 15px;
		height: 15px;
		background: rgba(1, 1, 1, 0);
		border: 2px solid black;
		outline: 2px solid white;
		border-radius: 50%;
		cursor: crosshair;
	}

	.slider::-moz-range-thumb,
	.myslider::-moz-range-thumb {
		width: 15px;
		height: 15px;
		background: rgba(1, 1, 1, 0);
		border: 2px solid black;
		outline: 2px solid white;
		border-radius: 50%;
		cursor: crosshair;
	}
</style>
