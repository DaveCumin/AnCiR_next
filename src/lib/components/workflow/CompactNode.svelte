<script>
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import {
		COMPACT_W,
		compactNodeHeight,
		compactPortAnchorY,
		columnTypeIcon
	} from './nodeGeometry.js';

	let { node, selected = false, spliceTargetPort = null } = $props();
	const dispatch = createEventDispatcher();

	let inputs = $derived(node.ports?.inputs ?? []);
	let outputs = $derived(node.ports?.outputs ?? []);
	let height = $derived(compactNodeHeight(inputs.length, outputs.length));

	// Warnings published by a TP's editor (e.g. GroupComparison normality caution).
	// Shown as a yellow border on the collapsed square; details in the tooltip.
	let warnings = $derived(Array.isArray(node.tpObj?.warnings) ? node.tpObj.warnings : []);
	let hasWarning = $derived(warnings.length > 0);

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

	const dotTop = (slot, count) => compactPortAnchorY(slot, count, height) - 6.5; // dot is 13px

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
		// Shift+click disconnects. Right-click opens the column picker via
		// onContextMenu. A plain left-press starts a REVERSE wire drag.
		if (!e.shiftKey) {
			if (e.button === 0) {
				e.preventDefault();
				dispatch('portstart', { nodeId: node.id, port: portName, direction: 'in' });
			}
			return;
		}
		e.preventDefault();
		dispatch('portdisconnect', { nodeId: node.id, port: portName, direction: 'in' });
	}
	// Complete a reverse drag on an output dot (mirror of endAtInput).
	function endAtOutput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portend', { nodeId: node.id, port: portName, direction: 'out' });
	}
	// Right-click an input port → ask the editor to open a column picker so the
	// user can add a connection to this input (replaces destructive right-click
	// disconnect).
	function openInputPicker(e, portName) {
		e.preventDefault();
		e.stopPropagation();
		dispatch('portpick', { nodeId: node.id, port: portName, x: e.clientX, y: e.clientY });
	}
</script>

<div
	class="compact-node"
	class:selected
	class:has-warning={hasWarning}
	style="width:{COMPACT_W}px; height:{height}px;"
	role="button"
	tabindex="0"
	{@attach tooltip(
		hasWarning ? `${node.label ?? ''}\n⚠ ${warnings.join('\n')}` : (node.label ?? '')
	)}
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
			oncontextmenu={(e) => openInputPicker(e, port.name)}
			role="button"
			tabindex="-1"
		></div>
	{/each}
	{#each outputs as port, i (`out_${port.name}_${i}`)}
		<div
			class="port-dot dot-output"
			class:metric-port={port.metric === true}
			class:splice-target={spliceTargetPort === port.name}
			style="top:{dotTop(i, outputs.length)}px;"
			data-node-id={node.id}
			data-port-name={port.name}
			data-port-dir="out"
			{@attach tooltip(portTip(port))}
			onmousedown={(e) => startFromOutput(e, port.name)}
			onmouseup={(e) => endAtOutput(e, port.name)}
			role="button"
			tabindex="-1"
		></div>
	{/each}
</div>

<style>
	.compact-node {
		position: relative;
		border-radius: var(--radius-lg);
		border: 1px solid rgba(0, 0, 0, 0.18);
		background: var(--surface-card);
		cursor: grab;
		user-select: none;
		box-sizing: border-box;
		box-shadow: var(--shadow-1);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.compact-node:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: var(--shadow-1);
	}
	.compact-node.selected {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-1), var(--shadow-focus-soft);
	}
	/* Analysis has warnings (e.g. non-normal data under a parametric test). The
	   yellow border survives selection so the caution stays visible. */
	.compact-node.has-warning {
		border-color: #e0a800;
		box-shadow:
			var(--shadow-1),
			0 0 0 2px rgba(224, 168, 0, 0.4);
	}
	.compact-icon {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-lightness-35);
		pointer-events: none;
	}
	/* Port dots — mirror WorkflowNode.svelte so wiring/handlers behave identically. */
	.port-dot {
		position: absolute;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-50);
		cursor: crosshair;
		padding: 0;
		overflow: visible;
		pointer-events: auto;
	}
	.port-dot::before {
		content: '';
		position: absolute;
		inset: -2px -16px;
		border-radius: var(--radius-lg);
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
		background: var(--color-accent);
		border-color: var(--color-accent);
	}
	.port-dot.splice-target {
		background: var(--color-accent);
		border-color: var(--color-accent);
		box-shadow: var(--shadow-focus);
	}
	/* Metric port dot: "target" ring + centre point (mirrors TableProcessNode). */
	.metric-port::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-lightness-50);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}
	.metric-port:hover::after,
	.metric-port.splice-target::after {
		background: var(--surface-card);
	}
</style>
