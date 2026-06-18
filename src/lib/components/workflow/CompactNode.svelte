<script>
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { COMPACT_W, compactNodeHeight, compactPortAnchorY, columnTypeIcon } from './nodeGeometry.js';

	let { node, selected = false, spliceTargetPort = null } = $props();
	const dispatch = createEventDispatcher();

	let inputs = $derived(node.ports?.inputs ?? []);
	let outputs = $derived(node.ports?.outputs ?? []);
	let height = $derived(compactNodeHeight(inputs.length, outputs.length));

	// Icon name by kind, falling back to a neutral glyph.
	let iconName = $derived.by(() => {
		if (node.type === 'data') {
			const col = node.refId != null ? getColumnById(node.refId) : null;
			return columnTypeIcon(col?.type);
		}
		if (node.type === 'process')
			return appConsts.processMap?.get(node.processName)?.nodeIcon || 'gear';
		if (node.type === 'tableprocess')
			return appConsts.tableProcessMap?.get(node.tpName)?.nodeIcon || 'gear';
		if (node.type === 'plot') return appConsts.plotMap?.get(node.plotObj?.type)?.nodeIcon || 'gear';
		if (node.type === 'group') return 'layer';
		if (node.type === 'composite') return 'collect-columns';
		return 'gear';
	});

	const dotTop = (slot, count) => compactPortAnchorY(slot, count, height) - 5; // dot is 10px

	// Hover tooltip: "<node name> — <port>". For per-column ports (col_<id>, used
	// by groups and table-process outputs) resolve the friendly column name.
	function portTip(port) {
		// Prefer a friendly display label (composite interface ports carry one);
		// otherwise resolve col_<id> ports to the column's name.
		let label = port.display ?? port.name;
		if (typeof label === 'string' && label.startsWith('col_')) {
			const col = getColumnById(Number(label.slice(4)));
			if (col?.name) label = col.name;
		}
		return `${node.label} — ${label}${port.dynamic ? ' (many)' : ''}`;
	}

	function startFromOutput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portstart', { nodeId: node.id, port: portName, direction: 'out' });
	}
	function endAtInput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portend', { nodeId: node.id, port: portName, direction: 'in' });
	}
	function disconnectInput(e, portName) {
		e.stopPropagation();
		if (!e.shiftKey && e.button !== 2) return;
		e.preventDefault();
		dispatch('portdisconnect', { nodeId: node.id, port: portName, direction: 'in' });
	}
</script>

<div
	class="compact-node"
	class:selected
	style="width:{COMPACT_W}px; height:{height}px;"
	role="button"
	tabindex="0"
	{@attach tooltip(node.label ?? '')}
>
	<span class="compact-icon"><Icon name={iconName} width={22} height={22} /></span>

	{#each inputs as port, i (`in_${port.name}_${i}`)}
		<div
			class="port-dot dot-input"
			style="top:{dotTop(i, inputs.length)}px;"
			data-node-id={node.id}
			data-port-name={port.name}
			data-port-dir="in"
			{@attach tooltip(portTip(port))}
			onmousedown={(e) => disconnectInput(e, port.name)}
			onmouseup={(e) => endAtInput(e, port.name)}
			oncontextmenu={(e) => disconnectInput(e, port.name)}
			role="button"
			tabindex="-1"
		></div>
	{/each}
	{#each outputs as port, i (`out_${port.name}_${i}`)}
		<div
			class="port-dot dot-output"
			class:splice-target={spliceTargetPort === port.name}
			style="top:{dotTop(i, outputs.length)}px;"
			data-node-id={node.id}
			data-port-name={port.name}
			data-port-dir="out"
			{@attach tooltip(portTip(port))}
			onmousedown={(e) => startFromOutput(e, port.name)}
			role="button"
			tabindex="-1"
		></div>
	{/each}
</div>

<style>
	.compact-node {
		position: relative;
		border-radius: 8px;
		border: 1px solid rgba(0, 0, 0, 0.18);
		background: #ffffff;
		cursor: grab;
		user-select: none;
		box-sizing: border-box;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.compact-node:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
	}
	.compact-node.selected {
		border-color: var(--color-accent, #4d9fe3);
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.08),
			0 0 0 2px rgba(77, 159, 227, 0.28);
	}
	.compact-icon {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-lightness-35, #555);
		pointer-events: none;
	}
	/* Port dots — mirror WorkflowNode.svelte so wiring/handlers behave identically. */
	.port-dot {
		position: absolute;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--color-lightness-95, #ececec);
		border: 1px solid var(--color-lightness-60, #8a8a8a);
		cursor: crosshair;
		padding: 0;
		overflow: visible;
		pointer-events: auto;
	}
	.port-dot::before {
		content: '';
		position: absolute;
		inset: -6px -10px;
		border-radius: 8px;
	}
	/* Sit just outside the edge (dot touches the border) so the port reads as
	   attached to the small square rather than floating away from it. */
	.port-dot.dot-input {
		left: 0;
		transform: translateX(-100%);
	}
	.port-dot.dot-output {
		right: 0;
		transform: translateX(100%);
	}
	.port-dot:hover {
		background: var(--color-accent, #4d9fe3);
		border-color: var(--color-accent, #4d9fe3);
	}
	.port-dot.splice-target {
		background: var(--color-accent, #4d9fe3);
		border-color: var(--color-accent, #4d9fe3);
		box-shadow: 0 0 0 4px rgba(77, 159, 227, 0.35);
	}
</style>
