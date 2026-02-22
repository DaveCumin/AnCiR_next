<script>
	// @ts-nocheck
	let { node, selected = false, expanded = false } = $props();

	const typeColors = {
		data: '#b3d9f2',
		process: '#fffacc',
		tableprocess: '#ffe0b3',
		plot: '#b3f2cc'
	};

	const isEditable = node.type === 'process' || node.type === 'tableprocess';
	// Plot nodes always have a preview panel below, so apply the expanded border style
	const hasPanel = node.type === 'plot' || expanded;
</script>

<div
	class="workflow-node"
	class:selected
	class:expanded={hasPanel}
	style="background-color: {typeColors[node.type] ?? '#eee'};"
	role="button"
	tabindex="0"
>
	<div class="node-header">
		<div class="node-label">{node.label}</div>
		{#if isEditable}
			<span class="expand-indicator" title={expanded ? 'Collapse' : 'Expand to edit'}>
				{expanded ? '▲' : '▼'}
			</span>
		{/if}
	</div>
	{#if node.sublabel}
		<div class="node-sublabel">{node.sublabel}</div>
	{/if}
</div>

<style>
	.workflow-node {
		width: 160px;
		min-height: 48px;
		border-radius: 6px;
		border: 1.5px solid rgba(0, 0, 0, 0.15);
		padding: 6px 10px;
		cursor: grab;
		user-select: none;
		box-sizing: border-box;
		font-size: 12px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		transition: border-color 0.1s;
	}

	.workflow-node:hover {
		border-color: rgba(0, 0, 0, 0.3);
	}

	.workflow-node.selected {
		border: 2px solid #0275ff;
		box-shadow: 0 0 0 2px rgba(2, 117, 255, 0.2);
	}

	.workflow-node.expanded {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		border-bottom-color: transparent;
	}

	.node-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
	}

	.node-label {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	.expand-indicator {
		font-size: 9px;
		color: #666;
		flex-shrink: 0;
	}

	.node-sublabel {
		font-size: 10px;
		color: #555;
		background-color: rgba(0, 0, 0, 0.08);
		border-radius: 3px;
		padding: 1px 4px;
		display: inline-block;
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
</style>
