<script module>
	import ColourPicker, { getPaletteColor } from '$lib/components/inputs/ColourPicker.svelte';
	import { resolveColour } from '$lib/plots/appearanceIdentity.js';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { POINT_SHAPES, POINT_SHAPE_LABELS } from './pointShapes.js';

	export class PointsClass {
		// Opts itself into the shared-options panel + AI editor across every plot that uses it.
		static sharedStyle = true;
		// UI metadata for the multi-select shared-options panel (sharedControls.js).
		static descriptors = {
			colour: { input: 'color', label: 'Colour', group: 'Points' },
			radius: { label: 'Size', step: 0.5, group: 'Points' },
			shape: { input: 'select', options: POINT_SHAPES, label: 'Shape', group: 'Points' },
			draw: { label: 'Show', group: 'Points' }
		};
		// Resolved at READ time, not stored. A series is constructed with y.refId === -1
		// and wired afterwards, so resolving in the constructor pinned nothing and the
		// identity map never engaged on the interactive path. `#explicitColour` is null
		// while the colour is automatic, which is also what toJSON writes.
		#explicitColour = $state(null);

		get colour() {
			const parent = this.parentData;
			const ref = parent?.y?.refId ?? parent?.column?.refId ?? null;
			const colId = typeof ref === 'number' && ref >= 0 ? ref : null;
			const siblings = parent?.parentPlot?.data;
			const index = Array.isArray(siblings) ? Math.max(0, siblings.indexOf(parent)) : 0;
			return resolveColour(this.#explicitColour, colId, index);
		}
		set colour(v) {
			this.#explicitColour = v;
		}
		radius = $state(4);
		shape = $state('circle');
		draw = $state(true);

		constructor(dataIN, parent) {
			this.parentData = parent;
			// The palette fallback must not assume a parent: fromJSON constructs styles before
			// the series exists, so `parent` can legitimately be undefined. Guard it, or a
			// series with no explicit colour throws "Cannot read properties of undefined
			// (reading 'parentPlot')" — and importJson then silently drops the whole plot.
			// Colour follows the COLUMN, not this series' position in this plot, so the
			// same hive is the same colour in every plot that draws it. An explicit
			// colour (a saved session, or a user override) always wins.
			// ADOPTION, narrowly. A saved colour is treated as auto-assigned only when it
			// is EXACTLY what the old positional rule would have produced for this
			// series' position — getPaletteColor(index) — and is then released to the
			// identity map. Anything else is a deliberate choice and kept as an override.
			//
			// "Matches any palette entry" was the first rule and was too broad: it also
			// swallowed a colour someone had deliberately set to a different palette
			// entry, which is how a series legitimately gets a line and points of
			// different colours. A test caught that.
			const autoIndex = parent?.parentPlot?.data?.length ?? 0;
			this.#explicitColour =
				typeof dataIN?.colour === 'string' && dataIN.colour !== getPaletteColor(autoIndex)
					? dataIN.colour
					: null;
			this.radius = dataIN?.radius ?? 4;
			this.shape = POINT_SHAPES.includes(dataIN?.shape) ? dataIN.shape : 'circle';
			this.draw = dataIN?.draw ?? true;
		}

		toJSON() {
			return {
				colour: this.#explicitColour,
				radius: this.radius,
				shape: this.shape,
				draw: this.draw
			};
		}

		// `json` may be absent entirely: a partial series (e.g. a Quick-Plot spawn, or a
		// session written by hand/by a tool) carries no `points`. Default rather than throw —
		// each plot's fromJSON calls this unguarded, and importJson drops a plot that throws.
		static fromJSON(json, parent) {
			return new PointsClass(
				{
					colour: json?.colour,
					radius: json?.radius,
					shape: json?.shape,
					draw: json?.draw
				},
				parent
			);
		}
	}
</script>

<script>
	import { quadtree } from 'd3-quadtree';
	import { markerPaths } from './markerPaths.js';
	import {
		buildAggregatedContent,
		computeTooltipPosition,
		dispatchTooltip,
		hideTooltip
	} from '$lib/components/plotbits/helpers/tooltipHelpers.js';

	let {
		pointsData = $bindable(),
		x,
		y,
		xscale,
		yscale,
		yoffset,
		xoffset,
		tooltip = false,
		xtype = 'number',
		which,
		dataLabel = '',
		dataColour = '',
		xLabel = 'x',
		yLabel = 'y',
		// When provided, the tooltip aggregates and displays the y value at the
		// hovered x for every sibling series. Shape: [{label, colour, findYAt(x)}]
		siblings = null,
		hideOnAlt = false,
		// Colour by (colour-by plan 2026-10-20, section 3.5; encodingHost.js). null draws the
		// series as ONE path in its colour, exactly as before. Otherwise
		//   { idx, colours, noValueColour, values, label, format }
		// `idx` is the colour bucket of each ROW (row-aligned with x and y; -1, or a row past
		// its end, is "no value"), `colours` the bucket colours, `noValueColour` what a mark
		// with no value is drawn in (the series colour), `values` the colour value of each row
		// and `label` / `format(v)` how the tooltip names and prints it. One path per non-empty
		// bucket, "no value" first (underneath), then bucket order (decision 9).
		colourBy = null
	} = $props();

	let qt;

	//MAKE THE POINTS PATH(S): [{ key, fill, d }]
	let paths = $derived.by(() => {
		// Props read ONCE into locals: every prop read is a getter (a signal read when the parent
		// passed an expression), and the loops below run once per sample (ROB-9).
		const pd = pointsData;
		const xv = x;
		const yv = y;
		if (!pd?.draw || !xv || !yv) return null;
		const sx = xscale;
		const sy = yscale;
		const ox = xoffset;
		const oy = yoffset;
		const shape = pd.shape || 'circle';
		const radius = pd.radius;

		//filter out the NaNs and data outside the plot limits
		const xlims = sx.domain();
		const [minX, maxX] = [Math.min(...xlims), Math.max(...xlims)];
		const ylims = sy.domain();
		const [minY, maxY] = [Math.min(...ylims), Math.max(...ylims)];

		const filteredData = [];
		const n = Math.min(xv.length, yv.length);
		for (let i = 0; i < n; i++) {
			const px = xv[i];
			const py = yv[i];
			if (
				px >= minX &&
				px <= maxX &&
				py >= minY &&
				py <= maxY &&
				py != null &&
				px != null &&
				!isNaN(py) &&
				!isNaN(px)
			) {
				// The row travels with the point: the colour bucket and the tooltip's colour
				// value are read by row.
				filteredData.push({ x: px, y: py, i });
			}
		}

		//Set up the quadtree for hovering
		if (tooltip) {
			qt = quadtree()
				.x((d) => sx(d.x) + ox)
				.y((d) => sy(d.y) + oy)
				.addAll(filteredData);
		}

		// Marker centres in px, then the shared builder (markerPaths.js): one path in the series
		// colour, or one per colour bucket with "no value" first.
		const m = filteredData.length;
		const px = new Float64Array(m);
		const py = new Float64Array(m);
		const rows = colourBy ? new Int32Array(m) : null;
		for (let j = 0; j < m; j++) {
			const p = filteredData[j];
			px[j] = sx(p.x);
			py[j] = sy(p.y);
			if (rows) rows[j] = p.i;
		}
		return markerPaths(px, py, {
			shape,
			radius,
			colour: pd.colour,
			colourBy,
			marks: rows
		});
	});

	function handleHover(e) {
		if (!tooltip || !qt) return;

		if (hideOnAlt && e.altKey) {
			hideTooltip(e.target);
			return;
		}

		const mouseX = e.offsetX;
		const mouseY = e.offsetY;
		const closest = qt.find(mouseX, mouseY, pointsData.radius * 2);

		if (!closest) {
			hideTooltip(e.target);
			return;
		}

		const series = siblings
			? siblings.map((s) => ({
					label: s.label,
					colour: s.colour,
					yValue: s.findYAt ? s.findYAt(closest.x) : null
				}))
			: [
					{
						label: dataLabel,
						colour: dataColour || pointsData.colour,
						yValue: closest.y,
						yLabel
					}
				];

		const cb = colourBy;
		const extra =
			cb?.values && cb.label
				? [
						{
							label: cb.label,
							value: cb.format
								? cb.format(cb.values[closest.i])
								: String(cb.values[closest.i] ?? 'no value')
						}
					]
				: [];
		const content = buildAggregatedContent({
			xLabel: xLabel || 'x',
			xValue: closest.x,
			xtype,
			series,
			extra
		});

		const { x: xPos, y: yPos } = computeTooltipPosition(e.clientX, e.clientY);
		dispatchTooltip(e.target, { visible: true, x: xPos, y: yPos, content });
	}

	function handleMouseLeave(e) {
		if (!tooltip) return;
		hideTooltip(e.target);
	}
</script>

{#snippet controls(pointsData)}
	<div class="control-component">
		<div class="control-component-title">
			<p>Points</p>
			<button
				class="icon"
				type="button"
				aria-label="Show points"
				aria-pressed={!!pointsData.draw}
				onclick={(e) => {
					e.stopPropagation();
					pointsData.draw = !pointsData.draw;
				}}
			>
				{#if !pointsData.draw}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
		</div>
		{#if pointsData.draw}
			<div class="control-input-horizontal">
				<div class="control-input" style="max-width: 1.5rem;">
					<p style="color:white;">Col</p>

					<ColourPicker bind:value={pointsData.colour} />
				</div>
				<ControlInput label="Radius">
					<NumberWithUnits step="0.2" min={0.1} bind:value={pointsData.radius} />
				</ControlInput>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Shape</p>
					<AttributeSelect
						bind:value={pointsData.shape}
						options={POINT_SHAPES}
						optionsDisplay={POINT_SHAPE_LABELS}
					/>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet plot(pointsData)}
	{#if pointsData?.draw}
		{#each paths ?? [] as p (p.key)}
			<path
				d={p.d}
				fill={p.fill}
				stroke="none"
				data-colour-bucket={colourBy ? p.key : undefined}
				style={`transform: translate( ${xoffset}px, ${yoffset}px );`}
				role={tooltip ? 'presentation' : undefined}
				onmousemove={tooltip ? handleHover : undefined}
				onmouseleave={tooltip ? handleMouseLeave : undefined}
			/>
		{/each}
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(pointsData)}
{:else if which === 'controls'}
	{@render controls(pointsData)}
{/if}
