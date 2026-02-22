<script>
	// @ts-nocheck
	let { node, selected = false, onclick } = $props();

	const typeColors = {
		data: '#b3d9f2',
		process: '#fffacc',
		tableprocess: '#ffe0b3',
		plot: '#b3f2cc'
	};
</script>

<div
	class="workflow-node"
	class:selected
	style="background-color: {typeColors[node.type] ?? '#eee'};"
	onclick={onclick}
	role="button"
	tabindex="0"
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onclick?.(e)}
>
	<div class="node-label">{node.label}</div>
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
		cursor: pointer;
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

	.node-label {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
