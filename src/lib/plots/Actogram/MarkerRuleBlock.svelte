<script>
	// @ts-nocheck
	// One marker rule's controls in the actogram's Data tab (plan 2026-09-30 actogram marker
	// rules, 3.1). Every setting commits through setRuleSettings, i.e. the in-place
	// `setMarkerRule` op: one committed value is one undo step, nothing is rebuilt, and only
	// this rule's instances recompute. Numbers commit on `change`, not `input`.
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { instanceSummary, seedFixedValue } from './markerRules.svelte.js';
	import { tauReadout } from './tauReadout.js';
	import { RULE_STAT_LABEL } from '$lib/plots/plotMetricDefs.js';
	import { setRuleSettings, removeRuleRecorded } from './markerRuleActions.js';
	import { ruleBlockDomId } from './ruleDom.js';
	import { TEMPLATE_METHOD_NOTE } from './markerMethod.js';

	let { inner, rule, unitLabel = 'series' } = $props();

	let nameRev = $state(0);
	let nameError = $state('');

	function commit(patch) {
		return setRuleSettings(inner, rule, patch);
	}

	function rename(v) {
		const name = typeof v === 'string' ? v.trim() : '';
		if (name === rule.name) return;
		if (!commit({ name })) {
			nameError = name ? `"${name}" is already a rule on this plot` : 'A rule needs a name';
			nameRev++;
			return;
		}
		nameError = '';
	}

	/** A committed number from a change event: a finite number, null (empty), or undefined. */
	function readNumber(e, { integer = false } = {}) {
		const raw = e.currentTarget.value;
		if (raw === '') return null;
		const n = integer ? parseInt(raw, 10) : parseFloat(raw);
		return Number.isFinite(n) ? n : undefined;
	}

	function setNumber(key, e, opts) {
		const v = readNumber(e, opts);
		if (v === undefined || (v === null && !opts?.nullable)) {
			e.currentTarget.value = rule[key] ?? '';
			return;
		}
		commit({ [key]: v });
	}

	// Flipping a lock to Fixed seeds the fixed value from the median of the lines as drawn
	// on the series (plan Q4), so the lines do not jump.
	function setLock(param, mode) {
		if (param === 'tau') {
			commit(
				mode === 'fixed'
					? { lockTau: 'fixed', fixedTau: seedFixedValue(inner, rule, 'tau') }
					: { lockTau: 'fit' }
			);
		} else {
			commit(
				mode === 'fixed'
					? { lockTheta: 'fixed', fixedTheta: seedFixedValue(inner, rule, 'theta') }
					: { lockTheta: 'fit' }
			);
		}
	}

	// The per-series rows: the instance, or the series' detached block for this rule.
	const rows = $derived(
		inner.data.map((d) => {
			const inst = d.ruleInstances.find((i) => i.ruleId === rule.id);
			const block = inst ? null : d.phaseMarkers.find((m) => m.fromRule === rule.id);
			const source = inst ?? block;
			const s = source ? instanceSummary(source) : null;
			// τ is the port's value (the harmonic check's pick); the slope is shown beside it.
			const t = source ? tauReadout(source) : null;
			const status = !inst ? 'detached' : s && Number.isFinite(s.tau) ? 'rule' : 'no fit';
			return { label: d.displayLabel, colour: d.colour, s, t, status };
		})
	);
	const nDetached = $derived(rows.filter((r) => r.status === 'detached').length);
	const nSeries = $derived(inner.data.length);
	const appliesNote = $derived(
		nDetached === 0
			? `Applies to all ${nSeries} ${unitLabel}`
			: `${nSeries - nDetached} of ${nSeries} ${unitLabel}; ${nDetached} detached`
	);

	const fmt = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '–');
</script>

<div class="rule-block" id={ruleBlockDomId(inner, rule.id)} data-rule-id={rule.id}>
	<div class="control-component-title">
		<div class="control-component-title-colour">
			{#key rule.name + ':' + nameRev}
				<p><Editable value={rule.name} onCommit={(v) => rename(v)} /></p>
			{/key}
		</div>
		<div class="control-component-title-icons">
			<button
				class="icon"
				aria-label="Remove this rule"
				onclick={() => removeRuleRecorded(inner, rule)}
				{@attach tooltip('Remove this rule from every ' + unitLabel)}
			>
				<Icon name="trash" width={16} height={16} className="control-component-title-icon" />
			</button>
		</div>
	</div>
	{#if nameError}<p class="rule-error">{nameError}</p>{/if}
	<p class="rule-note">{appliesNote}</p>

	<ControlInput label="Type">
		<select value={rule.type} onchange={(e) => commit({ type: e.currentTarget.value })}>
			<option value="onset">Onset</option>
			<option value="offset">Offset</option>
			<option value="manual">Line only (hand-placed)</option>
		</select>
	</ControlInput>

	{#if rule.type !== 'manual'}
		<div class="control-input-horizontal">
			{#each [['N', 'templateHrsBefore'], ['M', 'templateHrsAfter'], ['%', 'centileThreshold']] as [label, key] (key)}
				<ControlInput {label}>
					<input
						type="number"
						class="rule-num"
						min="0"
						max="100"
						value={rule[key]}
						onchange={(e) => setNumber(key, e)}
					/>
				</ControlInput>
			{/each}
		</div>
		<p class="rule-note">{TEMPLATE_METHOD_NOTE}</p>
	{:else}
		<p class="rule-note">
			Place points on each series with "Add markers" under that series' Markers and lines.
		</p>
	{/if}

	<div class="lock-block">
		<p class="lock-title">Line fit</p>
		{#each [{ key: 'tau', label: 'τ (hrs)', mode: rule.lockTau, value: rule.fixedTau, field: 'fixedTau' }, { key: 'theta', label: 'θ (hrs)', mode: rule.lockTheta, value: rule.fixedTheta, field: 'fixedTheta' }] as param (param.key)}
			<div class="lock-row">
				<span class="lock-label">{param.label}</span>
				<div class="segmented" role="radiogroup" aria-label={param.label}>
					<label class:active={param.mode === 'fit'}>
						<input
							type="radio"
							name={'rule-lock-' + param.key + '-' + rule.id}
							value="fit"
							checked={param.mode === 'fit'}
							onchange={() => setLock(param.key, 'fit')}
						/>
						Fit
					</label>
					<label class:active={param.mode === 'fixed'}>
						<input
							type="radio"
							name={'rule-lock-' + param.key + '-' + rule.id}
							value="fixed"
							checked={param.mode === 'fixed'}
							onchange={() => setLock(param.key, 'fixed')}
						/>
						Fixed
					</label>
				</div>
				<input
					type="number"
					class="rule-num"
					step="0.05"
					disabled={param.mode !== 'fixed'}
					value={param.mode === 'fixed' && Number.isFinite(param.value)
						? param.value.toFixed(3)
						: ''}
					onchange={(e) => setNumber(param.field, e)}
				/>
			</div>
		{/each}
	</div>

	<div class="control-input-horizontal">
		<ControlInput label="Min day">
			<input
				type="number"
				class="rule-num"
				min="1"
				max={inner.Ndays}
				step="1"
				placeholder="1"
				value={rule.lineMinDay ?? ''}
				onchange={(e) => setNumber('lineMinDay', e, { integer: true, nullable: true })}
			/>
		</ControlInput>
		<ControlInput label="Max day">
			<input
				type="number"
				class="rule-num"
				min="1"
				max={inner.Ndays}
				step="1"
				placeholder={String(inner.Ndays)}
				value={rule.lineMaxDay ?? ''}
				onchange={(e) => setNumber('lineMaxDay', e, { integer: true, nullable: true })}
			/>
		</ControlInput>
		<ControlInput label="φ day">
			<input
				type="number"
				class="rule-num"
				min="1"
				max={inner.Ndays}
				step="1"
				placeholder={String(rule.lineMinDay ?? 1)}
				value={rule.phaseRefDay ?? ''}
				onchange={(e) => setNumber('phaseRefDay', e, { integer: true, nullable: true })}
			/>
		</ControlInput>
	</div>
	<p class="rule-note">
		Only markers on days inside this range, and ticked on that {unitLabel === 'panels'
			? 'panel'
			: 'series'}, are fitted. φ is in hours after the row start, at the φ day.
	</p>

	<label class="control-input-checkbox">
		<input
			type="checkbox"
			checked={rule.colour == null}
			onchange={(e) =>
				commit({ colour: e.currentTarget.checked ? null : (inner.data[0]?.colour ?? '#000000') })}
		/>
		<span class="ci-label">Each series' colour</span>
	</label>
	<div class="control-input-color">
		{#if rule.colour != null}
			<div class="control-color">
				<ColourPicker
					bind:value={
						() => rule.colour,
						(v) => {
							// The picker writes its value back on mount; only a CHANGE is an edit.
							if (v !== rule.colour) commit({ colour: v });
						}
					}
				/>
			</div>
		{/if}
		<ControlInput label="Marker size">
			<input
				type="number"
				class="rule-num"
				min="1"
				step="0.2"
				value={rule.markerSize}
				onchange={(e) => setNumber('markerSize', e)}
			/>
		</ControlInput>
		<ControlInput label="Line width">
			<input
				type="number"
				class="rule-num"
				min="1"
				step="0.2"
				value={rule.lineWidth}
				onchange={(e) => setNumber('lineWidth', e)}
			/>
		</ControlInput>
	</div>
	<label class="control-input-checkbox">
		<input
			type="checkbox"
			checked={rule.showLine}
			onchange={(e) => commit({ showLine: e.currentTarget.checked })}
		/>
		<span class="ci-label">Show line</span>
	</label>

	<!-- What each series reports. τ is what the rule's τ OUTPUT carries (the harmonic
	     check's pick, Decision 2b), labelled as the port labels it; the line's fitted slope
	     sits beside it, and a row where the two differ (the check picked τ/2 or 2τ) is
	     flagged with a glyph and a tooltip. The check is the port's own cached $derived, so
	     reading it here adds no periodogram run (plan section 8's cost rule holds). -->
	<ul class="rule-summary">
		{#each rows as row, i (i)}
			<li class:tau-disagree={row.t?.disagree}>
				<div class="summary-head">
					<span class="swatch" style:background={row.colour}></span>
					<span class="series-name">{row.label}</span>
					<span class="status" class:detached={row.status === 'detached'}>{row.status}</span>
				</div>
				<dl class="summary-values">
					<div class="stat" data-stat="tau" {@attach tooltip(row.t?.note)}>
						<dt class="stat-label">{RULE_STAT_LABEL.tau}</dt>
						<dd class="stat-value">{fmt(row.t?.tau)}</dd>
					</div>
					<div class="stat" data-stat="slope" {@attach tooltip(row.t?.note)}>
						<dt class="stat-label">line slope (h)</dt>
						<dd class="stat-value">
							{fmt(row.t?.slope)}{#if row.t?.disagree}<span
									class="disagree-flag"
									role="img"
									aria-label="disagrees with τ">⚠</span
								>{/if}
						</dd>
					</div>
					<div class="stat" data-stat="phi">
						<dt class="stat-label">{RULE_STAT_LABEL.phi}</dt>
						<dd class="stat-value">{fmt(row.s?.phi)}</dd>
					</div>
					<div class="stat" data-stat="r2">
						<dt class="stat-label">{RULE_STAT_LABEL.r2}</dt>
						<dd class="stat-value">{fmt(row.s?.r2, 3)}</dd>
					</div>
					<div class="stat" data-stat="rmse">
						<dt class="stat-label">{RULE_STAT_LABEL.rmse}</dt>
						<dd class="stat-value">{fmt(row.s?.rmse)}</dd>
					</div>
					<div class="stat" data-stat="n">
						<dt class="stat-label">{RULE_STAT_LABEL.n}</dt>
						<dd class="stat-value">{row.s ? row.s.n : '\u2013'}</dd>
					</div>
				</dl>
			</li>
		{/each}
	</ul>
</div>

<style>
	.rule-block {
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-2);
		border: 1px solid var(--color-lightness-85);
		border-left: 3px solid var(--color-accent-fill);
		border-radius: var(--radius-sm);
		margin-bottom: var(--space-2);
		transition: box-shadow 0.3s;
	}

	:global(.rule-block.rule-flash) {
		animation: rule-flash 1.2s ease-out;
	}

	@keyframes rule-flash {
		0% {
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent-fill) 55%, transparent);
		}
		100% {
			box-shadow: 0 0 0 0 transparent;
		}
	}

	.rule-note {
		margin: 0 0 var(--space-2);
		font-size: var(--font-xs);
		color: var(--color-lightness-45);
	}

	.rule-error {
		margin: 0 0 var(--space-1);
		font-size: var(--font-xs);
		color: #b3261e;
	}

	.rule-num {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	.lock-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-2) 0;
	}

	.lock-title {
		font-size: var(--font-sm);
		color: var(--color-lightness-35);
		margin: 0;
	}

	.lock-row {
		display: grid;
		grid-template-columns: 1fr auto 70px;
		align-items: center;
		gap: var(--space-2);
	}

	.lock-label {
		font-size: var(--font-xs);
		color: var(--color-lightness-35);
		white-space: nowrap;
	}

	.segmented {
		display: inline-flex;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.segmented label {
		padding: 0.1rem 0.5rem;
		font-size: var(--font-xs);
		line-height: 1.5;
		color: var(--color-lightness-35);
		cursor: pointer;
		user-select: none;
		background: var(--surface-card);
	}

	.segmented label + label {
		border-left: 1px solid var(--color-lightness-85);
	}

	.segmented label.active {
		background: var(--color-accent-fill);
		color: white;
		font-weight: 600;
	}

	.segmented label:focus-within {
		box-shadow: var(--shadow-focus-soft);
	}

	.segmented input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
		margin: 0;
		pointer-events: none;
	}

	.rule-summary {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		font-size: var(--font-xs);
		font-variant-numeric: tabular-nums;
		border-top: 1px solid var(--color-lightness-85);
	}

	.rule-summary li {
		padding: 3px 0;
		border-bottom: 1px solid var(--color-lightness-92, #eee);
	}

	.summary-head {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	.series-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.summary-values {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
		gap: 2px var(--space-2);
		margin: 2px 0 0;
		padding-left: 12px;
		color: var(--color-lightness-35);
	}

	.stat {
		min-width: 0;
	}

	.stat-label {
		font-size: 0.9em;
		color: var(--color-lightness-45);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.stat-value {
		margin: 0;
		color: var(--color-lightness-25);
		white-space: nowrap;
	}

	.disagree-flag {
		margin-left: 3px;
		color: var(--color-warning-text);
		font-weight: 600;
		cursor: help;
	}

	li.tau-disagree [data-stat='tau'] .stat-value,
	li.tau-disagree [data-stat='slope'] .stat-value {
		font-weight: 600;
	}

	.swatch {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		margin-right: 4px;
		vertical-align: middle;
	}

	.status {
		color: var(--color-lightness-45);
	}

	.status.detached {
		color: #9a6700;
	}
</style>
