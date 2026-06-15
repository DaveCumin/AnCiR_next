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
			title="Load a session"
			aria-label="Load session"
		>
			<Icon name="sessionload" width={24} height={24} />
		</button>
		<button
			type="button"
			class="fa-btn"
			onclick={exportJson}
			title="Save this session"
			aria-label="Save session"
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
			title={`Undo (Cmd/Ctrl+Z)${history.canUndo ? ` — ${history.undoCount} step${history.undoCount > 1 ? 's' : ''}` : ''}`}
			aria-label="Undo"
		>
			<Icon name="undo" width={22} height={22} />
		</button>
		<button
			type="button"
			class="fa-btn"
			onclick={() => history.redo()}
			disabled={!history.canRedo}
			title={`Redo (Cmd/Ctrl+Shift+Z)${history.canRedo ? ` — ${history.redoCount} step${history.redoCount > 1 ? 's' : ''}` : ''}`}
			aria-label="Redo"
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

	.fa-btn {
		width: 38px;
		height: 38px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid var(--color-lightness-85, #e6e6e6);
		border-radius: 8px;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			opacity 0.12s ease;
		padding: 0;
	}

	.fa-btn:hover:not(:disabled) {
		background: #fff;
		border-color: var(--color-lightness-70, #c5c5c5);
		color: var(--color-lightness-20, #333);
	}

	.fa-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
