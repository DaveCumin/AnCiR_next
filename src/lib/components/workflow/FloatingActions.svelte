<script>
	// @ts-nocheck
	// Floating canvas actions, AnCiR port of flowtest's FloatingActions.
	// Lives inside WorkflowEditor's canvas-viewport overlay layer:
	//   · Top-left:  load / save session
	//   · Bottom-left: undo / redo
	import Icon from '$lib/icons/Icon.svelte';
	import { history } from '$lib/core/opHistory.svelte.js';
	import { exportJson } from '$lib/components/iconActions/Setting.svelte';
	import LoadSessionModal from './LoadSessionModal.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

	let showLoadModal = $state(false);
</script>

<div class="fa-layer" aria-label="Canvas actions">
	<div class="fa-top-left">
		<button
			type="button"
			class="fa-btn"
			onclick={() => (showLoadModal = true)}
			aria-label="Load session"
			{@attach tooltip('Load a session')}
		>
			<Icon name="sessionload" width={24} height={24} />
		</button>
		<button
			type="button"
			class="fa-btn"
			onclick={exportJson}
			aria-label="Save session"
			{@attach tooltip('Save this session')}
		>
			<Icon name="sessionsave" width={24} height={24} />
		</button>
	</div>

	<div class="fa-bot-left">
		<button
			type="button"
			class="fa-btn"
			onclick={() => history.undo()}
			disabled={!history.canUndo}
			aria-label="Undo"
			{@attach tooltip(
				`Undo (Cmd/Ctrl+Z)${history.canUndo ? ` — ${history.undoCount} step${history.undoCount > 1 ? 's' : ''}` : ''}`
			)}
		>
			<Icon name="undo" width={22} height={22} />
		</button>
		<button
			type="button"
			class="fa-btn"
			onclick={() => history.redo()}
			disabled={!history.canRedo}
			aria-label="Redo"
			{@attach tooltip(
				`Redo (Cmd/Ctrl+Shift+Z)${history.canRedo ? ` — ${history.redoCount} step${history.redoCount > 1 ? 's' : ''}` : ''}`
			)}
		>
			<Icon name="redo" width={22} height={22} />
		</button>
	</div>

</div>

<LoadSessionModal bind:showModal={showLoadModal} />

<style>
	.fa-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 30;
	}

	.fa-top-left {
		position: absolute;
		top: 12px;
		left: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		pointer-events: auto;
	}

	.fa-bot-left {
		position: absolute;
		bottom: 12px;
		left: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		pointer-events: auto;
	}

	/* Match flowtest's .fa-btn exactly: transparent, borderless, icon-only. */
	.fa-btn {
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 26px;
		padding: 0;
		color: var(--color-text-muted, #666);
		background: transparent;
		border: 0;
		cursor: pointer;
		transition:
			color 0.18s ease,
			transform 0.32s ease;
	}

	.fa-btn:hover:not(:disabled) {
		color: var(--color-accent);
	}

	.fa-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.fa-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
