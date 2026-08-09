<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import { viewFontScale, viewStyleFor, scalePadding } from '$lib/plots/viewBox.js';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import Box, { BoxClass, calculateBoxPlotStats } from '$lib/components/plotbits/Box.svelte';
	import Violin from '$lib/components/plotbits/Violin.svelte';
	import { VIOLIN_MIN_N } from '$lib/components/plotbits/helpers/violin.js';
	import { mean, calculateStandardDeviation } from '$lib/utils/MathsStats.js';
	import { min, max } from '$lib/components/plotbits/helpers/wrangleData.js';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';
	import {
		getComparisonWarnings,
		welchTTest,
		oneWayAnova,
		tukeyKramerPostHoc,
		mannWhitneyTwoGroups,
		pairwiseMannWhitney
	} from '$lib/tableProcesses/GroupComparison.svelte';
	import { resolveCssVar } from '$lib/plots/exportStyle.js';

	/**
	 * The neutral swatch the point-colour picker shows while `pointColour` is null
	 * (auto). Read from the design token rather than written as a literal, so the
	 * grey can't drift from the ramp.
	 *
	 * It has to resolve to a real hex, not a `var()` string: ColourPicker parses the
	 * value with a hex regex, and — worse — its `drawPicker` assigns the current
	 * value straight back through the binding, so a `var()` here would be persisted
	 * into `pointColour` (and into saved sessions) the moment a user opens the
	 * picker's advanced panel. Memoised because the token cannot change at runtime.
	 */
	let autoPointSwatch = '';
	function neutralPointSwatch() {
		if (!autoPointSwatch)
			autoPointSwatch =
				resolveCssVar('--color-lightness-55', globalThis.document?.documentElement) || 'gray';
		return autoPointSwatch;
	}

	/**
	 * Round a value outward to a "nice" axis limit.
	 * The step is chosen based on the order of magnitude of the value so that
	 * the resulting limit always encompasses the data value.
	 *
	 * @param {number} value - The raw min or max from the data.
	 * @param {'floor'|'ceil'} direction - 'floor' for the lower limit, 'ceil' for upper.
	 * @returns {number}
	 */
	export function niceAxisLimit(value, direction) {
		if (!isFinite(value)) return value;
		if (value === 0) return 0;

		const abs = Math.abs(value);
		// Pick a "nice" step: the largest of {1, 2, 5} × 10^n that fits below abs
		const mag = Math.pow(10, Math.floor(Math.log10(abs)));
		// Always round to the full leading decade — gives generous outer padding
		const step = mag;

		if (direction === 'floor') {
			return value < 0
				? -Math.ceil(Math.abs(value) / step) * step
				: Math.floor(value / step) * step;
		} else {
			return value < 0
				? -Math.floor(Math.abs(value) / step) * step
				: Math.ceil(value / step) * step;
		}
	}

	export const Boxplot_defaultDataInputs = ['x', 'y'];
	export const Boxplot_controlHeaders = ['Properties', 'Data'];

	// ------ Significance bar helpers ------

	function resolveSigMethod(method, groupCount) {
		if (method === 'kruskal' || method === 'mannwhitney') {
			return groupCount === 2 ? 'mannwhitney' : 'kruskal';
		}
		return groupCount === 2 ? 'ttest' : 'anova';
	}

	/**
	 * Build stat-test group objects from the boxplot's data series.
	 * - If any series has a categorical x column, groups = unique x categories (pooled).
	 * - Otherwise each series becomes one group.
	 */
	function buildSigBarGroups(data, uniqueXValues) {
		const hasCatX = data.some((d) => (d.x.getData()?.length ?? 0) > 0);
		if (!hasCatX) {
			return data.map((d, i) => {
				const values = (d.y.getData() ?? []).filter((v) => v != null && !isNaN(v));
				const n = values.length;
				const m = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;
				const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) : 0;
				return { name: d.label || `Box Plot ${i + 1}`, values, n, mean: m, sd };
			});
		}

		const groupMap = new Map(uniqueXValues.map((v) => [v, []]));
		data.forEach((d) => {
			const xData = d.x.getData() ?? [];
			const yData = d.y.getData() ?? [];
			xData.forEach((cat, i) => {
				const val = yData[i];
				if (cat == null || val == null || isNaN(val)) return;
				if (groupMap.has(cat)) groupMap.get(cat).push(val);
			});
		});

		return uniqueXValues
			.map((cat) => {
				const values = groupMap.get(cat) ?? [];
				const n = values.length;
				const m = n > 0 ? values.reduce((a, b) => a + b, 0) / n : 0;
				const sd = n > 1 ? Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) : 0;
				return { name: String(cat), values, n, mean: m, sd };
			})
			.filter((g) => g.n > 0);
	}

	/**
	 * Run pairwise significance tests and return { pairs, dataMax }.
	 * dataMax is the highest data value across all groups.
	 */
	function runSigBarStats(groups, method, alpha, showNs) {
		if (groups.length < 2) return { pairs: [], dataMax: -Infinity };

		let dataMax = -Infinity;
		groups.forEach((g) => {
			if (g.values.length > 0) {
				const gMax = Math.max(...g.values);
				if (gMax > dataMax) dataMax = gMax;
			}
		});

		const n = groups.length;
		const chosen = resolveSigMethod(method, n);
		let rawPairs = [];
		if (n === 2) {
			const useNonParam = chosen === 'mannwhitney';
			if (useNonParam) {
				const res = mannWhitneyTwoGroups(groups[0], groups[1]);
				if (res.valid)
					rawPairs = [
						{
							groupA: groups[0].name,
							groupB: groups[1].name,
							pValue: res.pValue,
							pAdjusted: res.pValue,
							significant: res.pValue < alpha
						}
					];
			} else {
				const res = welchTTest(groups[0], groups[1], alpha);
				if (res.valid)
					rawPairs = [
						{
							groupA: groups[0].name,
							groupB: groups[1].name,
							pValue: res.pValue,
							pAdjusted: res.pValue,
							significant: res.pValue < alpha
						}
					];
			}
		} else {
			const useNonParam = chosen === 'kruskal';
			if (useNonParam) {
				rawPairs = pairwiseMannWhitney(groups, alpha);
			} else {
				const aRes = oneWayAnova(groups);
				if (aRes.valid) rawPairs = tukeyKramerPostHoc(groups, aRes.msWithin, aRes.dfWithin, alpha);
			}
		}

		const filteredPairs = showNs ? rawPairs : rawPairs.filter((p) => p.significant);
		return { pairs: filteredPairs, dataMax };
	}

	/** Convert an adjusted p-value to a star label. */
	export function formatSigLabel(pAdjusted) {
		if (pAdjusted < 0.001) return '***';
		if (pAdjusted < 0.01) return '**';
		if (pAdjusted < 0.05) return '*';
		return 'ns';
	}

	/**
	 * Assign each pair to the lowest bracket level with no x-range overlap.
	 * Returns entries with { pair, i, j, level }.
	 */
	function assignBracketLevels(pairs, uniqueXValues) {
		const entries = pairs
			.map((p) => {
				const i = uniqueXValues.findIndex((v) => String(v) === p.groupA);
				const j = uniqueXValues.findIndex((v) => String(v) === p.groupB);
				return { pair: p, i: Math.min(i, j), j: Math.max(i, j), level: -1 };
			})
			.filter((e) => e.i >= 0 && e.j >= 0)
			.sort((a, b) => a.j - a.i - (b.j - b.i) || a.i - b.i);

		const levelRanges = [];
		for (const entry of entries) {
			let level = 0;
			while (true) {
				if (!levelRanges[level]) levelRanges[level] = [];
				const blocked = levelRanges[level].some((r) => !(entry.j < r.i || entry.i > r.j));
				if (!blocked) {
					levelRanges[level].push({ i: entry.i, j: entry.j });
					entry.level = level;
					break;
				}
				level++;
			}
		}
		return entries;
	}

	class BoxPlotDataClass {
		static descriptors = {};

		parentPlot = $state();
		x = $state();
		y = $state();
		label = $state('Box Plot');
		boxPlot = $state();

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			if (dataIN?.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				this.x = new ColumnClass({ refId: -1 });
			}

			if (dataIN?.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}

			if (dataIN?.label) {
				this.label = dataIN.label;
			} else {
				this.label = 'Box Plot ' + (parent.data.length + 1);
			}

			this.boxPlot = new BoxClass(dataIN?.boxPlot, this);
		}

		getLegendItem() {
			if (!this.boxPlot.draw) return null;

			return {
				label: this.label,
				elements: [
					{
						type: 'boxplot',
						color: this.boxPlot.colour,
						fillColor: this.boxPlot.fillColour,
						fillOpacity: 1
					}
				]
			};
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				label: this.label,
				boxPlot: this.boxPlot.toJSON()
			};
		}

		static fromJSON(json, parent) {
			return new BoxPlotDataClass(parent, {
				x: json.x,
				y: json.y,
				label: json.label,
				// Pass the RAW boxPlot data and let the constructor build the BoxClass. It already
				// handles a missing slot (defaulting the colour from the palette, with a parent to
				// index it) — whereas BoxClass.fromJSON reads json.colour unguarded and has no
				// parent, so a series without a boxPlot (every AI/tool-emitted boxplot) threw and
				// importJson silently dropped the whole plot. For a normally-saved boxplot this is
				// identical: the constructor reads the same fields off the object either way.
				boxPlot: json.boxPlot
			});
		}
	}

	// Significance-bar type size used to be a hardcoded 11, persisted on every plot.
// Same treatment as the legend size: a saved value EQUAL to that old default was
// never deliberately chosen, so it is released to follow the figure. Any other
// number is a real override and kept.
const LEGACY_SIG_BAR_FONT_SIZE = 11;

/** @param {number | undefined | null} saved */
function releaseLegacySigBarFontSize(saved) {
	if (typeof saved !== 'number' || !Number.isFinite(saved)) return null;
	return saved === LEGACY_SIG_BAR_FONT_SIZE ? null : saved;
}

export class Boxplotclass {
		static descriptors = {
			padding: { group: 'Padding' },
			xlimsIN: { group: 'X-axis', _children: { 0: { label: 'X min' }, 1: { label: 'X max' } } },
			ylimsIN: { group: 'Y-axis', _children: { 0: { label: 'Y min' }, 1: { label: 'Y max' } } },
			showPoints: { group: 'Data points', label: 'Show points' },
			pointJitter: { group: 'Data points', label: 'Jitter', step: 0.05 },
			pointSize: { group: 'Data points', label: 'Point size', step: 0.5 },
			pointOpacity: { group: 'Data points', label: 'Point opacity', step: 0.05 },
			pointColour: { group: 'Data points', label: 'Point colour' },
			showViolin: { group: 'Violin', label: 'Show violin' },
			showBox: { group: 'Violin', label: 'Show box' },
			violinBandwidth: { group: 'Violin', label: 'Bandwidth', step: 0.1 },
			violinWidth: { group: 'Violin', label: 'Width', step: 0.05 },
			violinOpacity: { group: 'Violin', label: 'Opacity', step: 0.05 },
			// Sig-test fields are writable on every Boxplot. Surfacing them in the
			// multi-select panel is an intentional improvement over the old schema,
			// which omitted them.
			showSigBars: { group: 'Sig bars', label: 'Show sig bars' },
			sigMethod: {
				group: 'Sig bars',
				label: 'Sig method',
				input: 'select',
				options: ['auto', 'tukey', 'ttest', 'mannwhitney']
			},
			sigAlpha: { group: 'Sig bars', label: 'Alpha', step: 0.01 },
			showNs: { group: 'Sig bars', label: 'Show n.s.' },
			sigBarThickness: { group: 'Sig bars', label: 'Thickness' },
			sigBarColor: { group: 'Sig bars', label: 'Colour' },
			sigBarFontSize: { group: 'Sig bars', label: 'Font size' },
			sigBarYOffset: { group: 'Sig bars', label: 'Y offset' },
			sigBarSpacing: { group: 'Sig bars', label: 'Spacing' }
		};

		parentBox = $state();
		// Draw at the VIEW's size when one is given (a workflow node), else the figure's own.
		// See plots/viewBox.js for the whole story and why type scales with it.
		renderBox = $state(null);
		viewWidth = $derived(this.renderBox?.w ?? this.parentBox.width);
		viewHeight = $derived(this.renderBox?.h ?? this.parentBox.height);
		fontScale = $derived(viewFontScale(this.renderBox, this.parentBox));
		viewStyle = $derived(viewStyleFor(this.parentBox?.style, this.fontScale));
		data = $state([]);
		legend = $state();

		// Stored padding belongs to the FIGURE. A view that draws the type smaller needs
		// proportionally less room for it, so `padding` reads back SCALED while a renderBox is
		// set; the raw value is what gets saved. See plots/viewBox.js.
		#padding = $state({ top: 15, right: 30, bottom: 30, left: 50 });
		paddingScaled = $derived(scalePadding(this.#padding, this.fontScale));
		get padding() {
			return this.renderBox ? this.paddingScaled : this.#padding;
		}
		set padding(v) {
			this.#padding = v;
		}
		plotheight = $derived(this.viewHeight - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.viewWidth - this.padding.left - this.padding.right);

		xlimsIN = $state([null, null]);
		ylimsIN = $state([null, null]);

		// Overlay the raw data points on each box, with deterministic horizontal
		// jitter (see plotbits/helpers/jitter.js). `pointJitter` is the spread as a
		// fraction of the box half-width (0 = a centred column of points).
		showPoints = $state(false);
		pointJitter = $state(0.35);
		pointSize = $state(2.5); // radius in px
		pointOpacity = $state(0.6);
		// null = auto: points take each box's own colour (per-category or per-series).
		pointColour = $state(null);

		// Violin overlay (see plotbits/Violin.svelte + helpers/violin.js). All
		// defaults chosen so existing sessions render unchanged: violin off, box on.
		// `showBox` false gives a violin-only display (whiskers/median/outliers hide
		// with the box; jittered points and sig bars are independent and stay).
		showViolin = $state(false);
		showBox = $state(true);
		violinBandwidth = $state(null); // null or 0 = Silverman auto
		violinWidth = $state(0.8); // max width as a fraction of the category slot
		violinOpacity = $state(0.3);

		showSigBars = $state(false);
		sigMethod = $state('auto'); // 'auto' | 'anova' | 'kruskal'
		sigAlpha = $state(0.05);
		showNs = $state(false);
		sigBarThickness = $state(1);
		sigBarColor = $state('#000000');
		// null = follow the figure's sig-bar type size. A number is a deliberate
		// override. The old default was a hardcoded 11; a saved 11 is released to follow
		// the figure (see LEGACY_SIG_BAR_FONT_SIZE), and the transitional style's
		// sigBar ratio resolves to exactly 11px, so nothing changes appearance.
		sigBarFontSize = $state(null);
		sigBarYOffset = $state(0);
		sigBarSpacing = $state(1);

		// Get all unique x values across all data series
		uniqueXValues = $derived.by(() => {
			const allXValues = new Set();
			this.data.forEach((d, i) => {
				const xData = d.x.getData() ?? [];
				const yData = d.y.getData() ?? [];

				let addedAny = false;
				if (xData.length > 0) {
					xData.forEach((val, idx) => {
						const yVal = yData[idx];
						if (val != null && yVal != null && !isNaN(yVal)) {
							allXValues.add(val);
							addedAny = true;
						}
					});
				}

				// If no category x data is provided, treat the whole series as one category
				// named by its data label so single-value columns can render one box each.
				if (!addedAny) {
					const hasAnyY = yData.some((v) => v != null && !isNaN(v));
					if (hasAnyY) {
						allXValues.add(d.label || `Box Plot ${i + 1}`);
					}
				}
			});
			return Array.from(allXValues).sort((a, b) => {
				// Safe sort for numbers or strings
				const sa = String(a);
				const sb = String(b);
				if (!isNaN(+sa) && !isNaN(+sb)) return +sa - +sb;
				return sa.localeCompare(sb);
			});
		});

		sigBarResult = $derived.by(() => {
			if (!this.showSigBars) return { pairs: [], dataMax: -Infinity };
			const groups = buildSigBarGroups(this.data, this.uniqueXValues);
			return runSigBarStats(groups, this.sigMethod, this.sigAlpha, this.showNs);
		});

		sigTableResult = $derived.by(() => {
			const groups = buildSigBarGroups(this.data, this.uniqueXValues);
			// Always include non-significant rows in the table, independent of bar plotting.
			return runSigBarStats(groups, this.sigMethod, this.sigAlpha, true);
		});

		sigBarLevels = $derived.by(() => {
			const { pairs } = this.sigBarResult;
			if (pairs.length === 0) return [];
			return assignBracketLevels(pairs, this.uniqueXValues);
		});

		// Groups whose violin is gated (n < VIOLIN_MIN_N, or all values equal so no
		// density exists). Mirrors the per-series grouping the Box/Violin renderers
		// use — a series without category x data is one group named by its label —
		// and feeds the same `.data-warning` pattern the sig bars use.
		violinWarnings = $derived.by(() => {
			if (!this.showViolin) return [];
			const warnings = [];
			this.data.forEach((d, i) => {
				if (!d.boxPlot?.draw) return;
				const xData = d.x.getData() ?? [];
				const yData = d.y.getData() ?? [];
				const groups = new Map();
				if (xData.length > 0) {
					xData.forEach((cat, j) => {
						const val = yData[j];
						if (cat == null || val == null || isNaN(val)) return;
						if (!groups.has(cat)) groups.set(cat, []);
						groups.get(cat).push(val);
					});
				} else {
					const label = d.label || `Box Plot ${i + 1}`;
					const vals = yData.filter((v) => v != null && !isNaN(v));
					if (vals.length > 0) groups.set(label, vals);
				}
				groups.forEach((vals, cat) => {
					if (vals.length < VIOLIN_MIN_N) {
						warnings.push(
							`No violin for "${cat}": only ${vals.length} point${vals.length === 1 ? '' : 's'} (needs at least ${VIOLIN_MIN_N}).`
						);
					} else if (vals.every((v) => v === vals[0])) {
						warnings.push(`No violin for "${cat}": all values are identical.`);
					}
				});
			});
			return warnings;
		});

		sigBarWarnings = $derived.by(() => {
			if (!this.showSigBars) return [];
			const groups = buildSigBarGroups(this.data, this.uniqueXValues);
			if (groups.length < 2) return [];
			return getComparisonWarnings(
				groups,
				resolveSigMethod(this.sigMethod, groups.length),
				this.sigAlpha
			);
		});

		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 10];
			}

			let ymin = Infinity;
			let ymax = -Infinity;

			this.data.forEach((d) => {
				let tempy = d.y.getData() ?? [];
				const validData = tempy.filter((val) => val != null && !isNaN(val));
				if (validData.length > 0) {
					ymin = min([ymin, ...validData]);
					ymax = max([ymax, ...validData]);
				}
			});

			if (ymin === Infinity || ymax === -Infinity) {
				return [0, 10];
			}

			const yBot = this.ylimsIN[0] != null ? this.ylimsIN[0] : niceAxisLimit(ymin, 'floor');
			let yTop = this.ylimsIN[1] != null ? this.ylimsIN[1] : niceAxisLimit(ymax, 'ceil');

			// Extend top to accommodate sig bar brackets when auto-scaling
			if (this.showSigBars && this.ylimsIN[1] == null) {
				const levels = this.sigBarLevels;
				if (levels.length > 0) {
					const { dataMax } = this.sigBarResult;
					const dataRange = yTop - yBot;
					const numLevels = Math.max(...levels.map((e) => e.level)) + 1;
					const base = Number.isFinite(dataMax) ? dataMax : ymax;
					const levelStep = dataRange * 0.1 * this.sigBarSpacing;
					const topNeeded = base + levelStep * (numLevels + 1);
					if (topNeeded > yTop) yTop = niceAxisLimit(topNeeded, 'ceil');
				}
			}

			return [yBot, yTop];
		});

		// X-axis is categorical (0 to n-1 for n unique values)
		xlims = $derived.by(() => {
			const numCategories = this.uniqueXValues.length;
			if (numCategories === 0) {
				return [0, 1];
			}

			return [
				this.xlimsIN[0] != null ? this.xlimsIN[0] : -0.5,
				this.xlimsIN[1] != null ? this.xlimsIN[1] : numCategories - 0.5
			];
		});

		xAxis = $state();
		yAxis = $state();
		sigBarPreviewStart = $state(1);

		getSigBarPreviewPairs(count = 6) {
			const start = Math.max(0, this.sigBarPreviewStart - 1);
			return this.sigTableResult.pairs.slice(start, start + count);
		}

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			this.xAxis = AxisClass.withDefaults(dataIN?.xAxis, { gridlines: false });
			this.yAxis = AxisClass.withDefaults(dataIN?.yAxis);
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };
			const plotRoot = document.getElementById('plot' + this.parentBox.id);
			if (!plotRoot) {
				return axisWidths;
			}
			// getBoundingClientRect() is in SCREEN pixels, magnified by the canvas
			// zoom (the plot renders inside a CSS scale() transform). Padding is in
			// SVG user units, so divide the measured deltas back out by the effective
			// scale — otherwise padding grows with zoom and jumps when re-measured at
			// a different zoom (e.g. when the control panel opens). See Scatterplot.
			const scale =
				Number(plotRoot.getAttribute('width')) > 0
					? plotRoot.getBoundingClientRect().width / Number(plotRoot.getAttribute('width'))
					: 1;

			const allLeftAxes = document
				.getElementById('plot' + this.parentBox.id)
				?.getElementsByClassName('axis-left');

			if (allLeftAxes && allLeftAxes.length > 0) {
				let leftMost = 0;
				let leftAxisWhole = allLeftAxes[0].getBoundingClientRect().left;
				for (let i = 1; i < allLeftAxes.length; i++) {
					if (allLeftAxes[i].getBoundingClientRect().left < leftAxisWhole) {
						leftMost = i;
						leftAxisWhole = allLeftAxes[i].getBoundingClientRect().left;
					}
				}
				// Domain line may be absent during axis re-mount (see #key in Axis.svelte)
				const domain = allLeftAxes[leftMost].getElementsByClassName('domain')[0];
				if (domain) {
					const leftAxisLine = domain.getBoundingClientRect().left;
					axisWidths.left = Math.round((leftAxisLine - leftAxisWhole) / scale + 6);
				}
			}

			const allBottomAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-bottom');

			if (allBottomAxes && allBottomAxes.length > 0) {
				let bottomMost = 0;
				let bottomAxisWhole = allBottomAxes[0].getBoundingClientRect().bottom;
				for (let i = 1; i < allBottomAxes.length; i++) {
					if (allBottomAxes[i].getBoundingClientRect().bottom > bottomAxisWhole) {
						bottomMost = i;
						bottomAxisWhole = allBottomAxes[i].getBoundingClientRect().bottom;
					}
				}
				const domain = allBottomAxes[bottomMost].getElementsByClassName('domain')[0];
				if (domain) {
					const bottomAxisLine = domain.getBoundingClientRect().bottom;
					axisWidths.bottom = Math.round((bottomAxisWhole - bottomAxisLine) / scale + 12);
				}
			}

			return axisWidths;
		}

		autoScalePadding(side) {
			// Never from a NODE. `padding` is a property of the FIGURE, and a node draws the
			// plot smaller with type scaled to match, so margins measured there describe the
			// node, not the figure. Letting it write would redefine the figure's margins from
			// whichever view happened to mount last.
			if (this.renderBox) return;
			if (side == 'all') {
				['top', 'left', 'right', 'bottom'].forEach((theSide) => {
					this.padding[theSide] = this.getAutoScaleValues()[theSide] || this.padding[theSide];
				});
			} else {
				this.padding[side] = this.getAutoScaleValues()[side];
			}
		}

		addData(dataIN) {
			this.data.push(new BoxPlotDataClass(this, dataIN));
		}

		removeData(idx) {
			this.data.splice(idx, 1);
		}

		getLegendItems = $derived.by(() => {
			const items = [];
			this.data.forEach((datum) => {
				const legendItem = datum.getLegendItem();
				if (legendItem) {
					items.push(legendItem);
				}
			});
			return items;
		});

		getDownloadData() {
			const allCategories = [...this.uniqueXValues];
			const multiSeries = this.data.length > 1;

			// Compute stats for every series × category up front
			const seriesStats = this.data.map((datum, d) => {
				const label = datum.label || `Data ${d}`;
				const xData = datum.x.getData() ?? [];
				const yData = datum.y.getData() ?? [];
				const groups = new Map();
				xData.forEach((cat, i) => {
					const val = yData[i];
					if (cat == null || val == null || isNaN(val)) return;
					if (!groups.has(cat)) groups.set(cat, []);
					groups.get(cat).push(val);
				});

				if (groups.size === 0) {
					yData.forEach((val) => {
						if (val == null || isNaN(val)) return;
						const fallbackCategory = label;
						if (!groups.has(fallbackCategory)) groups.set(fallbackCategory, []);
						groups.get(fallbackCategory).push(val);
					});
				}
				// Pre-compute stats per category
				const statsMap = new Map();
				allCategories.forEach((cat) => {
					const vals = groups.get(cat) ?? [];
					const box = calculateBoxPlotStats(vals, {
						method: datum.boxPlot.outlierMethod,
						iqrMultiplier: datum.boxPlot.iqrMultiplier,
						zThreshold: datum.boxPlot.zThreshold
					});
					if (!box || vals.length === 0) {
						statsMap.set(cat, null);
						return;
					}
					const validVals = vals.filter((v) => v != null && !isNaN(v));
					statsMap.set(cat, {
						count: validVals.length,
						mean: mean(validVals),
						std: calculateStandardDeviation(validVals),
						min: box.min,
						q1: box.q1,
						median: box.q2,
						q3: box.q3,
						max: box.max,
						outliers: box.outliers
					});
				});
				return { label, statsMap };
			});

			// Find the maximum number of outliers across all series × categories
			let maxOutliers = 0;
			seriesStats.forEach(({ statsMap }) => {
				statsMap.forEach((s) => {
					if (s) maxOutliers = Math.max(maxOutliers, s.outliers.length);
				});
			});

			const statKeys = [
				'count',
				'mean',
				'std',
				'min',
				'25%',
				'50%',
				'75%',
				'max',
				'n_outliers',
				...Array.from({ length: maxOutliers }, (_, i) => `outlier_${i + 1}`)
			];

			const headers = multiSeries
				? ['DataSeries', 'Stat', ...allCategories.map(String)]
				: ['Stat', ...allCategories.map(String)];

			const rows = [];
			seriesStats.forEach(({ label, statsMap }) => {
				statKeys.forEach((key) => {
					const row = multiSeries ? [label, key] : [key];
					allCategories.forEach((cat) => {
						const s = statsMap.get(cat);
						if (!s) {
							row.push('');
							return;
						}
						switch (key) {
							case 'count':
								row.push(s.count);
								break;
							case 'mean':
								row.push(s.mean);
								break;
							case 'std':
								row.push(s.std);
								break;
							case 'min':
								row.push(s.min);
								break;
							case '25%':
								row.push(s.q1);
								break;
							case '50%':
								row.push(s.median);
								break;
							case '75%':
								row.push(s.q3);
								break;
							case 'max':
								row.push(s.max);
								break;
							case 'n_outliers':
								row.push(s.outliers.length);
								break;
							default: {
								const idx = parseInt(key.split('_')[1]) - 1;
								row.push(s.outliers[idx] ?? '');
							}
						}
					});
					rows.push(row);
				});
			});

			return { headers, rows };
		}

		toJSON() {
			return {
				xlimsIN: this.xlimsIN,
				ylimsIN: this.ylimsIN,
				padding: this.#padding,
				xAxis: this.xAxis.toJSON(),
				yAxis: this.yAxis.toJSON(),
				data: this.data,
				legend: this.legend.toJSON(),
				showPoints: this.showPoints,
				pointJitter: this.pointJitter,
				pointSize: this.pointSize,
				pointOpacity: this.pointOpacity,
				pointColour: this.pointColour,
				showViolin: this.showViolin,
				showBox: this.showBox,
				violinBandwidth: this.violinBandwidth,
				violinWidth: this.violinWidth,
				violinOpacity: this.violinOpacity,
				showSigBars: this.showSigBars,
				sigMethod: this.sigMethod,
				sigAlpha: this.sigAlpha,
				showNs: this.showNs,
				sigBarThickness: this.sigBarThickness,
				sigBarColor: this.sigBarColor,
				sigBarFontSize: this.sigBarFontSize,
				sigBarYOffset: this.sigBarYOffset,
				sigBarSpacing: this.sigBarSpacing
			};
		}

		static fromJSON(parent, json) {
			if (!json) {
				return new Boxplotclass(parent, null);
			}

			const chart = new Boxplotclass(parent, null);
			// Keep the constructor defaults when a field is absent — a partial inner
			// (e.g. a Quick-Plot spawn passing just `{ data }`) must still yield valid
			// layout, or plotheight reads `undefined.top`. Mirrors CircularPhase.
			chart.padding = json.padding ?? chart.padding;
			chart.xlimsIN = json.xlimsIN ?? chart.xlimsIN;
			chart.ylimsIN = json.ylimsIN ?? chart.ylimsIN;

			// Support both new AxisClass format and old individual properties
			if (json.xAxis) {
				chart.xAxis = AxisClass.fromJSON(json.xAxis);
			} else {
				chart.xAxis = new AxisClass({
					label: json.xlabel ?? '',
					gridlines: json.xgridlines ?? false
				});
			}
			if (json.yAxis) {
				chart.yAxis = AxisClass.fromJSON(json.yAxis);
			} else {
				chart.yAxis = new AxisClass({
					label: json.ylabel ?? '',
					gridlines: json.ygridlines ?? true
				});
			}

			if (json.data) {
				chart.data = json.data.map((d) => BoxPlotDataClass.fromJSON(d, chart));
			} else if (json.dataIn) {
				// Creation-time hint: wire raw column refs via the live addData path so
				// undo/redo of a brand-new plot replays its data wiring (see addPlot op).
				chart.addData(json.dataIn);
			}

			chart.legend = LegendClass.fromJSON(json.legend);
			chart.showPoints = json.showPoints ?? false;
			chart.pointJitter = json.pointJitter ?? 0.35;
			chart.pointSize = json.pointSize ?? 2.5;
			chart.pointOpacity = json.pointOpacity ?? 0.6;
			chart.pointColour = json.pointColour ?? null;
			chart.showViolin = json.showViolin ?? false;
			chart.showBox = json.showBox ?? true;
			// `??` keeps a saved 0 (explicit "auto"), while a missing field stays null;
			// both mean Silverman auto at compute time but the user's entry round-trips.
			chart.violinBandwidth = json.violinBandwidth ?? null;
			chart.violinWidth = json.violinWidth ?? 0.8;
			chart.violinOpacity = json.violinOpacity ?? 0.3;
			chart.showSigBars = json.showSigBars ?? false;
			chart.sigMethod = json.sigMethod ?? 'auto';
			chart.sigAlpha = json.sigAlpha ?? 0.05;
			chart.showNs = json.showNs ?? false;
			chart.sigBarThickness = json.sigBarThickness ?? 1;
			chart.sigBarColor = json.sigBarColor ?? '#000000';
			chart.sigBarFontSize = releaseLegacySigBarFontSize(json.sigBarFontSize);
			chart.sigBarYOffset = json.sigBarYOffset ?? 0;
			chart.sigBarSpacing = json.sigBarSpacing ?? 1;
			return chart;
		}
	}

	export const definition = {
		defaultDataInputs: Boxplot_defaultDataInputs,
		controlHeaders: Boxplot_controlHeaders,
		optionalDataInputs: ['x'],
		plotClass: Boxplotclass
	};
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { appState } from '$lib/core/core.svelte';
	import { resolveStyle } from '$lib/plots/figureStyle.js';

	// Mirror for the sig-bar size control: shows the size actually drawn (inherited
	// from the figure, or overridden) and only writes an override on a real edit. See
	// the matching note in Legend.svelte for why binding the nullable field directly
	// was unsafe.
	let sigBarSizeInput = $state(0);
	$effect(() => {
		const eff =
			theData?.sigBarFontSize ??
			resolveStyle(theData?.parentBox?.style ?? theData?.plot?.parentBox?.style).sizes.sigBar;
		sigBarSizeInput = Math.round(eff * 10) / 10;
	});
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import { bindAltTooltipToggle } from '$lib/components/plotbits/helpers/tooltipHelpers.js';
	import PlotTooltip from '$lib/components/plotbits/PlotTooltip.svelte';

	let { theData, which } = $props();

	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	const handleTooltip = bindAltTooltipToggle(
		() => tooltip,
		(v) => {
			tooltip = v;
		}
	);

	onMount(() => {
		if (which == 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});

	$effect(() => {
		if (which == 'controls') {
			theData.yAxis.label;
			theData.xAxis.label;
			theData.ylims;
			theData.xlims;

			theData.autoScalePadding('all');
		}
		//console.log($state.snapshot(theData.data));
	});

	// Custom tick values for x-axis to show actual unique x values
	function getXAxisTickValues(uniqueXValues) {
		return uniqueXValues.map((val, i) => ({ position: i, label: String(val) }));
	}

	function formatCategoryTick(value, categories) {
		const idx = Math.round(Number(value));
		if (!Number.isFinite(idx) || idx < 0 || idx >= categories.length) return '';
		return String(categories[idx]);
	}

	function hasCategoryXData(datum) {
		return (datum.x.getData()?.length ?? 0) > 0;
	}

	function xDataForDatum(datum, idx) {
		if (hasCategoryXData(datum)) return datum.x.getData() ?? [];
		return new Array((datum.y.getData() ?? []).length).fill(datum.label || `Box Plot ${idx + 1}`);
	}

	function getManualCategoryTicks(categories) {
		return categories.map((_, i) => i);
	}

	function getXAxisForManualCategories(axisData, categories) {
		return {
			label: axisData.label,
			gridlines: false,
			nticks: categories.length,
			manualTicks: getManualCategoryTicks(categories)
		};
	}
</script>

{#snippet controls(theData)}
	{#if appState.currentControlTab === 'properties'}

		<div class="div-line"></div>

		<Legend
			legendData={theData.legend}
			figureStyle={theData.parentBox?.style}
			which="controls"
		/>

		<div class="control-component">
			<div class="control-component-title">
				<p>Padding</p>
			</div>
			<div class="control-input-square">
				<ControlInput label="Top">
					<NumberWithUnits bind:value={theData.padding.top} />
				</ControlInput>

				<ControlInput label="Bottom">
					<NumberWithUnits bind:value={theData.padding.bottom} />
				</ControlInput>

				<ControlInput label="Left">
					<NumberWithUnits bind:value={theData.padding.left} />
				</ControlInput>

				<ControlInput label="Right">
					<NumberWithUnits bind:value={theData.padding.right} />
				</ControlInput>
			</div>
		</div>

		<div class="div-line"></div>

		<Axis axisData={theData.yAxis} which="controls" title="Y-Axis" />

		<div class="control-component">
			<div class="control-input-horizontal">
				<ControlInput label="Min">
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = parseFloat(val);
						}}
					/>
				</ControlInput>

				<ControlInput label="Max">
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = parseFloat(val);
						}}
					/>
				</ControlInput>

				{#if theData.ylimsIN[0] != null || theData.ylimsIN[1] != null}
					<div class="control-component-input-icons">
						<button class="icon" onclick={() => (theData.ylimsIN = [null, null])}>
							<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
						</button>
					</div>
				{/if}
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis</p>
			</div>
			<div class="control-input-vertical">
				<ControlInput label="Label">
					<input bind:value={theData.xAxis.label} />
				</ControlInput>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Data points</p>
			</div>
			<div class="control-input-vertical">
				<ControlInput label="Show">
					<input type="checkbox" bind:checked={theData.showPoints} />
				</ControlInput>
				{#if theData.showPoints}
					<!-- Tuning knobs live behind a collapsed-by-default disclosure. The app's
					     collapse system (views/collapsibleSections.svelte.js) folds whole
					     sections by title and has no per-field advanced tier, so this reuses
					     the panel's existing <details> pattern (see "Pairwise comparisons"
					     below) as the advanced area. -->
					<details class="tp-output-panel">
						<summary class="tp-output-summary">Advanced</summary>
						<ControlInput label="Jitter">
							<NumberWithUnits bind:value={theData.pointJitter} step={0.05} min={0} max={1} />
						</ControlInput>
						<div class="control-input-horizontal">
							<ControlInput label="Size">
								<NumberWithUnits bind:value={theData.pointSize} step={0.5} min={1} max={6} />
							</ControlInput>
							<ControlInput label="Opacity">
								<NumberWithUnits bind:value={theData.pointOpacity} step={0.05} min={0.1} max={1} />
							</ControlInput>
						</div>
						<!-- null = auto: points take each box's own colour (per-category or
						     per-series). An explicit pick applies to ALL points; the reset
						     icon (same pattern as the axis-limit overrides above) restores
						     auto. Function binding so the picker can show a neutral colour
						     while the field is null without writing to it. -->
						<ControlInput label="Colour">
							<ColourPicker
								bind:value={
									() => theData.pointColour ?? neutralPointSwatch(),
									(v) => (theData.pointColour = v)
								}
							/>
							{#if theData.pointColour != null}
								<div class="control-component-input-icons">
									<button class="icon" onclick={() => (theData.pointColour = null)}>
										<Icon
											name="reset"
											width={14}
											height={14}
											className="control-component-input-icon"
										/>
									</button>
								</div>
							{/if}
						</ControlInput>
					</details>
				{/if}
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Violin</p>
			</div>
			<div class="control-input-vertical">
				<ControlInput label="Show violin">
					<input type="checkbox" bind:checked={theData.showViolin} />
				</ControlInput>
				{#if theData.showViolin}
					<!-- Warnings stay OUTSIDE the collapsed fine-tuning area: a gated group
					     must be visible without expanding anything. -->
					{#if theData.violinWarnings.length > 0}
						<div class="data-warning">
							{#each theData.violinWarnings as warning}
								<p>⚠ {warning}</p>
							{/each}
						</div>
					{/if}
					<details class="tp-output-panel">
						<summary class="tp-output-summary">Advanced</summary>
						<ControlInput label="Bandwidth">
							<!-- Empty / 0 means automatic (Silverman) — the Histogram's convention. -->
							<input
								type="number"
								step="0.1"
								min="0"
								placeholder="auto"
								value={theData.violinBandwidth ?? ''}
								oninput={(e) => {
									const n = parseFloat(e.currentTarget.value);
									theData.violinBandwidth = isNaN(n) || n <= 0 ? null : n;
								}}
							/>
						</ControlInput>
						<div class="control-input-horizontal">
							<ControlInput label="Width">
								<NumberWithUnits bind:value={theData.violinWidth} step={0.05} min={0.1} max={1} />
							</ControlInput>
							<ControlInput label="Opacity">
								<NumberWithUnits bind:value={theData.violinOpacity} step={0.05} min={0.05} max={1} />
							</ControlInput>
						</div>
					</details>
				{/if}
				<!-- Plot-level box toggle: off + violin on = a violin-only display.
				     Whiskers, median and outlier rings hide with the box; the jittered
				     points and the sig bars (which key off group stats, not box
				     geometry) keep working. -->
				<ControlInput label="Show box">
					<input type="checkbox" bind:checked={theData.showBox} />
				</ControlInput>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Significance bars</p>
			</div>
			<div class="control-input-vertical">
				<ControlInput label="Show">
					<input type="checkbox" bind:checked={theData.showSigBars} />
				</ControlInput>
				<ControlInput label="Method">
					<select bind:value={theData.sigMethod}>
						<option value="auto">Auto (t-test / ANOVA)</option>
						<option value="kruskal">Kruskal-Wallis / Mann-Whitney</option>
					</select>
				</ControlInput>
				<ControlInput label="α">
					<NumberWithUnits bind:value={theData.sigAlpha} step={0.01} />
				</ControlInput>
				{#if theData.showSigBars}
					<ControlInput label="Show ns">
						<input type="checkbox" bind:checked={theData.showNs} />
					</ControlInput>
					<div class="control-input-horizontal">
						<div class="control-input" style="max-width: 1.5rem;">
							<p>Bar Colour</p>
							<ColourPicker bind:value={theData.sigBarColor} />
						</div>
						<ControlInput label="Thickness">
							<NumberWithUnits bind:value={theData.sigBarThickness} step={0.1} min={0.1} />
						</ControlInput>
					</div>
					<div class="control-input-horizontal">
						<ControlInput label="Font Size">
							<NumberWithUnits
								bind:value={sigBarSizeInput}
								step={0.5}
								min={4}
								max={48}
								onInput={() => (theData.sigBarFontSize = sigBarSizeInput)}
							/>
						</ControlInput>
						<ControlInput label="Spread">
							<NumberWithUnits bind:value={theData.sigBarSpacing} step={0.1} min={0.1} />
						</ControlInput>
					</div>
					<div class="control-input-horizontal">
						<ControlInput label="Y Offset">
							<NumberWithUnits bind:value={theData.sigBarYOffset} step={1} />
						</ControlInput>
					</div>
					{#if theData.sigBarWarnings.length > 0}
						<div class="data-warning">
							{#each theData.sigBarWarnings as warning}
								<p>⚠ {warning}</p>
							{/each}
						</div>
					{/if}
				{/if}

				{#if theData.sigTableResult.pairs.length > 0}
					<details class="tp-output-panel">
						<summary class="tp-output-summary">Pairwise comparisons</summary>
						{#each theData.getSigBarPreviewPairs() as pair}
							<div class="control-input-horizontal">
								<div class="control-input">
									<p><strong>{pair.groupA}</strong> vs <strong>{pair.groupB}</strong></p>
									<p>
										<strong>p-value:</strong>
										{Number.isFinite(pair.pValue) ? pair.pValue.toPrecision(4) : 'NaN'}
									</p>
									<p>
										<strong>p-adjusted:</strong>
										{Number.isFinite(pair.pAdjusted) ? pair.pAdjusted.toPrecision(4) : 'NaN'}
									</p>
									<p>
										<strong>Significant:</strong>
										{pair.significant ? 'Yes' : 'No'}
									</p>
								</div>
							</div>
						{/each}
					</details>
				{/if}
			</div>
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<div class="add">
					<button
						class="icon"
						onclick={async () => {
							theData.addData({
								x: null,
								y: null
							});

							await tick();
							dataSettingsScrollTo('bottom');
						}}
					>
						<Icon name="add" width={16} height={16} />
					</button>
				</div>
			</div>

			{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
				<div
					class="dataBlock"
					animate:flip={{ duration: 500 }}
					in:slide={{ duration: 500, axis: 'y' }}
					out:slide={{ duration: 500, axis: 'y' }}
				>
					<div class="control-component-title">
						<p><Editable bind:value={datum.label} /></p>

						<button class="icon" onclick={() => theData.removeData(i)}>
							<Icon name="trash" width={16} height={16} className="control-component-title-icon" />
						</button>
					</div>

					<div class="data-wrapper">
						<div class="y-select">
							<ControlInput label="x (categories, optional)">
							</ControlInput>
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
							<ControlInput label="y (values)">
							</ControlInput>
							<Column col={datum.y} canChange={true} />
						</div>

						<Box
							boxPlotData={datum.boxPlot}
							x={xDataForDatum(datum, i)}
							y={datum.y.getData() ?? []}
							uniqueXValues={theData.uniqueXValues}
							seriesIndex={i}
							totalSeries={theData.data.length}
							dodgeEnabled={hasCategoryXData(datum)}
							xscale={scaleLinear()
								.domain([theData.xlims[0], theData.xlims[1]])
								.range([0, theData.plotwidth])}
							yscale={scaleLinear()
								.domain([theData.ylims[0], theData.ylims[1]])
								.range([theData.plotheight, 0])}
							xoffset={0}
							yoffset={0}
							which="controls"
						/>
					</div>
					<div class="div-line"></div>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.viewWidth}
		height={theData.plot.viewHeight}
		viewBox="0 0 {theData.plot.viewWidth} {theData.plot.viewHeight}"
		style={`background: var(--surface-card); position: absolute;`}
		ontooltip={handleTooltip}
	>
		<!-- Y-axis -->
		<Axis
			figureStyle={theData.plot.viewStyle}
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])}
			position="left"
			plotPadding={theData.plot.padding}
			axisData={theData.plot.yAxis}
			which="plot"
		/>

		<!-- X-axis with custom categorical labels -->
		<Axis
			figureStyle={theData.plot.viewStyle}
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			plotPadding={theData.plot.padding}
			axisData={getXAxisForManualCategories(theData.plot.xAxis, theData.plot.uniqueXValues)}
			tickFormat={(d) => formatCategoryTick(d, theData.plot.uniqueXValues)}
			which="plot"
		/>

		<!-- Violin overlays: rendered BEFORE the boxes so every violin sits behind
		     every box, median line, and jittered point. -->
		{#if theData.plot.showViolin}
			{#each theData.plot.data as datum, i}
				{#if datum.y.getData()?.length > 0}
					<Violin
						boxPlotData={datum.boxPlot}
						x={xDataForDatum(datum, i)}
						y={datum.y.getData() ?? []}
						uniqueXValues={theData.plot.uniqueXValues}
						useCategoryColour={theData.plot.data.length === 1 &&
							theData.plot.uniqueXValues.length > 1 &&
							hasCategoryXData(datum)}
						monochrome={theData.plot.parentBox?.style?.monochrome === true}
						seriesIndex={i}
						totalSeries={theData.plot.data.length}
						dodgeEnabled={hasCategoryXData(datum)}
						bandwidth={theData.plot.violinBandwidth}
						violinWidth={theData.plot.violinWidth}
						violinOpacity={theData.plot.violinOpacity}
						xscale={scaleLinear()
							.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
							.range([0, theData.plot.plotwidth])}
						yscale={scaleLinear()
							.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
							.range([theData.plot.plotheight, 0])}
						xoffset={theData.plot.padding.left}
						yoffset={theData.plot.padding.top}
					/>
				{/if}
			{/each}
		{/if}

		<!-- Box plots -->
		{#each theData.plot.data as datum, i}
			{#if datum.y.getData()?.length > 0}
				{@const xScale = scaleLinear()
					.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
					.range([0, theData.plot.plotwidth])}
				{@const yScale = scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}

				<Box
					boxPlotData={datum.boxPlot}
					x={xDataForDatum(datum, i)}
					y={datum.y.getData() ?? []}
					uniqueXValues={theData.plot.uniqueXValues}
					useCategoryColour={theData.plot.data.length === 1 &&
						theData.plot.uniqueXValues.length > 1 &&
						hasCategoryXData(datum)}
					monochrome={theData.plot.parentBox?.style?.monochrome === true}
					seriesIndex={i}
					totalSeries={theData.plot.data.length}
					dodgeEnabled={hasCategoryXData(datum)}
					showPoints={theData.plot.showPoints}
					pointJitter={theData.plot.pointJitter}
					pointSize={theData.plot.pointSize}
					pointOpacity={theData.plot.pointOpacity}
					pointColour={theData.plot.pointColour}
					showBox={theData.plot.showBox}
					xscale={xScale}
					yscale={yScale}
					xoffset={theData.plot.padding.left}
					yoffset={theData.plot.padding.top}
					which="plot"
				/>
			{/if}
		{/each}

		<Legend
			figureStyle={theData.plot.viewStyle}
			legendData={theData.plot.legend}
			items={theData.plot.getLegendItems}
			plotWidth={theData.plot.plotwidth}
			plotHeight={theData.plot.plotheight}
			padding={theData.plot.padding}
			which="plot"
		/>

		<!-- Significance brackets -->
		{#if theData.plot.showSigBars && theData.plot.sigBarLevels.length > 0}
			{@const sigXScale = scaleLinear()
				.domain([theData.plot.xlims[0], theData.plot.xlims[1]])
				.range([0, theData.plot.plotwidth])}
			{@const sigYScale = scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])}
			{@const { dataMax } = theData.plot.sigBarResult}
			{@const dataRange = theData.plot.ylims[1] - theData.plot.ylims[0]}
			{@const levelStep = dataRange * 0.1 * theData.plot.sigBarSpacing}
			{#each theData.plot.sigBarLevels as entry}
				{@const xi = sigXScale(entry.i) + theData.plot.padding.left}
				{@const xj = sigXScale(entry.j) + theData.plot.padding.left}
				{@const barYData =
					(Number.isFinite(dataMax) ? dataMax : theData.plot.ylims[1]) +
					levelStep * (entry.level + 1)}
				{@const barY = sigYScale(barYData) + theData.plot.padding.top + theData.plot.sigBarYOffset}
				<line
					x1={xi}
					y1={barY + 4}
					x2={xi}
					y2={barY}
					stroke={theData.plot.sigBarColor}
					stroke-width={theData.plot.sigBarThickness}
				/>
				<line
					x1={xi}
					y1={barY}
					x2={xj}
					y2={barY}
					stroke={theData.plot.sigBarColor}
					stroke-width={theData.plot.sigBarThickness}
				/>
				<line
					x1={xj}
					y1={barY}
					x2={xj}
					y2={barY + 4}
					stroke={theData.plot.sigBarColor}
					stroke-width={theData.plot.sigBarThickness}
				/>
				{@const sigFont =
					theData.plot.sigBarFontSize ??
					resolveStyle(theData.plot.parentBox?.style).sizes.sigBar}
				<text
					x={(xi + xj) / 2}
					y={barY + sigFont / 3 - 2}
					text-anchor="middle"
					font-size={sigFont}
					fill={theData.plot.sigBarColor}
				>
					{formatSigLabel(entry.pair.pAdjusted)}</text
				>
			{/each}
		{/if}
	</svg>

	<PlotTooltip visible={tooltip.visible} x={tooltip.x} y={tooltip.y} content={tooltip.content} />
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}

<style>
	.data-warning {
		margin-top: 0.4rem;
		padding: 0.45rem 0.6rem;
		border-radius: 0.375rem;
		background: color-mix(in srgb, #f5c76a 18%, white);
		border: 1px solid color-mix(in srgb, #d89c1b 35%, white);
	}

	.data-warning p {
		margin: 0.15rem 0;
		font-size: 0.92em;
	}

	.tp-output-panel {
		margin-top: 0.6rem;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--stroke2, var(--color-lightness-85));
		border-radius: 0.375rem;
		background: var(--color-lightness-99);
		font-size: var(--font-xs);
		line-height: 1.25;
	}

	.tp-output-panel[open] {
		max-height: 12rem;
		overflow-y: auto;
		scrollbar-gutter: stable;
	}

	.tp-output-summary {
		cursor: pointer;
		font-weight: 600;
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--color-lightness-99);
		padding: 0.1rem 0;
	}
</style>
