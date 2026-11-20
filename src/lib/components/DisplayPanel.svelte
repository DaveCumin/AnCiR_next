<script module>
	export function closeDisplayPanel() {
		appState.currentTab = null;
		appState.showDisplayPanel = false;
	}
</script>

<script>
	// @ts-nocheck

	import { appState } from '$lib/core/core.svelte.js';
	import DataDisplay from '$lib/components/views/DataDisplay.svelte';
	import { fly } from 'svelte/transition';
	import { separatorKeyValue } from '$lib/utils/separatorKeys.js';

	let container = $state();
	const minWidth = 200;
	const maxWidth = 500;

	// The width a fresh session opens with (appState in core.svelte.js); Enter on the
	// splitter puts it back.
	const defaultWidth = 250;

	let resizeSide = 'right';
	let resizing = false;

	function onMouseMove(e) {
		if (!resizing) return;

		const rect = container.getBoundingClientRect();
		let newWidth;

		if (resizeSide === 'right') {
			newWidth = e.clientX - rect.left;
		} else {
			newWidth = rect.right - e.clientX;
		}
		if (newWidth > maxWidth - 1 || newWidth < minWidth + 1) {
			return;
		}

		appState.widthDisplayPanel = newWidth;
	}

	function stopResize() {
		resizing = false;
		document.body.style.userSelect = '';
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', stopResize);
	}

	// Drop any dangling drag listeners if this unmounts mid-gesture.
	$effect(() => stopResize);

	// The splitter from the keyboard (WAI-ARIA window splitter): arrows step, Home/End go to
	// the ends, Enter restores the default width. The data panel sits left of its edge,
	// so it grows to the right.
	function onResizeKeydown(e) {
		const next = separatorKeyValue(e, {
			value: appState.widthDisplayPanel,
			min: minWidth,
			max: maxWidth,
			grow: 'right',
			defaultValue: defaultWidth
		});
		if (next == null) return;
		e.preventDefault();
		appState.widthDisplayPanel = next;
	}

	function startResize() {
		resizing = true;
		document.body.style.userSelect = 'none';
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', stopResize);
	}
</script>

{#if appState.showDisplayPanel}
	<aside
		bind:this={container}
		aria-label="Data panel"
		id="data-panel"
		class="view-container {resizeSide}"
		style="left: {appState.widthNavBar}px; width: {appState.widthDisplayPanel}px; min-width: {minWidth}px;	max-width: {maxWidth}px;"
		in:fly={{ x: -appState.widthDisplayPanel, duration: 600 }}
		out:fly={{ x: -appState.widthDisplayPanel, duration: 600 }}
	>
		<!-- Sources, Nodes and Plots all live in one panel now; the worksheet plot
		     list was folded into DataDisplay's "Plots" section. -->
		{#if appState.currentTab === 'data' || appState.currentTab === 'worksheet'}
			<DataDisplay />
		{/if}
	</aside>
	<!-- A focusable separator is a widget in WAI-ARIA (the window splitter); Svelte counts
	     every separator as static, hence the ignore (see svelteWarnings.guard.test.js). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="resizer-overlay {resizeSide}"
		style="left: {appState.widthNavBar +
			appState.widthDisplayPanel -
			(resizeSide === 'right' ? 6 : 0)}px;"
		role="separator"
		tabindex="0"
		aria-orientation="vertical"
		aria-label="Resize the data panel"
		aria-controls="data-panel"
		aria-valuenow={Math.round(appState.widthDisplayPanel)}
		aria-valuemin={minWidth}
		aria-valuemax={maxWidth}
		onmousedown={startResize}
		onkeydown={onResizeKeydown}
	></div>
{/if}

<style>
	.openDisplayPanel {
		position: fixed;
		top: 10px;
		left: 56px;
		z-index: 999;
	}
	.view-container {
		overflow-y: auto;
		overflow-x: hidden;
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: start;
		align-items: start;

		position: fixed;
		top: 0;
		left: 56px;

		border-right: 1px solid var(--color-lightness-85);
		background: var(--surface-card);
		box-sizing: border-box;

		z-index: 999;
		/* box-shadow: 5px 0 10px rgba(0, 0, 0, 0.3); */
	}

	.view-container::-webkit-scrollbar {
		display: none;
	}

	.resizer {
		width: 6px;
		cursor: ew-resize;
		height: 100vh; /* Set the height to a very large value to account for scrolling */
		position: absolute;
		background-color: transparent;
		z-index: 1000; /* Higher than the container's z-index */
	}
	.resizer-overlay {
		/* invisible drag strip over the panel boundary; 12px (was 6) for an easier grab.
		   Not the full 24px since it would intercept clicks on panel-edge content. */
		width: 12px;
		height: 100vh;
		position: fixed;
		top: 0;
		margin-left: -3px;
		cursor: ew-resize;
		background-color: transparent;
		z-index: 1001;
	}
	/* Keyboard focus only (mouse users see no change): the ring is drawn inside the strip so
	   none of it falls off the top or bottom of the window. */
	.resizer-overlay:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
</style>
