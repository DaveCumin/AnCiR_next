<script>
	// @ts-nocheck
	import { history } from '$lib/core/history.svelte.js';

	let {
		handleTooltip = () => {}
	} = $props();

	function tooltip(content) {
		return {
			onmouseenter: (e) =>
				handleTooltip({ detail: { visible: true, x: e.clientX + 10, y: e.clientY + 10, content } }),
			onmouseleave: (e) =>
				handleTooltip({ detail: { visible: false, x: e.clientX + 10, y: e.clientY + 10, content: '' } })
		};
	}
</script>

<button
	type="button"
	class="nav-btn"
	disabled={!history.canUndo}
	onclick={() => history.undo()}
	{...tooltip(`Undo (Cmd/Ctrl+Z)${history.canUndo ? ` — ${history.undoCount} step${history.undoCount > 1 ? 's' : ''}` : ''}`)}
>
	<span class="glyph" aria-hidden="true">↶</span>
</button>

<button
	type="button"
	class="nav-btn"
	disabled={!history.canRedo}
	onclick={() => history.redo()}
	{...tooltip(`Redo (Cmd/Ctrl+Shift+Z)${history.canRedo ? ` — ${history.redoCount} step${history.redoCount > 1 ? 's' : ''}` : ''}`)}
>
	<span class="glyph" aria-hidden="true">↷</span>
</button>

<style>
	.nav-btn {
		background: transparent;
		border: none;
		padding: 0.3rem 0.5rem;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
		border-radius: 0.25rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.nav-btn:hover:not(:disabled) {
		background: var(--color-lightness-95, #eee);
	}

	.nav-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.glyph {
		font-size: 1.25rem;
		line-height: 1;
	}
</style>
