<script>
	// @ts-nocheck
	// Side-by-side TableProcess node. Input ports (xIN/yIN/…) sit on the left;
	// the TP's output columns render as inline rows on the right (flowtest
	// Group-style) — each with an editable name, an expandable MiniDataTable
	// preview, and a `col_<colId>` output port on the card's right edge. An
	// `all` port in the header fans out to every (or a chosen subset of) output
	// column. There is no separate data_<colId> node for TP outputs any more.
	//
	// Port-Y publishing mirrors GroupNode: we measure rendered DOM and publish
	// each port's node-local centre Y via groupPortPositions (a node-id-keyed
	// store, not Group-specific) so WorkflowEditor.getPortAnchorY anchors wires
	// on the right row even when a preview expands it.
	import { onDestroy, tick, createEventDispatcher } from 'svelte';
	import Editable from '$lib/components/reusables/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import TypeSelector from '$lib/components/reusables/TypeSelector.svelte';
	import MiniDataTable from './MiniDataTable.svelte';
	import MetricTagButton from './MetricTagButton.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { sniffTimeFormatOnTypeChange } from '$lib/utils/columnType.js';
	import { core } from '$lib/core/core.svelte.js';
	import { getNodeName, setNodeName } from '$lib/core/nodeNaming.js';
	import { normalizeYInputs } from '$lib/tableProcesses/tpArgHelpers.js';
	import NodeNoteButton from './NodeNoteButton.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { setGroupPortY, clearGroupPortPositions } from './groupPortPositions.svelte.js';

	let {
		node,
		selected = false,
		expanded = false,
		spliceTargetPort = null,
		width = null,
		// { [outputPortName]: true } for ports (col_<id>) that currently have an
		// edge. Wired metric rows stay rendered when the Metrics section is
		// collapsed so their edges keep a real port anchor.
		wiredOutPorts = null
	} = $props();

	const dispatch = createEventDispatcher();

	const HEADER_H = 26; // mirrors WorkflowEditor.HEADER_H
	const PORT_H = 22; // mirrors WorkflowEditor.PORT_H

	const tp = $derived(node.tpObj);
	// Warnings published by the TP's editor (e.g. GroupComparison's normality /
	// variance cautions). Shown as a yellow triangle next to the label.
	const warnings = $derived(Array.isArray(tp?.warnings) ? tp.warnings : []);
	const hasWarning = $derived(warnings.length > 0);
	const warningText = $derived(warnings.join('\n'));
	// Note flag: keeps the left-side note button visible whenever a note exists.
	const hasNote = $derived(!!core.nodeNotes[node.id]?.trim());
	const inputPorts = $derived(node.ports?.inputs ?? []);
	// [{ key, colId }] from ProcessNode meta, resolved to live Column instances.
	// Each entry's `port` is the output dot's port name (TP: col_<colId>; free
	// process: the producer column's producerPort, e.g. out_<inputColId>). Falls
	// back to col_<colId> for older callers.
	const outputColumns = $derived(
		(node.outputColumns ?? [])
			.map(({ key, colId, port, metric }) => ({
				key,
				colId,
				port: port ?? `col_${colId}`,
				metric: metric === true,
				col: getColumnById(colId)
			}))
			.filter((entry) => !!entry.col)
	);

	// Scalar-metric outputs (one value per y input) render in their own Metrics
	// section below the series rows; everything else is an ordinary series row.
	const seriesColumns = $derived(outputColumns.filter((c) => !c.metric));
	const metricColumns = $derived(outputColumns.filter((c) => c.metric));

	// Metrics section collapse (ephemeral UI state, like rowExpanded). Wired
	// metric rows stay rendered when collapsed so edges keep a real anchor.
	let metricsOpen = $state(true);
	const visibleMetricColumns = $derived(
		metricsOpen ? metricColumns : metricColumns.filter((c) => wiredOutPorts?.[c.port] === true)
	);

	// Per-series labels for the metric breakdown. Metric columns carry one value
	// per y input, in yIN order (the engine contract), so labels follow yIN.
	const yInputIds = $derived(normalizeYInputs(tp?.args?.yIN));
	const seriesLabels = $derived(yInputIds.map((id, i) => getColumnById(id)?.name ?? `y${i + 1}`));

	function formatMetricValue(v) {
		if (typeof v !== 'number' || !Number.isFinite(v)) return '–';
		const a = Math.abs(v);
		if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(2);
		return Number(v.toPrecision(4)).toString();
	}

	/** Inline summary next to the metric name: value, `a · b`, or `×N`. */
	function metricSummary(values) {
		if (!values.length) return '–';
		if (values.length === 1) return formatMetricValue(values[0]);
		if (values.length === 2) return values.map(formatMetricValue).join(' · ');
		return `×${values.length}`;
	}

	/** Breakdown row label: the series name when counts line up, else an index. */
	function breakdownLabel(values, i) {
		return values.length === seriesLabels.length ? seriesLabels[i] : `#${i + 1}`;
	}

	/** Default stored-value name for one metric cell, e.g. "peak_period_temp". */
	function tagDefaultName(key, values, i) {
		const base = key.replace(/^stat_/, '');
		const label = values.length === seriesLabels.length ? seriesLabels[i] : '';
		return label ? `${base}_${label}` : base;
	}

	// Bundle output ports (e.g. a Column Set's `set` port): declared on the
	// nodeSpec with a non-`column` artifact kind. They carry a set of columns down
	// one wire, so they render as a single labelled output dot with no data column
	// or preview.
	const bundleOutputs = $derived(
		(node.ports?.outputs ?? []).filter((p) => p.artifactKind && p.artifactKind !== 'column')
	);

	// Per-output-column row expansion (ephemeral UI state, keyed by colId).
	let rowExpanded = $state({});

	// Output-column rename: live on input, normalise (empty → auto name) on commit.
	function renameColumn(col, next, commit = false) {
		if (!col) return;
		if (commit) {
			const trimmed = (next ?? '').trim();
			col.customName = trimmed === '' ? null : trimmed;
		} else {
			col.customName = next ?? '';
		}
	}

	function toggleRowExpanded(colId, e) {
		e.stopPropagation();
		rowExpanded[colId] = !rowExpanded[colId];
	}

	// --- Port-position publishing ---
	let cardEl = $state();
	const inPortEls = $state({});
	const rowPortEls = $state({});
	const bundlePortEls = $state({});

	function nodeLocalCenterY(el) {
		if (!el || !cardEl) return 0;
		const elR = el.getBoundingClientRect();
		const cardR = cardEl.getBoundingClientRect();
		const cardH = cardEl.offsetHeight || cardR.height;
		const scale = cardR.height && cardH ? cardR.height / cardH : 1;
		return (elR.top + elR.height / 2 - cardR.top) / (scale || 1);
	}

	function publishPositions() {
		if (!node) return;

		for (let i = 0; i < inputPorts.length; i++) {
			const name = inputPorts[i].name;
			const el = inPortEls[name];
			if (el) setGroupPortY(node.id, name, nodeLocalCenterY(el));
			else setGroupPortY(node.id, name, HEADER_H + i * PORT_H + PORT_H / 2);
		}
		for (let i = 0; i < outputColumns.length; i++) {
			const { colId, port } = outputColumns[i];
			const el = rowPortEls[colId];
			if (el) setGroupPortY(node.id, port, nodeLocalCenterY(el));
			else setGroupPortY(node.id, port, HEADER_H + i * PORT_H + PORT_H / 2);
		}
		for (let i = 0; i < bundleOutputs.length; i++) {
			const name = bundleOutputs[i].name;
			const el = bundlePortEls[name];
			if (el) setGroupPortY(node.id, name, nodeLocalCenterY(el));
			else
				setGroupPortY(node.id, name, HEADER_H + (outputColumns.length + i) * PORT_H + PORT_H / 2);
		}
	}

	$effect(() => {
		// Re-publish on any layout-relevant change.
		void inputPorts.length;
		void outputColumns.length;
		void bundleOutputs.length;
		void metricsOpen;
		void visibleMetricColumns.length;
		const _track = outputColumns.map((c) => `${c.colId}|${rowExpanded[c.colId] ? 'e' : 'c'}`);
		void _track;
		(async () => {
			await tick();
			publishPositions();
		})();
	});

	onDestroy(() => {
		if (node) clearGroupPortPositions(node.id);
	});

	// Read-only type icon (mirrors GroupNode).
	const TYPE_ICON = {
		number: { icon: 'math', label: 'Numeric' },
		category: { icon: 'list', label: 'Category' },
		time: { icon: 'clock', label: 'Time' },
		bin: { icon: 'table', label: 'Bin' }
	};
	function typeMeta(col) {
		return TYPE_ICON[col?.type] ?? { icon: 'math', label: col?.type || 'value' };
	}

	// --- Wire events (match WorkflowNode/GroupNode semantics) ---
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
		// Shift+click disconnects. Right-click opens the column picker instead of
		// disconnecting (see openInputPicker). A plain left-press starts a REVERSE
		// wire drag (input → output).
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
	// Right-click an input port → ask the editor to open a column picker to add a
	// connection to this input.
	function openInputPicker(e, portName) {
		e.preventDefault();
		e.stopPropagation();
		dispatch('portpick', { nodeId: node.id, port: portName, x: e.clientX, y: e.clientY });
	}
	function onPortContextMenu(e) {
		e.preventDefault();
		e.stopPropagation();
	}

	function stopPointer(e) {
		e.stopPropagation();
	}

	const NO_DRAG_SELECTOR = 'button, input, textarea, .port-dot, .editable-input';

	function onCardMouseDown(e) {
		if (e.button !== 0) return;
		if (e.target?.closest?.(NO_DRAG_SELECTOR)) return;
		dispatch('cardmousedown', e);
	}
</script>

<div
	bind:this={cardEl}
	class="tp-card"
	class:selected
	class:expanded
	style={width != null ? `width:${width}px;` : ''}
	onmousedown={onCardMouseDown}
	role="button"
	tabindex="0"
>
	<div class="tp-header">
		{#if hasWarning}
			<span
				class="node-warning-badge"
				role="img"
				aria-label={`Warning: ${warningText}`}
				{@attach tooltip(warningText)}>⚠</span
			>
		{/if}
		<!-- Note button sits on the LEFT with the warning (status indicators), so it
		     doesn't shift when the collapse/delete buttons reveal on the right. Shown
		     when a note exists, or on hover/selection. -->
		<div
			class="note-slot"
			class:has-note={hasNote}
			class:sel={selected}
			onpointerdown={stopPointer}
			role="presentation"
		>
			<NodeNoteButton nodeId={node.id} />
		</div>
		<div class="tp-title" onpointerdown={stopPointer} role="presentation">
			<Editable
				value={getNodeName(node)}
				placeholder="Process"
				ariaLabel="Rename analysis"
				title="Double-click to rename"
				onInput={(v) => setNodeName(node, v)}
				onCommit={(v) => setNodeName(node, v, { commit: true })}
			/>
		</div>
		<!-- Note · collapse · delete live in the shared action cluster pinned to the
		     header's top-right by WorkflowEditor (NodeActions), not per-node. -->
	</div>

	{#if node.sublabel}
		<div class="tp-sublabel">{node.sublabel}</div>
	{/if}

	<div class="tp-body">
		<div class="tp-inputs" role="presentation">
			{#each inputPorts as port (port.name)}
				<div class="in-row">
					<button
						type="button"
						class="port-dot dot-input inline-port in-port"
						bind:this={inPortEls[port.name]}
						data-node-id={node.id}
						data-port-name={port.name}
						data-port-dir="in"
						{@attach tooltip(`Input: ${port.name}${port.dynamic ? ' (many)' : ''}`)}
						onmousedown={(e) => disconnectInput(e, port.name)}
						onmouseup={(e) => endAtInput(e, port.name)}
						oncontextmenu={(e) => openInputPicker(e, port.name)}
						aria-label={`input port ${port.name}`}
					></button>
					<span class="in-label">{port.name}{port.dynamic ? '*' : ''}</span>
				</div>
			{/each}
		</div>

		<div
			class="tp-outputs"
			onwheel={(e) => {
				if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
			}}
			role="presentation"
		>
			{#each seriesColumns as { colId, col, port } (colId)}
				{@const meta = typeMeta(col)}
				{@const isOpen = rowExpanded[colId] === true}
				<div class="out-row" class:expanded={isOpen}>
					<div class="row-strip">
						<button
							type="button"
							class="row-chev"
							aria-expanded={isOpen}
							title={isOpen ? 'Hide preview' : 'Show preview'}
							onmousedown={stopPointer}
							onclick={(e) => toggleRowExpanded(colId, e)}
						>
							<Icon name={isOpen ? 'caret-down' : 'caret-right'} width={12} height={12} />
						</button>
						<span
							class="row-type"
							title="Change type ({meta.label})"
							onpointerdown={stopPointer}
							onmousedown={stopPointer}
							role="presentation"
						>
							<TypeSelector
								bind:value={col.type}
								onChange={(t) => sniffTimeFormatOnTypeChange(col, t)}
							/>
						</span>
						<div
							class="row-name"
							onpointerdown={stopPointer}
							onmousedown={stopPointer}
							role="presentation"
						>
							<Editable
								value={col.name}
								placeholder="column"
								ariaLabel="Rename output column"
								title="Double-click to rename"
								onInput={(v) => renameColumn(col, v)}
								onCommit={(v) => renameColumn(col, v, true)}
							/>
							{#if col.groupLabel}
								<span class="group-label-chip" title="Group label: {col.groupLabel}"
									>{col.groupLabel}</span
								>
							{/if}
						</div>
						<button
							type="button"
							class="port-dot dot-output inline-port row-port"
							class:splice-target={spliceTargetPort === port}
							bind:this={rowPortEls[colId]}
							data-node-id={node.id}
							data-port-name={port}
							data-port-dir="out"
							onmousedown={(e) => startFromOutput(e, port)}
							onmouseup={(e) => endAtOutput(e, port)}
							oncontextmenu={onPortContextMenu}
							onclick={(e) => e.stopPropagation()}
							{@attach tooltip(`output: ${col.name}`)}
							aria-label={`output port ${col.name}`}
						></button>
					</div>
					{#if isOpen}
						<div class="row-body" onmousedown={stopPointer} role="presentation">
							<MiniDataTable column={col} maxRows={5} />
						</div>
					{/if}
				</div>
			{/each}
			{#if metricColumns.length > 0}
				<div class="metrics-section">
					<button
						type="button"
						class="metrics-header"
						aria-expanded={metricsOpen}
						title={metricsOpen ? 'Collapse metrics' : 'Expand metrics'}
						onmousedown={stopPointer}
						onclick={(e) => {
							e.stopPropagation();
							metricsOpen = !metricsOpen;
						}}
					>
						<Icon name={metricsOpen ? 'caret-down' : 'caret-right'} width={11} height={11} />
						<span class="metrics-title">Metrics ({metricColumns.length})</span>
						<span class="metrics-rule"></span>
					</button>
					{#each visibleMetricColumns as { key, colId, col, port } (colId)}
						{@const values = typeof col?.getData === 'function' ? (col.getData() ?? []) : []}
						{@const isOpen = rowExpanded[colId] === true}
						<div class="out-row metric-row" class:expanded={isOpen}>
							<div class="row-strip metric-strip">
								<button
									type="button"
									class="row-chev"
									aria-expanded={isOpen}
									title={isOpen ? 'Hide per-series values' : 'Show per-series values'}
									onmousedown={stopPointer}
									onclick={(e) => toggleRowExpanded(colId, e)}
								>
									<Icon name={isOpen ? 'caret-down' : 'caret-right'} width={12} height={12} />
								</button>
								<span class="metric-glyph" title="Metric: one value per y input">#</span>
								<div
									class="row-name"
									onpointerdown={stopPointer}
									onmousedown={stopPointer}
									role="presentation"
								>
									<Editable
										value={col.name}
										placeholder="metric"
										ariaLabel="Rename metric column"
										title="Double-click to rename"
										onInput={(v) => renameColumn(col, v)}
										onCommit={(v) => renameColumn(col, v, true)}
									/>
								</div>
								<span class="metric-value" title={values.map(formatMetricValue).join(', ')}>
									{metricSummary(values)}
								</span>
								<button
									type="button"
									class="port-dot dot-output inline-port row-port metric-port"
									class:splice-target={spliceTargetPort === port}
									bind:this={rowPortEls[colId]}
									data-node-id={node.id}
									data-port-name={port}
									data-port-dir="out"
									onmousedown={(e) => startFromOutput(e, port)}
									onmouseup={(e) => endAtOutput(e, port)}
									oncontextmenu={onPortContextMenu}
									onclick={(e) => e.stopPropagation()}
									{@attach tooltip(`metric output: ${col.name} (one value per y)`)}
									aria-label={`metric output port ${col.name}`}
								></button>
							</div>
							{#if isOpen}
								<div
									class="row-body metric-breakdown"
									onmousedown={stopPointer}
									role="presentation"
								>
									{#each values as v, i (i)}
										{@const byY = values.length === seriesLabels.length}
										<div class="metric-bd-row">
											<span class="bd-label">{breakdownLabel(values, i)}</span>
											<span class="bd-value">{formatMetricValue(v)}</span>
											<MetricTagButton
												{tp}
												outKey={key}
												defaultName={tagDefaultName(key, values, i)}
												yId={byY ? yInputIds[i] : null}
												index={byY ? null : i}
												source={node.label}
											/>
										</div>
									{/each}
									{#if values.length === 0}
										<div class="metric-bd-row bd-empty">no values yet</div>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
					{#if !metricsOpen && visibleMetricColumns.length < metricColumns.length}
						<div class="metrics-collapsed-hint">
							{metricColumns.length - visibleMetricColumns.length} hidden
						</div>
					{/if}
				</div>
			{/if}
			{#each bundleOutputs as bport (bport.name)}
				<div class="out-row bundle-row">
					<div class="row-strip">
						<span class="bundle-label" title="Column set output — connects to a many-in port">
							<Icon name="column-set" width={13} height={13} />
							<span>{bport.display ?? bport.name}</span>
						</span>
						<button
							type="button"
							class="port-dot dot-output inline-port row-port"
							class:splice-target={spliceTargetPort === bport.name}
							bind:this={bundlePortEls[bport.name]}
							data-node-id={node.id}
							data-port-name={bport.name}
							data-port-dir="out"
							onmousedown={(e) => startFromOutput(e, bport.name)}
							onmouseup={(e) => endAtOutput(e, bport.name)}
							oncontextmenu={onPortContextMenu}
							onclick={(e) => e.stopPropagation()}
							{@attach tooltip('column set (connects to a many-in port)')}
							aria-label={`column set output port ${bport.name}`}
						></button>
					</div>
				</div>
			{/each}
			{#if outputColumns.length === 0 && bundleOutputs.length === 0}
				<div class="empty-hint">No output columns yet.</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.tp-card {
		position: relative;
		width: 230px;
		background: var(--surface-card);
		border-radius: var(--radius-md);
		border: 1px solid rgba(0, 0, 0, 0.18);
		box-sizing: border-box;
		font-size: var(--font-sm);
		cursor: grab;
		user-select: none;
		box-shadow: var(--shadow-1);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.tp-card:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: var(--shadow-1);
	}
	.tp-card.selected {
		border-color: var(--color-accent);
		box-shadow: var(--shadow-1), var(--shadow-focus-soft);
	}
	.tp-card.expanded {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		border-bottom-color: transparent;
	}

	.tp-header {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 8px;
		height: 26px; /* HEADER_H */
		background: var(--color-lightness-97);
		border-bottom: 1px solid var(--color-lightness-90);
		border-radius: 6px 6px 0 0;
		font-weight: 600;
		color: var(--color-lightness-25);
		box-sizing: border-box;
		position: relative;
	}
	.tp-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Yellow caution triangle shown next to the label when the analysis has
	   warnings (e.g. non-normal data under a parametric test). */
	.node-warning-badge {
		flex-shrink: 0;
		font-size: var(--font-md);
		line-height: 1;
		color: #e0a800;
		cursor: help;
		user-select: none;
	}
	/* Left-side note button, always visible so the label never shifts. It reads as
	   a faint "N" until a note exists (then NodeNoteButton turns it green). */
	.note-slot {
		flex-shrink: 0;
		display: flex;
	}
	.expand-indicator {
		font-size: 9px;
		color: var(--color-text-muted);
		flex-shrink: 0;
		padding: 2px 4px;
		border: none;
		border-radius: var(--radius-xs);
		background: transparent;
		cursor: pointer;
		line-height: 1;
	}

	.expand-indicator:hover {
		color: var(--color-accent);
		background: rgba(0, 0, 0, 0.05);
	}

	.tp-sublabel {
		font-size: var(--font-2xs);
		color: #555;
		background-color: rgba(0, 0, 0, 0.04);
		border-radius: var(--radius-xs);
		padding: 1px 4px;
		margin: 4px 8px 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tp-body {
		display: grid;
		/* minmax(0, 1fr): without the 0, the outputs column's implicit
		   min-width:auto lets wide row content (e.g. a long tag chip in a metric
		   breakdown) blow the column out past the fixed-width card instead of
		   shrinking/ellipsizing. */
		grid-template-columns: minmax(54px, auto) minmax(0, 1fr);
		align-items: start;
		padding: 2px 0;
	}

	.tp-inputs {
		display: flex;
		flex-direction: column;
		border-right: 1px solid rgba(0, 0, 0, 0.06);
	}
	.in-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		height: 22px; /* PORT_H */
		padding-left: 4px;
	}
	.in-label {
		font-size: var(--font-xs);
		color: var(--color-lightness-40);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-left: var(--space-4);
	}
	.in-port {
		position: absolute;
		left: -5px;
		top: 50%;
		transform: translateY(-50%);
	}

	.tp-outputs {
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.out-row {
		position: relative;
		border-bottom: 1px solid rgba(0, 0, 0, 0.04);
	}
	.out-row:last-child {
		border-bottom: 0;
	}
	.row-strip {
		position: relative;
		display: grid;
		grid-template-columns: 14px 16px minmax(0, 1fr);
		align-items: center;
		gap: 4px;
		height: 22px; /* PORT_H */
		padding: 0 0 0 4px;
		font-size: var(--font-xs);
	}
	.row-chev {
		padding: 0;
		font-size: 0.7rem;
		background: transparent;
		border: 0;
		cursor: pointer;
		color: rgba(0, 0, 0, 0.5);
	}
	.row-chev:hover {
		color: rgba(0, 0, 0, 0.85);
	}
	.row-type {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: rgba(0, 0, 0, 0.55);
	}
	.row-name {
		min-width: 0;
		padding-right: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		color: rgba(0, 0, 0, 0.8);
	}
	.group-label-chip {
		display: inline-block;
		margin-left: 6px;
		padding: 0 5px;
		border-radius: var(--radius-lg);
		font-size: var(--font-2xs);
		font-weight: 600;
		line-height: 1.4;
		color: var(--color-accent);
		background: var(--color-accent-soft, #dbeafe);
		vertical-align: middle;
	}
	.row-body {
		padding: 4px 8px 6px 18px;
		background: rgba(0, 0, 0, 0.02);
	}

	.inline-port {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: var(--surface-card);
		border: 1px solid var(--color-lightness-50);
		cursor: crosshair;
		padding: 0;
		overflow: visible;
	}

	/* Invisible enlarged hit area so wiring doesn't require a pixel-perfect drop. */
	.inline-port::before {
		content: '';
		position: absolute;
		inset: -4px -16px;
		border-radius: var(--radius-lg);
	}
	.inline-port:hover {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}
	.inline-port.splice-target {
		background: var(--color-accent);
		border-color: var(--color-accent);
		box-shadow: var(--shadow-focus);
	}
	.row-port {
		position: absolute;
		right: -5px;
		top: 50%;
		transform: translateY(-50%);
	}
	.empty-hint {
		padding: 6px 8px;
		font-size: var(--font-xs);
		color: rgba(0, 0, 0, 0.45);
		text-align: center;
	}

	/* --- Metrics section (scalar-metric output ports) --- */
	.metrics-section {
		display: flex;
		flex-direction: column;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
	}
	.metrics-header {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 18px;
		padding: 0 8px 0 4px;
		border: 0;
		background: transparent;
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.metrics-header:hover {
		color: var(--color-lightness-25);
	}
	.metrics-title {
		font-size: var(--font-2xs);
		font-weight: 600;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}
	.metrics-rule {
		flex: 1;
		border-top: 1px solid rgba(0, 0, 0, 0.06);
	}
	/* Metric rows are denser: no TypeSelector (metrics are always numbers), a
	   right-aligned live value instead. */
	.metric-strip {
		grid-template-columns: 14px 12px minmax(0, 1fr) auto;
		padding-right: 12px;
	}
	.metric-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-2xs);
		font-weight: 700;
		color: rgba(0, 0, 0, 0.45);
		user-select: none;
	}
	.metric-value {
		font-family: var(--font-mono, ui-monospace, SF Mono, monospace);
		font-size: var(--font-2xs);
		color: var(--color-lightness-35);
		white-space: nowrap;
		text-align: right;
	}
	/* Metric port dot: a "target" (ring + centre point) so wireable metrics read
	   differently from series dots while acting identically. */
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
	.metric-breakdown {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: var(--font-2xs);
	}
	/* Shrink priority when the row is tight: label ellipsizes first, then the
	   tag chip (down to a clickable stub); the VALUE never shrinks. overflow:
	   hidden is the last-resort clip so nothing escapes the card. */
	.metric-bd-row {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 16px;
		overflow: hidden;
	}
	.bd-label {
		flex: 1 1 auto;
		min-width: 20px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-lightness-40);
	}
	.bd-value {
		flex-shrink: 0;
		font-family: var(--font-mono, ui-monospace, SF Mono, monospace);
		color: var(--color-lightness-25);
		white-space: nowrap;
	}
	.bd-empty {
		font-style: italic;
		color: var(--color-text-muted);
	}
	.metrics-collapsed-hint {
		padding: 0 8px 4px 22px;
		font-size: var(--font-2xs);
		color: var(--color-text-muted);
	}

	/* Bundle output row (Column Set `set` port): a labelled output dot, no data
	   column / type / preview. */
	.bundle-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1 1 auto;
		padding-left: 4px;
		font-size: var(--font-xs);
		font-weight: 600;
		color: var(--color-accent);
	}
</style>
