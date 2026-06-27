<script>
	// @ts-nocheck
	// One operation node (free process or free table-process) as a Data Sources
	// panel entry: editable name, a read-only list of input column(s), and its
	// output columns rendered as normal column rows. Mirrors the canvas node /
	// Control Panel so a node looks the same everywhere. Rewiring stays on the
	// canvas / Control Panel — inputs here are display-only.
	import { core, appState, deleteOperationNode } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getNodeName, setNodeName } from '$lib/core/nodeNaming.js';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';

	let { node } = $props();

	// Input column(s) feeding the node, resolved to live Column instances.
	const inputCols = $derived.by(() => {
		if (node.type === 'process') {
			const raw = node.processObj?.args?.inIN;
			const ids = Array.isArray(raw) ? raw : raw != null && raw >= 0 ? [raw] : [];
			return ids.map(getColumnById).filter(Boolean);
		}
		// table-process: any arg whose key ends in "IN" (xIN, yIN, …).
		const out = [];
		const seen = new Set();
		for (const [k, v] of Object.entries(node.tpObj?.args ?? {})) {
			if (!k.endsWith('IN')) continue;
			const ids = Array.isArray(v) ? v : [v];
			for (const id of ids) {
				if (typeof id !== 'number' || id < 0 || seen.has(id)) continue;
				const c = getColumnById(id);
				if (c) {
					seen.add(id);
					out.push(c);
				}
			}
		}
		return out;
	});

	// Output columns (producer columns for a process; args.out columns for a TP).
	const outputCols = $derived(
		(node.outputColumns ?? []).map((o) => getColumnById(o.colId)).filter(Boolean)
	);

	function findSelect() {
		appState.canvasSelectedNodeId = node.id;
		appState.focusNodeRequest = { id: node.id, n: (appState.focusNodeRequest?.n ?? 0) + 1 };
		appState.view = 'canvas';
		appState.showControlPanel = true;
	}

	function deleteNode() {
		appState.AYStext = `Are you sure you want to remove ${getNodeName(node)}?`;
		appState.AYScallback = (option) => {
			if (option === 'Yes') deleteOperationNode(node);
		};
		appState.showAYSModal = true;
	}
</script>

<div class="node-item">
	<div class="node-head">
		<p class="node-name"><Editable
				value={getNodeName(node)}
				onInput={(v) => setNodeName(node, v)}
				onCommit={(v) => setNodeName(node, v, { commit: true })}
			/></p>
		<div class="node-head-btns">
			<button
				class="icon node-action-btn"
				title="Find on canvas / edit in panel"
				onclick={(e) => {
					e.stopPropagation();
					findSelect();
				}}
			>
				<Icon name="process" width={15} height={15} className="menu-icon" />
			</button>
			<button
				class="icon node-action-btn"
				title="Delete node"
				onclick={(e) => {
					e.stopPropagation();
					deleteNode();
				}}
			>
				<Icon name="trash" width={15} height={15} className="menu-icon" />
			</button>
		</div>
	</div>

	{#if inputCols.length > 0}
		<div class="node-inputs" title="Inputs (edit wiring on the canvas)">
			<span class="in-label">in:</span>
			{inputCols.map((c) => c.name).join(', ')}
		</div>
	{/if}

	<div class="node-outputs">
		{#each outputCols as col (col.id)}
			<div class="node-output-row"><ColumnComponent {col} /></div>
		{:else}
			<div class="node-empty">No outputs — wire an input on the canvas.</div>
		{/each}
	</div>
</div>

<style>
	.node-item {
		border: 1px solid var(--color-lightness-88, #e2e2e2);
		border-radius: 5px;
		margin: 4px 0;
		background: var(--color-lightness-99, #fcfcfc);
	}
	.node-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: 3px 4px 3px 6px;
		border-bottom: 1px solid var(--color-lightness-92, #ededed);
		background: var(--color-lightness-96, #f3f3f3);
		border-radius: 5px 5px 0 0;
	}
	.node-name {
		margin: 0;
		font-weight: 600;
		font-size: var(--font-md);
		min-width: 0;
		overflow: hidden;
	}
	/* Find + delete, right-aligned, revealed on hover. */
	.node-head-btns {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}
	.node-action-btn {
		opacity: 0;
		transition: opacity 0.12s ease;
		flex-shrink: 0;
	}
	.node-item:hover .node-action-btn,
	.node-action-btn:focus-visible {
		opacity: 1;
	}
	.node-inputs {
		font-size: 11.5px;
		color: var(--color-text-muted, #666);
		padding: 3px 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.in-label {
		font-weight: 600;
		opacity: 0.7;
		margin-right: 2px;
	}
	.node-outputs {
		padding: 2px 4px 4px;
	}
	.node-empty {
		font-size: 11.5px;
		color: var(--color-text-muted, #666);
		padding: 4px 6px;
	}
</style>
