<script>
	// @ts-nocheck
	// Floating align / distribute / (optional) grid toolbar shown when 2+ items
	// are selected on a canvas. Presentational only — the parent supplies the
	// geometry callbacks. Shared by the workflow canvas (nodes) and the worksheet
	// (plots) so the controls look and behave identically in both views.
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';

	let {
		onAlign,
		onDistribute,
		onGrid = null,
		showGrid = false,
		canDistribute = true,
		showAlign = true,
		onCombine = null,
		onUncombine = null,
		canCombine = false,
		canUncombine = false
	} = $props();

	const aligns = [
		{ mode: 'left', icon: 'align-left', label: 'Align left edges' },
		{ mode: 'hcenter', icon: 'align-centre', label: 'Align horizontal centres' },
		{ mode: 'right', icon: 'align-right', label: 'Align right edges' },
		{ mode: 'top', icon: 'align-top', label: 'Align top edges' },
		{ mode: 'vcenter', icon: 'align-middle', label: 'Align vertical centres' },
		{ mode: 'bottom', icon: 'align-bottom', label: 'Align bottom edges' }
	];
</script>

<div class="layout-toolbar" role="toolbar" aria-label="Align and arrange selection">
	{#if showAlign}
		{#each aligns as a (a.mode)}
			<button
				type="button"
				class="lt-btn"
				onclick={(e) => {
					e.stopPropagation();
					onAlign?.(a.mode);
				}}
				aria-label={a.label}
				{@attach tooltip(a.label)}
			>
				<Icon name={a.icon} width={18} height={18} />
			</button>
		{/each}

		<span class="lt-sep" aria-hidden="true"></span>

		<button
			type="button"
			class="lt-btn"
			disabled={!canDistribute}
			onclick={(e) => {
				e.stopPropagation();
				onDistribute?.('h');
			}}
			aria-label="Distribute horizontally"
			{@attach tooltip('Distribute horizontally (equal gaps)')}
		>
			<Icon name="distribute-horizontal" width={18} height={18} />
		</button>
		<button
			type="button"
			class="lt-btn"
			disabled={!canDistribute}
			onclick={(e) => {
				e.stopPropagation();
				onDistribute?.('v');
			}}
			aria-label="Distribute vertically"
			{@attach tooltip('Distribute vertically (equal gaps)')}
		>
			<Icon name="distribute-vertical" width={18} height={18} />
		</button>

		{#if onGrid && showGrid}
			<span class="lt-sep" aria-hidden="true"></span>
			<button
				type="button"
				class="lt-btn"
				onclick={(e) => {
					e.stopPropagation();
					onGrid?.();
				}}
				aria-label="Arrange in a grid"
				{@attach tooltip('Arrange selection in a grid')}
			>
				<Icon name="table" width={18} height={18} />
			</button>
		{/if}
	{/if}

	{#if onCombine || onUncombine}
		{#if showAlign}<span class="lt-sep" aria-hidden="true"></span>{/if}
		{#if onCombine}
			<button
				type="button"
				class="lt-btn"
				disabled={!canCombine}
				onclick={(e) => {
					e.stopPropagation();
					onCombine?.();
				}}
				aria-label="Combine into composite"
				{@attach tooltip('Combine into a composite (Cmd/Ctrl+G)')}
			>
				<Icon name="collect-columns" width={18} height={18} />
			</button>
		{/if}
		{#if onUncombine}
			<button
				type="button"
				class="lt-btn"
				disabled={!canUncombine}
				onclick={(e) => {
					e.stopPropagation();
					onUncombine?.();
				}}
				aria-label="Uncombine composite"
				{@attach tooltip('Uncombine (Cmd/Ctrl+Shift+G)')}
			>
				<Icon name="split" width={18} height={18} />
			</button>
		{/if}
	{/if}
</div>

<style>
	.layout-toolbar {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 2px;
		padding: 4px 6px;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		pointer-events: auto;
	}

	.lt-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 5px;
		background: transparent;
		color: var(--color-lightness-35);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.lt-btn:hover:not(:disabled) {
		background: var(--color-lightness-95);
		color: var(--color-accent);
	}

	.lt-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.lt-sep {
		width: 1px;
		align-self: stretch;
		margin: 2px 3px;
		background: var(--color-lightness-90);
	}
</style>
