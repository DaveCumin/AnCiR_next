<!--
	The title row of one Data-tab series block, shared by every plot.

	One component instead of 13 hand-rolled headers, because the header now does three
	things and each was previously missing or duplicated per plot:

	  - TITLE: the wired column's name (live through renames — seriesDisplayLabel reads
	    the reactive column), falling back to the plot's positional text ("Data 2") while
	    unwired. Where the series carries a user label the title is editable in place and
	    the column name becomes the placeholder. Long names truncate with an ellipsis;
	    the full text rides on the title attribute.
	  - DELETE: routed through removeSeriesWithUndo, so it is one undoable history step
	    with a toast offering the undo — never a bare `theData.removeData(i)`.
	  - REORDER: a grip on the left (the same ⠇ handle as the Data view's Plots
	    list). Drag a block onto another and it takes that position; Alt+Up/Down on
	    the focused grip does the same one step at a time. Both route through
	    reorderSeriesWithUndo (seriesReorder.js), one undo step. Reordering changes
	    legend order AND draw order together (later series draw on top), exactly as
	    dragging a plot row changes its stacking order; see seriesReorder.js. The
	    drop target is the whole block (the header's parent element), with the
	    indicator on that block's top or bottom edge, since a tall block's header is
	    too small a target and its bottom edge is the block's middle. Hidden on a
	    single-series plot: nothing to reorder.
	  - ROW ACTIONS, in the panels' one fixed order (UI-12): show/hide and other per-plot
	    buttons (the `icons` snippet, Actogram's eye toggle), then the colour (the `swatch`
	    snippet, Actogram's ColourPicker), then delete last.

	A PASSIVE colour swatch (an inert dot showing the series' resolved colour) was
	tried here and rejected (2026-09-14): it looked clickable but was not, and the
	column-name title already identifies the block. See the vault note
	"2026-09-14-series-swatch-rejected". Don't re-add it.

	Styling is self-contained: the old markup relied on each plot's own scoped
	.control-component-title rules, which cannot reach into this component.
-->
<script module>
	// One drag session for the whole app: every header instance reads it, so the
	// block being dragged and the block under the pointer can be different
	// components. `$state.raw` on purpose: `inner` is already a $state proxy and
	// must be stored as-is so the identity check below (`drag.inner === inner`)
	// compares the same proxy, and nothing here needs deep reactivity.
	let drag = $state.raw({ inner: null, from: null, over: null });
	const resetDrag = () => {
		drag = { inner: null, from: null, over: null };
	};

	// The grips of one plot's series are ONE Tab stop (a roving tabindex): the grip of the
	// last series used is in the Tab order, the others are reached with Up/Down (Home/End),
	// so tabbing through a plot's Data tab stops on one grip, not one per series. Keyed by
	// list (the plot), holding that list's active series index.
	const rovingIndex = $state({});
</script>

<script>
	import { tick } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import { seriesDisplayLabel } from '$lib/components/plotbits/helpers/seriesLabel.js';
	import { removeSeriesWithUndo } from '$lib/plots/seriesDelete.js';
	import { reorderSeriesWithUndo, moveSeriesWithUndo } from '$lib/plots/seriesReorder.js';
	import { seriesComputeWarning } from '$lib/plots/seriesHealth.js';
	import { announce } from '$lib/utils/announce.js';

	let {
		/** the plot's inner data object (`theData`) — carries parentBox + removeData */
		inner,
		/** the series this block describes */
		datum,
		/** its position in inner.data */
		index = 0,
		/** whether the series carries a persistent user label (datum.label) */
		editable = true,
		/** positional fallback title while nothing is wired; plots may override
		 *  (PairsPlot says "Variable 1"). Defaults to "Data N". */
		fallback = null,
		removeTooltip = 'Remove this data series',
		/** an interactive colour control, rendered after `icons` and before delete (Actogram's ColourPicker) */
		swatch = null,
		/** per-plot buttons (show/hide first), rendered before the colour and delete */
		icons = null
	} = $props();

	// The grip's hint (aria-describedby), unique per header.
	const uid = $props.id();
	const hintId = `series-reorder-hint-${uid}`;
	// Which grips belong together (one plot's series): the roving tabindex's list.
	const listKey = $derived(`series-${inner?.parentBox?.id ?? uid}`);
	const activeIndex = $derived(
		Math.max(0, Math.min(rovingIndex[listKey] ?? 0, (inner?.data?.length ?? 1) - 1))
	);

	const positional = $derived(fallback ?? `Data ${index + 1}`);
	// The one shared title-string helper: user label → wired column name → positional.
	const columnTitle = $derived(seriesDisplayLabel(datum, { fallback: positional }));
	// What the Editable shows as ghost text while the label is blank: the same
	// string minus the user-label tier (the label IS the Editable's own value).
	// Only the name-bearing fields are handed over — spreading the whole datum
	// would read every computed field on the class.
	const placeholder = $derived(
		seriesDisplayLabel({ y: datum?.y, column: datum?.column }, { fallback: positional })
	);

	// Dead-series diagnosis: a WIRED series whose inputs cannot compute renders
	// nothing on the canvas, so the block says why (seriesHealth.js). Unwired
	// blocks stay quiet — empty pickers already say "not wired yet".
	const computeWarning = $derived(seriesComputeWarning(datum, columnTitle));

	// ─── Reorder ───────────────────────────────────────────────────────────────
	const reorderable = $derived((inner?.data?.length ?? 0) > 1);
	// This block is the live drop target of a drag from a SIBLING block of the same
	// plot. A foreign drag (another plot, a column from the Data view) never lights
	// it up, and a block never targets itself.
	const isDropTarget = $derived(
		drag.inner != null && drag.inner === inner && drag.over === index && drag.from !== index
	);
	// Where the moved block will land relative to this one: dropping takes this
	// block's position (Plots-list semantics), so a block dragged from above ends up
	// BELOW this one and a block dragged from below ends up ABOVE it.
	const dropEdge = $derived(!isDropTarget ? null : drag.from < index ? 'after' : 'before');

	let headerEl = $state(null);
	let handleEl = $state(null);
	// The block this header titles. Every consumer wraps the header in its
	// `.dataBlock`; in isolation (tests) the parent is whatever container holds it.
	const blockOf = (el) => el?.parentElement ?? el;

	function onDragStart(e) {
		drag = { inner, from: index, over: null };
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// Firefox refuses to start a drag with no data.
			e.dataTransfer.setData('text/plain', columnTitle);
			const block = blockOf(headerEl);
			if (block && typeof e.dataTransfer.setDragImage === 'function') {
				e.dataTransfer.setDragImage(block, 12, 12);
			}
		}
	}

	// Up/Down (Home/End) go to another grip of the same plot. By DOM, since each grip belongs
	// to its own header component; document order is the series order.
	function moveFocus(e) {
		const grips = [
			...document.querySelectorAll(`.series-drag-handle[data-series-list="${listKey}"]`)
		];
		const i = grips.indexOf(e.currentTarget);
		if (i < 0) return false;
		const to = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: grips.length - 1 }[e.key];
		if (to === undefined) return false;
		e.preventDefault();
		const target = grips[Math.max(0, Math.min(to, grips.length - 1))];
		if (target && target !== e.currentTarget) target.focus();
		return true;
	}

	async function onHandleKeydown(e) {
		if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && moveFocus(e)) return;
		if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
		e.preventDefault();
		e.stopPropagation();
		const delta = e.key === 'ArrowUp' ? -1 : +1;
		const title = columnTitle;
		const n = inner?.data?.length ?? 0;
		const moved = moveSeriesWithUndo(inner, index, delta);
		if (moved == null) {
			announce(`${title} is already ${delta < 0 ? 'first' : 'last'}.`);
			return;
		}
		announce(`Moved ${title} to position ${moved + 1} of ${n}.`);
		// The moved grip stays the list's Tab stop (no focus event fires if the browser kept
		// focus on it through the move).
		rovingIndex[listKey] = moved;
		// The {#each} in every consumer is keyed on column ids, which survive the
		// setPlotInner round trip, so the moved block keeps its DOM node; but the
		// browser blurs a focused element when it is re-inserted at its new
		// position, so put focus back on the grip for the next step.
		await tick();
		handleEl?.focus();
	}

	// Drop-target wiring on the parent block. An attachment rather than markup
	// because the block element belongs to the consumer, not to this component.
	// The handlers read `inner`/`index` at event time (current props), and the
	// attachment body itself reads no state, so it is set up once per mount.
	function dropTarget(el) {
		const block = blockOf(el);
		if (!block) return;
		const active = () => drag.inner != null && drag.inner === inner;
		const onOver = (e) => {
			if (!active()) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			if (drag.over !== index) drag = { ...drag, over: index };
		};
		const onLeave = (e) => {
			// Leaving for a descendant still counts as "over"; only a true exit clears.
			if (drag.over === index && !(e.relatedTarget && block.contains(e.relatedTarget))) {
				drag = { ...drag, over: null };
			}
		};
		const onDrop = (e) => {
			if (!active()) return;
			e.preventDefault();
			const from = drag.from;
			resetDrag();
			reorderSeriesWithUndo(inner, from, index);
		};
		block.addEventListener('dragover', onOver);
		block.addEventListener('dragleave', onLeave);
		block.addEventListener('drop', onDrop);
		return () => {
			block.removeEventListener('dragover', onOver);
			block.removeEventListener('dragleave', onLeave);
			block.removeEventListener('drop', onDrop);
		};
	}

	// The indicator classes live on the block (top edge = before, bottom = after).
	// The block's own styles cannot be reached from here, so they are global
	// classes toggled by effect; see the style block below.
	$effect(() => {
		const block = blockOf(headerEl);
		if (!block) return;
		block.classList.toggle('series-drop-before', dropEdge === 'before');
		block.classList.toggle('series-drop-after', dropEdge === 'after');
		return () => {
			block.classList.remove('series-drop-before', 'series-drop-after');
		};
	});
</script>

<div class="series-block-header" bind:this={headerEl} {@attach dropTarget}>
	<div class="series-block-identity">
		{#if reorderable}
			<button
				class="series-drag-handle"
				bind:this={handleEl}
				type="button"
				draggable="true"
				aria-label="Drag to reorder this series (Alt+Up/Down moves it)"
				aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
				aria-describedby={hintId}
				title="Drag to reorder (changes legend and draw order), or press Alt+Up/Down"
				tabindex={index === activeIndex ? 0 : -1}
				data-series-list={listKey}
				ondragstart={onDragStart}
				ondragend={resetDrag}
				onkeydown={onHandleKeydown}
				onfocus={() => (rovingIndex[listKey] = index)}
			>
				⠇
			</button>
			<span id={hintId} class="sr-only"
				>{columnTitle}: moving it changes the legend and draw order. Up and Down go to the other
				series.</span
			>
		{/if}
		<p class="series-title" title={columnTitle}>
			{#if editable}
				<Editable bind:value={datum.label} {placeholder} />
			{:else}
				{columnTitle}
			{/if}
		</p>
	</div>
	<!-- Row actions in the panels' one fixed order (UI-12): show/hide, colour, others,
	     delete last. -->
	<div class="series-block-icons">
		{@render icons?.()}
		{#if swatch}
			{@render swatch()}
		{/if}
		<button
			class="icon"
			title={removeTooltip}
			aria-label={removeTooltip}
			onclick={() => removeSeriesWithUndo(inner, index)}
		>
			<Icon name="trash" width={16} height={16} className="series-block-icon" />
		</button>
	</div>
</div>

{#if computeWarning}
	<!-- Same house style as the plots' own .data-warning blocks (Periodogram /
	     Boxplot data-quality cautions), self-contained because their scoped
	     rules cannot reach into this component. -->
	<div class="data-warning">
		<p>⚠ {computeWarning}</p>
	</div>
{/if}

<style>
	.series-block-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	.series-block-identity {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0; /* let the title shrink so the ellipsis can engage */
		flex: 1;
	}

	.series-title {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The Editable inside renders its own span/input; keep it on one line so the
	   title's ellipsis rule applies to it too. */
	.series-title :global(span),
	.series-title :global(input) {
		white-space: nowrap;
	}

	/* 16 px icons 24 px apart, so their 24 px pointer targets touch and never overlap. */
	.series-block-icons {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-shrink: 0;
	}

	.data-warning {
		margin: 0 0 var(--space-2);
		padding: 0.45rem 0.6rem;
		border-radius: 0.375rem;
		background: color-mix(in srgb, #f5c76a 18%, white);
		border: 1px solid color-mix(in srgb, #d89c1b 35%, white);
		font-weight: 400;
	}

	.data-warning p {
		margin: 0.15rem 0;
		font-size: 0.92em;
	}

	/* The grip: same glyph, size and colour as the Plots list's .plot-drag-handle.
	   Resting at low opacity rather than hidden (the Plots rows are one line tall
	   and reveal on row hover; a block is several lines and its handle needs to be
	   findable), full on header hover and keyboard focus. */
	.series-drag-handle {
		background: none;
		border: none;
		padding: 0 var(--space-1);
		margin: 0;
		cursor: grab;
		user-select: none;
		font-size: var(--font-sm);
		font-weight: 400;
		line-height: 1;
		color: var(--color-lightness-50);
		opacity: 0.45;
		transition: opacity 0.15s ease;
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}
	.series-drag-handle:active {
		cursor: grabbing;
	}
	.series-block-header:hover .series-drag-handle,
	.series-drag-handle:focus-visible {
		opacity: 1;
	}

	/* Drop indicator on the consumer's block: a 2px line on the edge the dragged
	   block will land at, the Plots list's .plot-drag-over colour. Box-shadow, not
	   border, so nothing shifts while dragging. */
	:global(.series-drop-before) {
		box-shadow: 0 -2px 0 0 var(--color-lightness-35);
	}
	:global(.series-drop-after) {
		box-shadow: 0 2px 0 0 var(--color-lightness-35);
	}

	button.icon {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
	}
</style>
