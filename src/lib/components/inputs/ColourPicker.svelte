<script module>
	//TODO : This needs styling

	export function getRandomColor() {
		const letters = '0123456789ABCDEF';
		let color = '#';
		for (let i = 0; i < 6; i++) {
			color += letters[Math.floor(Math.random() * 16)];
		}
		return color;
	}

	export function getPaletteColor(n) {
		return appConsts.appColours[n % appConsts.appColours.length];
	}
</script>

<script>
	import { tick } from 'svelte';

	import { onMount, onDestroy } from 'svelte';
	import { appConsts, appState } from '$lib/core/core.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	let { value = $bindable() } = $props();

	//for moving around
	let pos = $state({ x: 100, y: 100, width: 300, height: 250 });
	const minWidth = 300;
	const minHeight = 200;
	let moving = false;
	let resizing = false;
	let initialMouseX, initialMouseY, initialWidth, initialHeight;

	function onMouseDown(e) {
		moving = true;
	}

	function onMouseMove(e) {
		if (moving) {
			pos.x += e.movementX;
			pos.y += e.movementY;

			pos.x = Math.max(0, pos.x);
			pos.y = Math.max(0, pos.y);
		} else if (resizing) {
			const deltaX = e.clientX - initialMouseX;
			const deltaY = e.clientY - initialMouseY;

			const maxWidth = 300;
			const maxHeight = 500;

			pos.width = Math.max(minWidth, Math.min(initialWidth + deltaX, maxWidth));
			pos.height = Math.max(minHeight, Math.min(initialHeight + deltaY, maxHeight));
		}
	}

	function onMouseUp() {
		moving = false;
		resizing = false;
	}

	function startResize(e) {
		e.stopPropagation();
		resizing = true;
		initialMouseX = e.clientX;
		initialMouseY = e.clientY;
		initialWidth = pos.width;
		initialHeight = pos.height;
	}

	//for the colour picker -----------------------
	let show = $state(false);
	let showAdvanced = $state(false);
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
		if (!appConsts.appColours.includes(hexInput)) {
			appConsts.appColours.push(hexInput);
		}
	}

	//so can move wherever
	$effect(() => {
		if (show) {
			if (container.parentNode.nodeName != 'BODY') {
				// don't re-float it each update
				document.body.append(container); //make it 'floating'
			}
		}
	});

	//make sure only one is open at a time
	$effect(() => {
		if (!appState.showColourPicker) {
			show = false;
		}
	});

	async function open(e) {
		appState.showColourPicker = false;
		await tick(); //Need this to update all the other pickers (remove them)
		//work out where it should be rendered
		const mouseX = e.clientX;
		const mouseY = e.clientY;
		if (mouseX + 320 > window.innerWidth) {
			pos.x = mouseX - 320;
		} else {
			pos.x = mouseX + 10;
		}

		if (mouseY + 320 > window.innerHeight) {
			pos.y = mouseY - 320;
		} else {
			pos.y = mouseY + 10;
		}
		//render the plot
		appState.showColourPicker = true;
		show = true;
	}

	function save() {
		value = hexInput;
		initialColor = $state.snapshot(value);
		show = false;
	}

	$effect(() => {
		if (showAdvanced) {
			drawPicker();
		}
	});

	onMount(() => {
		updateFromHex(value);
		if (window.EyeDropper) {
			caneyedrop = true;
		}
		initialColor = $state.snapshot(value);
	});
	onDestroy(() => {
		if (container && container.parentNode) {
			container.parentNode.removeChild(container);
		}
	});
</script>

<svelte:window onmousemove={onMouseMove} onmouseup={onMouseUp} />

<!-- Pop-up Color Picker -->
{#if show}
	<div bind:this={container} style="position:absolute; top:0; left:0; z-index:1000">
		<section
			class="colour-picker"
			style="left: {pos.x}px;
		top: {pos.y}px;
		width: {pos.width + 20}px;
		height: {pos.height + 50}px;"
		>
			<div class="cp-header" onmousedown={(e) => onMouseDown(e)}>
				<p>Colour Picker</p>
				<button class="icon" onclick={() => {show = false;}}>
					<Icon name="close" width={16} height={16} className="close" />
				</button>
			</div>
			<div class="cp-content">
				<div style="background:white; padding: 16px; position: relative;">
					<!-- Color Preview -->
					<div style="display: flex; gap: 8px; margin-bottom: 16px;">
						<div>
							<span>New</span>
							<div style="width: 24px; height: 24px; border: 1px solid #ccc; position: relative;">
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
								style="background-color: {initialColor}; width: 24px; height: 24px; border: 1px solid #ccc; position: relative;"
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

					<!-- Palette -->
					<div style="margin-bottom: 16px;">
						<label>Palette</label>
						<div style="display: flex; flex-wrap: wrap; gap: 8px; cursor: pointer;">
							{#each appConsts.appColours as color, index}
								<div
									id="palette-{index}"
									style="background-color: {color}; width: 24px; height: 24px; border: 1px solid #ccc; position: relative;"
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
					</div>
					<button
						onclick={() => {
							const randomCol = getRandomColor();
							hexInput = randomCol;
							updateFromHex(randomCol);
						}}
						style="padding: 4px 8px; background-color: #6b7280; color: white; border-radius: 4px; border: none; cursor: pointer;"
					>
						Pick random colour
					</button>
					<!-- Eyedropper and Toggle -->
					<div style="display: flex; gap: 8px; margin-bottom: 16px;">
						{#if caneyedrop}
							<button
								onclick={() => eyedropper()}
								style="padding: 4px 8px; background-color: #6b7280; color: white; border-radius: 4px; border: none; cursor: pointer;"
							>
								Eyedropper
							</button>
						{/if}
						<button
							onclick={() => (showAdvanced = !showAdvanced)}
							style="padding: 4px 8px; background-color: #6b7280; color: white; border-radius: 4px; border: none; cursor: pointer;"
						>
							{showAdvanced ? 'Hide Advanced' : 'More Options'}
						</button>
					</div>

					{#if showAdvanced}
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
									oninput={() => updateFromHsv()}
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
									oninput={() => updateFromHsv()}
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
									oninput={() => updateFromHsv()}
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
									oninput={() => updateFromHsv()}
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
									oninput={() => updateFromRgb()}
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
									oninput={() => updateFromRgb()}
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
									oninput={() => updateFromRgb()}
									style="position: relative; width: 100%; height: 16px; background: transparent; cursor: crosshair; -webkit-appearance: none;"
								/>
							</div>
						</div>

						<!-- Inputs -->
						<div
							style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;"
						>
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
					{/if}

					<!-- Save Buttons -->
					<div style="display: flex; gap: 8px;">
						<button
							onclick={() => saveColor()}
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
			<div class="resize-handle" onmousedown={startResize}></div>
		</section>
	</div>
{/if}

<!-- Indicator -->
<div
	class="cp-preview"
	style="background-color: {value};"
	onclick={(e) => open(e)}
>
	<!-- <div
		style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%); background-size: 10px 10px; background-position: 0 0, 0 5px, 5px -5px, -5px 0;"
	></div> -->
	<!-- <div
		style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background-color: {value};"
	></div> -->
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

	.myslider::-moz-range-thumb,
	.slider::-moz-range-thumb {
		width: 15px;
		height: 15px;
		background: rgba(1, 1, 1, 0);
		border: 2px solid black;
		outline: 2px solid white;
		border-radius: 50%;
		cursor: crosshair;
	}

	label {
		display: block;
		font-size: 14px;
		margin-bottom: 4px;
		color: #333;
	}

	button:hover {
		opacity: 0.9;
	}

	.colour-picker {
		user-select: none;
		position: absolute;
		border: solid 1px var(--color-lightness-85);
		background-color: white;
		box-sizing: border-box;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
		border-radius: 4px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-width: 200px;
		z-index: 1;
	}

	.cp-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		flex-shrink: 0;
		cursor: move;

		padding: 0.5rem;
		padding-left: 1rem;
		padding-right: 0.4rem;
		background-color: var(--color-lightness-98);
		border-bottom: 1px solid var(--color-lightness-85);

		font-weight: bold;
	}

	.cp-header p {
		margin: 0;
	}

	.cp-header button {
		width: 20px;
		height: 20px;
	}

	.cp-content {
		flex: 1;
		padding: 0.5rem;
		overflow: auto;
	}

	.cp-preview {
		width: var(--control-input-height);
		height: var(--control-input-height);
		box-sizing: border-box;

		border-radius: 2px;
		border: 1px solid var(--color-lightness-85);
		
		position: relative;
		cursor: pointer;

		transition: border-color 0.2s;
	}

	.cp-preview:hover {
		border: 1px solid var(--color-lightness-35);
	}

	.resize-handle {
		position: absolute;
		width: 16px;
		height: 16px;
		right: 0;
		bottom: 0;
		cursor: nwse-resize;
		/* background-color: #888; */
		border-radius: 2px;
	}
</style>
