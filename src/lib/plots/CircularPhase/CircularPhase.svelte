<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
	import { POINT_SHAPES, POINT_SHAPE_LABELS, getPointPath } from '$lib/components/plotbits/pointShapes.js';
	import { createPolar } from '$lib/components/plotbits/polar.js';
	import { placeCircularPoints, maxStackHeight } from '$lib/components/plotbits/circularStack.js';
	import PolarGrid from '$lib/components/plotbits/PolarGrid.svelte';
	import MeanVector from '$lib/components/plotbits/MeanVector.svelte';
	import RoseWedges from '$lib/components/plotbits/RoseWedges.svelte';
	import { scaleLinear } from 'd3-scale';
	import { niceAxisLimit } from '$lib/plots/Boxplot/Boxplot.svelte';
	import {
		seriesStats,
		displayPeriodFor,
		cleanNumericColumn,
		columnToPhaseHours,
		weightedSeriesStats
	} from '$lib/utils/circularPlot.js';
	import { watsonWilliams, toRadiansColumn } from '$lib/utils/circular.js';
	import { pUpperFromF } from '$lib/utils/fdist.js';

	// Radial placement constants for the timed (value-radius clock) render mode.
	const TIMED_INNER_RIM = 0.12;

	// NOTE on field naming: sibling time-optional plots (Periodogram, Actogram,
	// Correlogram, FFT) all expose 'time'/'values' as the PUBLIC wiring port
	// names (definition.defaultDataInputs) but store the series columns
	// internally as generic `x`/`y` — the workflow graph's edge/passthrough
	// detection (ProcessNode.svelte.js) hardcodes `dp?.x?.refId` / `dp?.y?.refId`
	// / `dp?.column?.refId` checks and doesn't know about arbitrary field names.
	// CircularPhaseSeries follows the same convention: `x` is the optional time
	// column, `y` is the phase/measurement column.
	class CircularPhaseSeries {
		static descriptors = {};
		parentPlot = $state();
		x = $state(); // optional time column: wiring this turns the series into a value-radius clock plot
		y = $state(); // phase column (untimed) or measurement column (timed)
		label = $state('Phase 1');
		colour = $state(getPaletteColor(0));
		shape = $state('circle');
		radius = $state(3.4);
		draw = $state(true); // show this series' points

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			const xJSON = dataIN?.x ?? dataIN?.time;
			this.x = xJSON ? ColumnClass.fromJSON(xJSON) : new ColumnClass({ refId: -1 });
			// Migration: legacy sessions stored the single value column as `column`;
			// `values` is also accepted directly (the untimed-only public wire shape).
			const yJSON = dataIN?.y ?? dataIN?.values ?? dataIN?.column;
			this.y = yJSON ? ColumnClass.fromJSON(yJSON) : new ColumnClass({ refId: -1 });
			this.label = dataIN?.label ?? 'Phase ' + (parent.data.length + 1);
			this.colour = dataIN?.colour ?? getPaletteColor(parent.data.length) ?? getPaletteColor(0);
			this.shape = POINT_SHAPES.includes(dataIN?.shape) ? dataIN.shape : 'circle';
			this.radius = dataIN?.radius ?? 3.4;
			this.draw = dataIN?.draw ?? true;
		}

		timeWired = $derived(this.x?.refId >= 0);
		rawValues = $derived.by(() => cleanNumericColumn(this.y?.getData?.() ?? []));

		// Per-row phase, timed series only. Deliberately period-space (the same
		// convention as rawValues / stats.meanValue below), NOT the TAU-radian
		// output of timeToAngleRad — P.toXY / MeanVector expect a value in
		// [0, period) that they convert to radians themselves (see polar.js).
		// The TAU-radian conversion is only needed inside the Rayleigh-stats
		// machinery (weightedSeriesStats), which does its own conversion.
		angles = $derived.by(() =>
			this.timeWired ? columnToPhaseHours(this.x.getData(), this.x.type) : []
		);

		stats = $derived.by(() =>
			this.timeWired
				? weightedSeriesStats(
						this.x.getData(),
						this.x.type,
						this.y.getData(),
						this.parentPlot.period
					)
				: seriesStats(this.rawValues, this.parentPlot.unit, this.parentPlot.period)
		);

		getLegendItem() {
			const s = this.stats;
			const rTxt = Number.isFinite(s.R) ? ` (R=${s.R.toFixed(2)})` : '';
			return {
				label: this.label + rTxt,
				elements: [{ type: 'points', color: this.colour, size: this.radius, shape: this.shape }]
			};
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				label: this.label,
				colour: this.colour,
				shape: this.shape,
				radius: this.radius,
				draw: this.draw
			};
		}
		static fromJSON(json, parent) {
			return new CircularPhaseSeries(parent, json);
		}
	}

	export class CircularPhaseClass {
		static descriptors = { padding: { group: 'Padding' } };

		parentBox = $state();
		data = $state([]);
		legend = $state();

		unit = $state('hours'); // 'radians' | 'degrees' | 'hours'
		period = $state(24);
		placement = $state('stack'); // 'stack' | 'bin' | 'rim' — applies to untimed series
		binWidth = $state(1);
		showMeanVectors = $state(true);
		showWedges = $state(false);
		wedgeBinWidth = $state(2);
		showWatsonWilliams = $state(false);
		padding = $state({ top: 24, right: 20, bottom: 30, left: 20 });

		displayPeriod = $derived(displayPeriodFor(this.unit, this.period));
		plotSize = $derived(
			Math.max(
				40,
				Math.min(
					this.parentBox.width - this.padding.left - this.padding.right,
					this.parentBox.height - this.padding.top - this.padding.bottom
				)
			)
		);
		perSeriesStats = $derived.by(() =>
			this.data.map((d) => ({ label: d.label, colour: d.colour, ...d.stats }))
		);

		// Shared radial value axis (timed series only): [floor(min(0,dataMin)), ceil(dataMax)].
		valueAxis = $derived.by(() => {
			let dataMin = Infinity;
			let dataMax = -Infinity;
			for (const d of this.data) {
				if (!d.timeWired) continue;
				for (const v of d.rawValues) {
					if (!Number.isFinite(v)) continue;
					if (v < dataMin) dataMin = v;
					if (v > dataMax) dataMax = v;
				}
			}
			if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return [0, 1];
			return [niceAxisLimit(Math.min(0, dataMin), 'floor'), niceAxisLimit(dataMax, 'ceil')];
		});

		// Largest stack/bin column height across untimed series, so `placeCircularPoints`
		// can fit-scale the dodge step instead of overflowing the plot radius.
		untimedMaxStack = $derived.by(() =>
			maxStackHeight(
				this.data.filter((d) => !d.timeWired).map((d) => d.rawValues),
				{ placement: this.placement, period: this.displayPeriod, binWidth: this.binWidth, quant: 0.5 }
			)
		);

		// Watson-Williams across UNTIMED series' mean directions only. WW is an
		// unweighted-event circular ANOVA (Fisher/Batschelet): it compares samples
		// of discrete angle observations. A timed series is a continuous,
		// amplitude-weighted rhythm (its concentration comes from the *values*,
		// not from event density — evenly-sampled time points fold to a uniform,
		// near-zero-R angle distribution regardless of the underlying rhythm), so
		// it has no valid unweighted-event representation to feed WW and is
		// excluded rather than silently misrepresented.
		ww = $derived.by(() => {
			if (!this.showWatsonWilliams) return null;
			const groups = this.data
				.filter((d) => !d.timeWired)
				.map((d) => toRadiansColumn(d.rawValues, this.unit, this.period));
			return watsonWilliams(groups, pUpperFromF);
		});

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			// single-input create path (drag-wire onto an empty node, or a flat legacy payload)
			if (dataIN && (dataIN.time || dataIN.values || dataIN.column || dataIN.x || dataIN.y))
				this.addData(dataIN);
		}

		addData(dataIN) {
			// Public wiring shape is {time, values}; remap to the internal {x, y}
			// convention shared with Periodogram/Actogram/Correlogram/FFT (preserving
			// any other keys, e.g. label/colour, unlike the sibling plots' remap).
			let payload = dataIN;
			if (dataIN && Object.keys(dataIN).includes('time')) {
				payload = {
					...dataIN,
					x: { refId: dataIN.time.refId },
					y: { refId: dataIN.values.refId }
				};
			}
			this.data.push(new CircularPhaseSeries(this, payload));
		}
		removeData(idx) {
			this.data.splice(idx, 1);
		}

		getLegendItems = $derived.by(() => {
			const items = [];
			this.data.forEach((d) => {
				const li = d.getLegendItem();
				if (li) items.push(li);
			});
			return items;
		});

		// No Cartesian axes; padding is fixed/symmetric. Present as a no-op so the
		// generic plot lifecycle (which may call autoScalePadding) is satisfied.
		autoScalePadding() {}

		getDownloadData() {
			const headers = ['Series', 'n', 'mean_or_acrophase', 'R', 'z', 'p'];
			const rows = this.perSeriesStats.map((s) => [
				s.label,
				s.n,
				Number.isFinite(s.meanValue) ? s.meanValue : '',
				Number.isFinite(s.R) ? s.R : '',
				Number.isFinite(s.z) ? s.z : '',
				Number.isFinite(s.pValue) ? s.pValue : ''
			]);
			const w = this.ww;
			if (w && w.valid) {
				rows.push([`Watson-Williams F(${w.df1},${w.df2})`, w.N, '', '', w.F, w.pValue]);
			}
			return { headers, rows };
		}

		toJSON() {
			return {
				unit: this.unit,
				period: this.period,
				placement: this.placement,
				binWidth: this.binWidth,
				showMeanVectors: this.showMeanVectors,
				showWedges: this.showWedges,
				wedgeBinWidth: this.wedgeBinWidth,
				showWatsonWilliams: this.showWatsonWilliams,
				padding: this.padding,
				data: this.data,
				legend: this.legend.toJSON()
			};
		}
		static fromJSON(parent, json) {
			const c = new CircularPhaseClass(parent, null);
			if (!json) return c;
			c.unit = json.unit ?? 'hours';
			c.period = json.period ?? 24;
			c.placement = json.placement ?? 'stack';
			c.binWidth = json.binWidth ?? 1;
			c.showMeanVectors = json.showMeanVectors ?? true;
			c.showWedges = json.showWedges ?? false;
			c.wedgeBinWidth = json.wedgeBinWidth ?? 2;
			c.showWatsonWilliams = json.showWatsonWilliams ?? false;
			c.padding = json.padding ?? c.padding;
			c.legend = LegendClass.fromJSON(json.legend);
			if (json.data) c.data = json.data.map((d) => CircularPhaseSeries.fromJSON(d, c));
			else if (json.column) c.addData({ column: json.column }); // very old flat single-series sessions
			else if (json.dataIn) c.addData(json.dataIn); // creation-time hint (mirrors sibling plots)
			return c;
		}
	}

	export const definition = {
		defaultDataInputs: ['time', 'values'],
		controlHeaders: ['Properties', 'Data'],
		displayName: 'Circular phase plot',
		plotClass: CircularPhaseClass
	};
</script>

<script>
	import { appState } from '$lib/core/core.svelte';
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';
	import PlotTooltip from '$lib/components/plotbits/PlotTooltip.svelte';
	import {
		bindAltTooltipToggle,
		computeTooltipPosition,
		dispatchTooltip,
		hideTooltip
	} from '$lib/components/plotbits/helpers/tooltipHelpers.js';

	let { theData, which } = $props();

	const fmt = (v, dp = 3) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
	const fmtP = (p) => (Number.isFinite(p) ? (p < 1e-4 ? '< 0.0001' : p.toFixed(4)) : '—');
	const escapeHtml = (s) =>
		String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

	// Value-unit suffix for the placement bin-width control.
	const unitSuffix = (u) => (u === 'hours' ? 'h' : u === 'degrees' ? '°' : 'rad');

	// Format one observation's phase for the tooltip: HH:MM clock time when the
	// plot unit is 'hours' (the value is already expressed on the display period),
	// otherwise a plain number with the unit suffix.
	function fmtPhase(value, unit, period) {
		if (!Number.isFinite(value)) return '—';
		if (unit === 'hours') {
			const p = Number.isFinite(period) && period > 0 ? period : 24;
			const v = ((value % p) + p) % p;
			const periodMinutes = Math.round(p * 60);
			let totalMinutes = Math.round(v * 60);
			if (totalMinutes >= periodMinutes) totalMinutes -= periodMinutes;
			const hh = Math.floor(totalMinutes / 60);
			const mm = totalMinutes % 60;
			return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
		}
		return `${fmt(value, unit === 'degrees' ? 1 : 3)}${unitSuffix(unit)}`;
	}

	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	const handleTooltip = bindAltTooltipToggle(
		() => tooltip,
		(v) => {
			tooltip = v;
		}
	);

	// Hover on a series' merged points <path>: map the pointer to the polar
	// projection's data space, then snap to the nearest observation in that
	// series by circular (wrap-around) distance on the display period. Untimed
	// series search by phase (rawValues); timed series search by time-of-day
	// (angles, period-space hours).
	function handleSeriesHover(evt, plot, P, d) {
		const svg = evt.currentTarget.ownerSVGElement;
		const ctm = svg?.getScreenCTM();
		if (!ctm) return;
		const pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
		const { value } = P.fromXY(pt.x, pt.y);
		const period = P.period;
		const positions = d.timeWired ? d.angles : d.rawValues;

		let bestIdx = -1;
		let bestDist = Infinity;
		positions.forEach((v, i) => {
			if (!Number.isFinite(v)) return;
			const diff = Math.abs(v - value) % period;
			const dist = Math.min(diff, period - diff);
			if (dist < bestDist) {
				bestDist = dist;
				bestIdx = i;
			}
		});
		if (bestIdx < 0) {
			hideTooltip(evt.currentTarget);
			return;
		}

		const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${d.colour};margin-right:4px;vertical-align:middle;"></span>`;
		const content = d.timeWired
			? `${dot}<strong>${escapeHtml(d.label)}</strong><br/><span style="opacity:0.7">time:</span> ${fmtPhase(d.angles[bestIdx], 'hours', plot.period)}<br/><span style="opacity:0.7">value:</span> ${fmt(d.rawValues[bestIdx])}`
			: `${dot}<strong>${escapeHtml(d.label)}</strong><br/><span style="opacity:0.7">phase:</span> ${fmtPhase(d.rawValues[bestIdx], plot.unit, plot.period)}`;

		const { x: xPos, y: yPos } = computeTooltipPosition(evt.clientX, evt.clientY);
		dispatchTooltip(evt.currentTarget, { visible: true, x: xPos, y: yPos, content });
	}

	function handleSeriesLeave(evt) {
		hideTooltip(evt.currentTarget);
	}
</script>

{#snippet plot(theData)}
	{@const plot = theData.plot}
	{@const size = plot.plotSize}
	{@const cx = plot.padding.left + size / 2}
	{@const cy = plot.padding.top + size / 2}
	{@const P = createPolar({ cx, cy, radius: (size / 2) * 0.82, period: plot.displayPeriod })}
	{@const hasTimed = plot.data.some((d) => d.timeWired)}
	{@const valueScale = scaleLinear().domain(plot.valueAxis).range([TIMED_INNER_RIM, 1])}
	<svg
		id={'plot' + plot.parentBox.id}
		width={plot.parentBox.width}
		height={plot.parentBox.height}
		viewBox="0 0 {plot.parentBox.width} {plot.parentBox.height}"
		style="background: var(--surface-card); position: absolute;"
		ontooltip={handleTooltip}
	>
		<PolarGrid
			projection={P}
			showRLabels={!hasTimed}
			hint={hasTimed
				? `value ${plot.valueAxis[0]}–${plot.valueAxis[1]} · period ${plot.displayPeriod} ${unitSuffix(plot.unit)}`
				: `phase · period ${plot.displayPeriod} ${unitSuffix(plot.unit)}`}
		/>

		{#each plot.data as d, i (d.x.id + '-' + d.y.id)}
			{#if !d.timeWired && plot.showWedges}
				<RoseWedges projection={P} values={d.rawValues} binWidth={plot.wedgeBinWidth} colour={d.colour} />
			{/if}
			{#if d.draw}
				{#if d.timeWired}
					<path
						d={d.angles
							.map((ph, idx) => {
								const v = d.rawValues[idx];
								if (!Number.isFinite(ph) || !Number.isFinite(v)) return '';
								const [x, y] = P.toXY(ph, valueScale(v));
								return getPointPath(d.shape, x, y, d.radius);
							})
							.filter(Boolean)
							.join(' ')}
						fill={d.colour}
						fill-opacity="0.9"
						role="presentation"
						onpointermove={(evt) => handleSeriesHover(evt, plot, P, d)}
						onpointerleave={handleSeriesLeave}
					/>
				{:else}
					{@const placed = placeCircularPoints(d.rawValues, {
						placement: plot.placement,
						period: plot.displayPeriod,
						binWidth: plot.binWidth,
						dotRadius: d.radius,
						plotRadius: P.radius,
						maxStack: plot.untimedMaxStack,
						innerRim: 0.12,
						outerRim: 0.98
					})}
					<path
						d={placed
							.map((p) => {
								const [x, y] = P.toXY(p.value, p.r01);
								return getPointPath(d.shape, x, y, d.radius);
							})
							.join(' ')}
						fill={d.colour}
						fill-opacity="0.9"
						role="presentation"
						onpointermove={(evt) => handleSeriesHover(evt, plot, P, d)}
						onpointerleave={handleSeriesLeave}
					/>
				{/if}
			{/if}
			{#if plot.showMeanVectors}
				<MeanVector projection={P} value={d.stats.meanValue} length={d.stats.R} colour={d.colour} />
			{/if}
		{/each}

		{#if hasTimed}
			<g class="value-axis-ticks">
				{#each valueScale.ticks(3) as t (t)}
					{@const r01 = valueScale(t)}
					{#if r01 >= 0 && r01 <= 1}
						<text
							x={P.cx + 3}
							y={P.cy - P.radius * r01 + 4}
							font-size="9"
							fill="var(--color-lightness-50)">{t}</text
						>
					{/if}
				{/each}
			</g>
		{/if}

		<Legend
			legendData={plot.legend}
			items={plot.getLegendItems}
			plotWidth={size}
			plotHeight={size}
			padding={plot.padding}
			which="plot"
		/>
	</svg>
	<PlotTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} content={tooltip.content} />
{/snippet}

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}
		<div class="control-component">
			<div class="control-component-title"><p>Dimension</p></div>
			<div class="control-input-horizontal">
				<ControlInput label="Width"><NumberWithUnits bind:value={theData.parentBox.width} /></ControlInput>
				<ControlInput label="Height"><NumberWithUnits bind:value={theData.parentBox.height} /></ControlInput>
			</div>
		</div>
		<div class="div-line"></div>

		<Legend legendData={theData.legend} which="controls" />
		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title"><p>Angle</p></div>
			<div class="control-input-horizontal">
				<ControlInput label="Unit">
					<select bind:value={theData.unit}>
						<option value="radians">Radians</option>
						<option value="degrees">Degrees</option>
						<option value="hours">Clock hours</option>
					</select>
				</ControlInput>
				{#if theData.unit === 'hours'}
					<ControlInput label="Period (h)">
						<NumberWithUnits bind:value={theData.period} min="0.1" step="1" />
					</ControlInput>
				{/if}
			</div>
		</div>
		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title"><p>Points</p></div>
			<p class="cp-hint">Placement applies to series without a wired time column.</p>
			<div class="control-input-horizontal">
				<ControlInput label="Placement">
					<select bind:value={theData.placement}>
						<option value="stack">Stacked</option>
						<option value="bin">Binned</option>
						<option value="rim">On circumference</option>
					</select>
				</ControlInput>
				{#if theData.placement === 'bin'}
					<ControlInput label={`Bin (${unitSuffix(theData.unit)})`}>
						<NumberWithUnits bind:value={theData.binWidth} min="0.05" step="0.5" />
					</ControlInput>
				{/if}
			</div>
		</div>
		<div class="div-line"></div>

		<div class="control-component">
			<label class="cp-toggle"><input type="checkbox" bind:checked={theData.showMeanVectors} /> Mean resultant vectors</label>
			<label class="cp-toggle"><input type="checkbox" bind:checked={theData.showWedges} /> Rose wedges (circular histogram)</label>
			{#if theData.showWedges}
				<ControlInput label={`Wedge bin (${unitSuffix(theData.unit)})`}>
					<NumberWithUnits bind:value={theData.wedgeBinWidth} min="0.05" step="0.5" />
				</ControlInput>
			{/if}
			<label class="cp-toggle"><input type="checkbox" bind:checked={theData.showWatsonWilliams} /> Watson-Williams test (equal mean direction)</label>
		</div>

		{#if theData.showWatsonWilliams && theData.ww}
			<div class="cp-ww">
				{#if theData.ww.valid}
					<p>F({theData.ww.df1}, {theData.ww.df2}) = {fmt(theData.ww.F, 3)}, p = {fmtP(theData.ww.pValue)}</p>
				{:else}
					<p class="cp-hint">
						Wire two or more phase columns without a time (Watson-Williams compares untimed
						groups' unweighted event angles) to compare mean directions.
					</p>
				{/if}
			</div>
		{/if}
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<div class="add">
					<button class="icon" onclick={async () => { theData.addData({}); await tick(); dataSettingsScrollTo('bottom'); }}>
						<Icon name="add" width={16} height={16} />
					</button>
				</div>
			</div>

			{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
				<div class="dataBlock" animate:flip={{ duration: 500 }} in:slide={{ duration: 500, axis: 'y' }} out:slide={{ duration: 500, axis: 'y' }}>
					<div class="control-component-title">
						<p><Editable bind:value={datum.label} /></p>
						<button class="icon" onclick={() => theData.removeData(i)}>
							<Icon name="trash" width={16} height={16} className="control-component-title-icon" />
						</button>
					</div>
					<div class="data-wrapper">
						<div class="y-select">
							<ControlInput label="time (optional)"></ControlInput>
							<Column col={datum.x} canChange={true} />
							{#if datum.x.refId >= 0}
								<button
									type="button"
									class="icon"
									onclick={() => {
										datum.x.refId = -1;
									}}
								>
									<Icon name="reset" width={14} height={14} />
								</button>
							{/if}
						</div>
						<div class="y-select">
							<ControlInput label="values (phase column)"></ControlInput>
							<Column col={datum.y} canChange={true} />
						</div>
						{#if datum.timeWired}
							<p class="cp-hint">
								Time wired: this series plots as a value-radius clock (point radius = value; angle
								= time-of-day).
							</p>
						{/if}
						<div class="control-input-horizontal">
							<div class="control-input" style="max-width: 1.5rem;">
								<p>Col</p><ColourPicker bind:value={datum.colour} />
							</div>
							<ControlInput label="Shape">
								<select bind:value={datum.shape}>
									{#each POINT_SHAPES as s, si (s)}
										<option value={s}>{POINT_SHAPE_LABELS[si]}</option>
									{/each}
								</select>
							</ControlInput>
							<ControlInput label="Size">
								<NumberWithUnits bind:value={datum.radius} min="0.5" step="0.5" />
							</ControlInput>
						</div>
					</div>

					{#if datum.stats}
						<p class="cp-stat">
							n {datum.stats.n} ·
							{#if datum.timeWired}acrophase {fmtPhase(datum.stats.meanValue, 'hours', theData.period)} ·{/if}
							R {fmt(datum.stats.R, 3)} · z {fmt(datum.stats.z, 2)} · p {fmtP(datum.stats.pValue)}
						</p>
					{/if}
					<div class="div-line"></div>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<style>
	.cp-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-2, 0.4rem);
		font-size: var(--font-sm);
		margin: 0.2rem 0;
	}
	.cp-ww,
	.cp-stat,
	.cp-hint {
		font-size: var(--font-sm);
		opacity: 0.85;
		margin: 0.2rem 0;
	}
</style>
