<script>
	// @ts-nocheck
	// Lightweight windowed (virtual) list. Renders only the rows visible in the
	// scroll viewport (plus an overscan margin) so a table of thousands of rows
	// costs only a screenful of DOM. Rows must be a FIXED height (`itemHeight`).
	//
	// Usage:
	//   <VirtualList items={rows} height={260} itemHeight={24}>
	//     {#snippet row(item, index)}
	//       <div>{index}: {item}</div>
	//     {/snippet}
	//   </VirtualList>
	//
	// The container scrolls; a single spacer element gives it the full scroll
	// height while the visible window is absolutely positioned via translateY.
	// A very long list (over about 400,000 rows of 24 px) would pass the browsers'
	// element-height cap, so its scroll is scaled instead (virtualScroll.js).
	import { scrollWindow } from './virtualScroll.js';

	let {
		items = [],
		height = 240,
		// When true, the list fills its flex parent (height comes from layout, not
		// the `height` prop) and measures itself via bind:clientHeight. Use this when
		// the available height isn't known up-front (e.g. a resizable plot box).
		fill = false,
		itemHeight = 24,
		overscan = 6,
		class: className = '',
		row
	} = $props();

	let scrollTop = $state(0);
	// Measured by bind:clientHeight below; seed with a sane default until then.
	let viewportH = $state(240);

	// Rows to render and where (virtualScroll.js). Past MAX_SCROLL_HEIGHT the scroll is
	// scaled so every row stays reachable under the browsers' element-height cap.
	const win = $derived(
		scrollWindow({ scrollTop, viewportH, total: items.length, itemHeight, overscan })
	);
	const totalHeight = $derived(win.spacerHeight);
	const startIndex = $derived(win.startIndex);
	const endIndex = $derived(win.endIndex);
	const offsetY = $derived(win.offsetY);

	// [item, absoluteIndex] pairs for the current window.
	const windowed = $derived(
		items.slice(startIndex, endIndex).map((item, i) => ({ item, index: startIndex + i }))
	);

	function onScroll(e) {
		scrollTop = e.currentTarget.scrollTop;
	}
</script>

<div
	class="vlist {className}"
	class:fill
	style={fill ? '' : `height:${typeof height === 'number' ? `${height}px` : height};`}
	bind:clientHeight={viewportH}
	onscroll={onScroll}
>
	<div class="vlist-spacer" style="height:{totalHeight}px;">
		<div class="vlist-window" style="transform:translateY({offsetY}px);">
			{#each windowed as { item, index } (index)}
				<div class="vlist-row" style="height:{itemHeight}px;">
					{@render row?.(item, index)}
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.vlist {
		overflow-y: auto;
		overflow-x: hidden;
		position: relative;
		will-change: transform;
	}
	/* Fill the available height of a flex-column parent instead of a fixed px. */
	.vlist.fill {
		flex: 1;
		min-height: 0;
	}
	.vlist-spacer {
		position: relative;
		width: 100%;
		/* A scaled list (virtualScroll.js) can render overscan rows past the spacer's end;
		   clipped, they cannot make the scroll range longer than the spacer. */
		overflow-y: clip;
	}
	.vlist-window {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
	}
	.vlist-row {
		box-sizing: border-box;
	}
</style>
