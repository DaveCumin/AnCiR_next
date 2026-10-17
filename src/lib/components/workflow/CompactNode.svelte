<script>
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { processNodeWarnings } from '$lib/core/processWarnings.js';
	import {
		COMPACT_W,
		compactNodeHeight,
		compactPortAnchorY,
		columnTypeIcon
	} from './nodeGeometry.js';
	import { NODE_CARD_BORDER, PORT_DOT, NODE_ROW_CSS_VARS } from './nodeRows.js';
	import { portTooltip, portAriaLabel, portLabel } from './portLabels.js';
	import { PORT_KEYS_HELP_ID } from './keyboardWiring.js';
	import { getNodeName } from '$lib/core/nodeNaming.js';

	let { node, selected = false, spliceTargetPort = null } = $props();
	const dispatch = createEventDispatcher();

	let inputs = $derived(node.ports?.inputs ?? []);
	let outputs = $derived(node.ports?.outputs ?? []);
	let height = $derived(compactNodeHeight(inputs.length, outputs.length));

	// Warnings published by a TP's editor (e.g. GroupComparison normality caution),
	// plus render-derived column-process warnings (processWarnings.js — e.g.
	// RemoveTrend's fit-domain refusals). Shown as a yellow border on the
	// collapsed square; details in the tooltip.
	let warnings = $derived([
		...(Array.isArray(node.tpObj?.warnings) ? node.tpObj.warnings : []),
		...processNodeWarnings(node.processObj)
	]);
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

	// compactPortAnchorY is measured from the square's outer top (where WorkflowEditor ends the
	// wires); the dots are positioned inside its border, so step back over it and half a dot.
	const dotTop = (slot, count) =>
		compactPortAnchorY(slot, count, height) - NODE_CARD_BORDER - PORT_DOT / 2;

	// Tooltip and accessible name (portLabels.js). The square shows no labels, so the
	// tooltip leads with the node's name; per-column ports (col_<id>) show the column's name.
	const colName = (id) => getColumnById(id)?.name;
	let nodeName = $derived(getNodeName(node) || node.label || '');
	const portTip = (port, dir) =>
		portTooltip(port, dir, { label: portLabel(port, colName), nodeName });
	const portName = (port, dir) =>
		portAriaLabel(nodeName, port, dir, { label: portLabel(port, colName) });

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
	style="{NODE_ROW_CSS_VARS} width:{COMPACT_W}px; height:{height}px;"
	role="button"
	tabindex="0"
	aria-label={nodeName}
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
			{@attach tooltip(portTip(port, 'in'))}
			aria-label={portName(port, 'in')}
			aria-describedby={PORT_KEYS_HELP_ID}
			onpointerdown={(e) => e.stopPropagation()}
			onmousedown={(e) => disconnectInput(e, port.name)}
			onmouseup={(e) => endAtInput(e, port.name)}
			oncontextmenu={(e) => openInputPicker(e, port.name)}
			role="button"
			tabindex="0"
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
			{@attach tooltip(portTip(port, 'out'))}
			aria-label={portName(port, 'out')}
			aria-describedby={PORT_KEYS_HELP_ID}
			onpointerdown={(e) => e.stopPropagation()}
			onmousedown={(e) => startFromOutput(e, port.name)}
			onmouseup={(e) => endAtOutput(e, port.name)}
			role="button"
			tabindex="0"
		></div>
	{/each}
</div>

<style>
	.compact-node {
		position: relative;
		border-radius: var(--radius-lg);
		border: var(--node-card-border) solid rgba(0, 0, 0, 0.18);
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
	/* Port dots: mirror WorkflowNode.svelte so wiring/handlers behave identically, and take
	   their size from nodeRows.js (NODE_ROW_CSS_VARS on the square). */
	.port-dot {
		position: absolute;
		width: var(--port-dot);
		height: var(--port-dot);
		box-sizing: border-box;
		border-radius: 50%;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-50);
		cursor: crosshair;
		padding: 0;
		overflow: visible;
		pointer-events: auto;
	}
	/* Invisible hit area: one port step (24 px) tall, so it meets the next port's and never
	   overlaps it (WCAG 2.2 SC 2.5.8), as on a detailed card. Wider than tall. */
	.port-dot::before {
		content: '';
		position: absolute;
		inset: calc((var(--node-row-h) - var(--port-dot)) / -2) -16px;
		border-radius: var(--radius-lg);
	}
	/* Centred on the square's outer edge, where WorkflowEditor ends the wires (as on a
	   detailed card). */
	.port-dot.dot-input {
		left: calc(-1 * (var(--node-card-border) + var(--port-dot) / 2));
	}
	.port-dot.dot-output {
		right: calc(-1 * (var(--node-card-border) + var(--port-dot) / 2));
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
