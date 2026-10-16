<script>
	// @ts-nocheck
	// Per-node note button: lives in the node header and toggles a popover
	// textarea for the note text. Stores notes in core.nodeNotes keyed by
	// canvas node id (data_<colId>, process_<procId>, plot_<plotId>, ...).
	//
	// The popover is portalled to <body> and placed with `position: fixed` from
	// the badge's getBoundingClientRect(). Rendering it inline next to the badge
	// broke in the workspace (plots) view: a plot box is `overflow: hidden`, so a
	// popover anchored at the badge on the box's LEFT edge was clipped to a
	// sliver, and both views wrap their nodes in a pan/zoom CSS transform, which
	// captures any `position: fixed` descendant. Hosting it on <body> sidesteps
	// both; the badge rect is re-read every frame while open so the popover
	// follows its node through drags, pans, zooms and scrolls.
	import { tick } from 'svelte';
	import { core } from '$lib/core/core.svelte.js';
	import { markSessionEdited } from '$lib/core/unsavedChanges.svelte.js';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { placeNotePopover } from './notePopoverPlacement.js';
	import Icon from '$lib/icons/Icon.svelte';

	let { nodeId } = $props();

	let open = $state(false);
	let draft = $state('');
	let rootEl;
	let btnEl;
	// `$state` because `bind:this` writes it after the popover mounts; a plain `let`
	// compiles to a non-reactive binding (the compiler's `non_reactive_update` warning)
	// and would silently stop any reactive read from ever seeing the element.
	let textareaEl = $state(null);
	let popoverEl = $state(null);
	let pos = $state({ top: 0, left: 0, placement: 'below' });
	// Hidden until the first measurement so the popover never flashes at 0,0.
	let placed = $state(false);

	function portalToBody(node) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.parentNode?.removeChild(node);
			}
		};
	}

	function updatePosition() {
		if (!btnEl || !popoverEl) return;
		const anchor = btnEl.getBoundingClientRect();
		const next = placeNotePopover(
			anchor,
			{ width: popoverEl.offsetWidth, height: popoverEl.offsetHeight },
			{ width: window.innerWidth, height: window.innerHeight }
		);
		if (next.top !== pos.top || next.left !== pos.left || next.placement !== pos.placement) {
			pos = next;
		}
		placed = true;
	}

	// While open: measure once mounted, then track the badge. Canvas pan/zoom is
	// a transform change (no scroll event), so a rAF loop is the only reliable
	// way to follow it; it runs only while the popover is open.
	$effect(() => {
		if (!open || !popoverEl) return;
		updatePosition();
		let raf = 0;
		const loop = () => {
			updatePosition();
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		window.addEventListener('scroll', updatePosition, true);
		window.addEventListener('resize', updatePosition);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('scroll', updatePosition, true);
			window.removeEventListener('resize', updatePosition);
			placed = false;
		};
	});

	let note = $derived(core.nodeNotes[nodeId] ?? '');
	let hasNote = $derived(note.trim().length > 0);

	async function openEditor() {
		draft = note;
		open = true;
		await tick();
		textareaEl?.focus();
		textareaEl?.select();
	}

	function toggleEditor() {
		if (open) {
			open = false;
			return;
		}
		void openEditor();
	}

	function saveNote() {
		const next = draft.trim();
		if (next === '') {
			delete core.nodeNotes[nodeId];
		} else {
			core.nodeNotes[nodeId] = next;
		}
		// Node notes are not operations (unsavedChanges.svelte.js, point 3).
		markSessionEdited();
		open = false;
	}

	function clearNote() {
		draft = '';
		delete core.nodeNotes[nodeId];
		markSessionEdited();
		open = false;
	}

	function shortTitle(s) {
		if (!s) return '';
		const trimmed = s.replace(/\s+/g, ' ').trim();
		return trimmed.length > 28 ? `"${trimmed.slice(0, 28)}…"` : `"${trimmed}"`;
	}
</script>

<div class="node-note-wrap" bind:this={rootEl}>
	<button
		bind:this={btnEl}
		type="button"
		class="node-note-btn hit-target"
		class:has-note={hasNote}
		onclick={(e) => {
			e.stopPropagation();
			toggleEditor();
		}}
		onpointerdown={(e) => e.stopPropagation()}
		aria-label={hasNote ? 'View or edit note' : 'Add note'}
		{@attach tooltip(hasNote ? shortTitle(note) : 'Add note')}
	>
		<Icon name="note" width={12} height={12} className="node-note-icon" />
	</button>
</div>

{#if open}
	<div
		bind:this={popoverEl}
		use:portalToBody
		class="node-note-popover"
		style="top: {pos.top}px; left: {pos.left}px; visibility: {placed ? 'visible' : 'hidden'};"
		role="presentation"
		onpointerdown={(e) => e.stopPropagation()}
		onmousedown={(e) => e.stopPropagation()}
		onclick={(e) => e.stopPropagation()}
	>
		<div class="node-note-label">Node note</div>
		<textarea
			bind:this={textareaEl}
			class="node-note-textarea"
			bind:value={draft}
			rows="4"
			placeholder="Add context, reminders, or interpretation notes"
		></textarea>
		<div class="node-note-actions">
			<button type="button" class="np-action" onclick={saveNote}>Save</button>
			<button type="button" class="np-action" onclick={() => (open = false)}>Close</button>
			{#if hasNote || draft.trim() !== ''}
				<button type="button" class="np-action danger" onclick={clearNote}>Clear</button>
			{/if}
		</div>
	</div>
{/if}

<svelte:window
	onpointerdowncapture={(e) => {
		// Capture phase: the plots-view canvas stops click propagation on
		// deselect, so a bubbling `click` listener never saw outside clicks there.
		if (!open) return;
		if (rootEl?.contains(e.target) || popoverEl?.contains(e.target)) return;
		open = false;
	}}
	onkeydown={(e) => {
		if (open && e.key === 'Escape') {
			// preventDefault: the canvas's own Escape (deselect) skips a handled Escape.
			e.preventDefault();
			e.stopPropagation();
			open = false;
		}
	}}
/>

<style>
	.node-note-wrap {
		flex: 0 0 auto;
	}

	/* A 12 px note glyph in an 18 px box, so it sits in a dense node header; .hit-target
	   (app.css) gives it the 24 x 24 pointer target without growing the box (UI-16). */
	.node-note-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		padding: var(--space-1);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
	}

	.node-note-btn:hover {
		color: var(--color-lightness-25);
		border-color: var(--divider);
		background: var(--color-lightness-96);
	}

	.node-note-btn.has-note {
		color: var(--color-success);
		border-color: color-mix(in srgb, var(--color-success) 40%, transparent);
		background: var(--color-success-bg);
	}

	/* Lives on <body> (see portalToBody), so this is viewport-fixed and never
	   clipped by an overflow:hidden node/plot box or scaled by canvas zoom.
	   Above the navbar/rail (1000s) but below modals (9999). */
	.node-note-popover {
		position: fixed;
		width: 260px;
		padding: var(--space-4);
		border: 1px solid rgba(0, 0, 0, 0.18);
		border-radius: var(--radius-md);
		background: var(--surface-card);
		box-shadow: var(--shadow-2);
		z-index: 1200;
		cursor: default;
		box-sizing: border-box;
	}

	.node-note-label {
		font-size: var(--font-xs);
		font-weight: 600;
		margin-bottom: 4px;
		color: rgba(0, 0, 0, 0.6);
	}

	.node-note-textarea {
		width: 100%;
		min-height: 80px;
		resize: vertical;
		line-height: 1.3;
		padding: 4px 6px;
		font-size: var(--font-sm);
		font-family: inherit;
		border: 1px solid rgba(0, 0, 0, 0.2);
		border-radius: var(--radius-sm);
		outline: none;
		box-sizing: border-box;
	}

	.node-note-textarea:focus {
		border-color: var(--color-accent);
	}

	.node-note-actions {
		display: flex;
		gap: 4px;
		margin-top: 6px;
	}

	.np-action {
		font-size: var(--font-xs);
		padding: 3px 8px;
		border: 1px solid rgba(0, 0, 0, 0.2);
		background: var(--surface-card);
		border-radius: var(--radius-xs);
		cursor: pointer;
	}

	.np-action:hover {
		background: rgba(0, 0, 0, 0.05);
	}

	.np-action.danger {
		color: var(--color-error);
		border-color: rgba(176, 48, 48, 0.4);
	}

	.np-action.danger:hover {
		background: rgba(176, 48, 48, 0.08);
	}
</style>
