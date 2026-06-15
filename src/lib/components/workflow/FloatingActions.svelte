<script>
	// @ts-nocheck
	// Floating canvas actions, AnCiR port of flowtest's FloatingActions.
	// Lives inside WorkflowEditor's canvas-viewport overlay layer:
	//   · Top-left:  load / save session
	//   · Bottom-left: undo / redo
	import Icon from '$lib/icons/Icon.svelte';
	import { history } from '$lib/core/history.svelte.js';
	import { exportJson, importJson } from '$lib/components/iconActions/Setting.svelte';
	import { appState } from '$lib/core/core.svelte.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { tick } from 'svelte';

	let fileInput;

	async function handleLoad(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			const json = JSON.parse(text);
			appState.loadingState.isLoading = true;
			appState.loadingState.loadingMsg = 'Loading session…';
			await tick();
			await importJson(json, (detail) => {
				appState.loadingState.loadingMsg = detail;
			});
		} catch (err) {
			addNotification(`Failed to load session: ${err?.message ?? err}`);
		} finally {
			appState.loadingState.isLoading = false;
			appState.loadingState.loadingMsg = '';
			e.target.value = '';
		}
	}
</script>

<div class="fa-layer" aria-label="Canvas actions">
	<div class="fa-top-left">
		<button
			type="button"
			class="fa-btn"
			onclick={() => fileInput?.click()}
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

	<input
		bind:this={fileInput}
		type="file"
		accept="application/json"
		style="display: none"
		onchange={handleLoad}
	/>
</div>

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
		color: var(--color-lightness-45, #6b7280);
		background: transparent;
		border: 0;
		cursor: pointer;
		transition:
			color 0.18s ease,
			transform 0.32s ease;
	}

	.fa-btn:hover:not(:disabled) {
		color: var(--color-accent, #4d9fe3);
	}

	.fa-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.fa-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
