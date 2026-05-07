<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import Box, { BoxClass, calculateBoxPlotStats } from '$lib/components/plotbits/Box.svelte';
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
						fillOpacity: this.boxPlot.fillOpacity
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
				boxPlot: BoxClass.fromJSON(json.boxPlot)
			});
		}
	}

	export class Boxplotclass {
		parentBox = $state();
		data = $state([]);
		legend = $state();

		padding = $state({ top: 15, right: 30, bottom: 30, left: 50 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		xlimsIN = $state([null, null]);
		ylimsIN = $state([null, null]);

		showSigBars = $state(false);
		sigMethod = $state('auto'); // 'auto' | 'anova' | 'kruskal'
		sigAlpha = $state(0.05);
		showNs = $state(false);

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

		sigBarLevels = $derived.by(() => {
			const { pairs } = this.sigBarResult;
			if (pairs.length === 0) return [];
			return assignBracketLevels(pairs, this.uniqueXValues);
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
					const topNeeded = base + dataRange * 0.1 * (numLevels + 1);
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
			return this.sigBarResult.pairs.slice(start, start + count);
		}

		constructor(parent, dataIN) {
			this.parentBox = parent;
			this.legend = new LegendClass(dataIN?.legend);
			this.xAxis = new AxisClass({
				label: dataIN?.xAxis?.label ?? '',
				gridlines: dataIN?.xAxis?.gridlines ?? false,
				nticks: dataIN?.xAxis?.nticks ?? 5
			});
			this.yAxis = new AxisClass({
				label: dataIN?.yAxis?.label ?? '',
				gridlines: dataIN?.yAxis?.gridlines ?? true,
				nticks: dataIN?.yAxis?.nticks ?? 5
			});
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };
			if (!document.getElementById('plot' + this.parentBox.id)) {
				return axisWidths;
			}

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
					axisWidths.left = Math.round(leftAxisLine - leftAxisWhole + 6);
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
					axisWidths.bottom = Math.round(bottomAxisWhole - bottomAxisLine + 12);
				}
			}

			return axisWidths;
		}

		autoScalePadding(side) {
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
					const box = calculateBoxPlotStats(vals);
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
				padding: this.padding,
				xAxis: this.xAxis.toJSON(),
				yAxis: this.yAxis.toJSON(),
				data: this.data,
				legend: this.legend.toJSON(),
				showSigBars: this.showSigBars,
				sigMethod: this.sigMethod,
				sigAlpha: this.sigAlpha,
				showNs: this.showNs
			};
		}

		static fromJSON(parent, json) {
			if (!json) {
				return new Boxplotclass(parent, null);
			}

			const chart = new Boxplotclass(parent, null);
			chart.padding = json.padding;
			chart.xlimsIN = json.xlimsIN;
			chart.ylimsIN = json.ylimsIN;

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
			}

			chart.legend = LegendClass.fromJSON(json.legend);
			chart.showSigBars = json.showSigBars ?? false;
			chart.sigMethod = json.sigMethod ?? 'auto';
			chart.sigAlpha = json.sigAlpha ?? 0.05;
			chart.showNs = json.showNs ?? false;
			return chart;
		}
	}

	export const Boxplot_sharedFields = [
		{ path: 'width', label: 'Width', input: 'number', group: 'Dimension' },
		{ path: 'height', label: 'Height', input: 'number', group: 'Dimension' },

		{ path: 'plot.padding.top', label: 'Top', input: 'number', group: 'Padding' },
		{ path: 'plot.padding.bottom', label: 'Bottom', input: 'number', group: 'Padding' },
		{ path: 'plot.padding.left', label: 'Left', input: 'number', group: 'Padding' },
		{ path: 'plot.padding.right', label: 'Right', input: 'number', group: 'Padding' },

		{ path: 'plot.ylimsIN[0]', label: 'Y min', input: 'number', group: 'Y-axis' },
		{ path: 'plot.ylimsIN[1]', label: 'Y max', input: 'number', group: 'Y-axis' }
	];

	export const Boxplot_dataSharedFields = [{ path: 'label', label: 'Label', input: 'text' }];

	export const definition = {
		defaultDataInputs: Boxplot_defaultDataInputs,
		controlHeaders: Boxplot_controlHeaders,
		optionalDataInputs: ['x'],
		plotClass: Boxplotclass,
		sharedFields: Boxplot_sharedFields,
		dataSharedFields: Boxplot_dataSharedFields
	};
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { appState } from '$lib/core/core.svelte';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';
	import Legend, { LegendClass } from '$lib/components/plotbits/Legend.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import { bindAltTooltipToggle } from '$lib/components/plotbits/helpers/tooltipHelpers.js';

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
		<div class="control-component">
			<div class="control-component-title">
				<p>Dimension</p>
			</div>
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Width</p>
					<NumberWithUnits bind:value={theData.parentBox.width} />
				</div>

				<div class="control-input">
					<p>Height</p>
					<NumberWithUnits bind:value={theData.parentBox.height} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<Legend legendData={theData.legend} which="controls" />

		<div class="control-component">
			<div class="control-component-title">
				<p>Padding</p>
			</div>
			<div class="control-input-square">
				<div class="control-input">
					<p>Top</p>
					<NumberWithUnits bind:value={theData.padding.top} />
				</div>

				<div class="control-input">
					<p>Bottom</p>
					<NumberWithUnits bind:value={theData.padding.bottom} />
				</div>

				<div class="control-input">
					<p>Left</p>
					<NumberWithUnits bind:value={theData.padding.left} />
				</div>

				<div class="control-input">
					<p>Right</p>
					<NumberWithUnits bind:value={theData.padding.right} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<Axis axisData={theData.yAxis} which="controls" title="Y-Axis" />

		<div class="control-component">
			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = parseFloat(val);
						}}
					/>
				</div>

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
				<div class="control-input">
					<p>Label</p>
					<input bind:value={theData.xAxis.label} />
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Significance bars</p>
			</div>
			<div class="control-input-vertical">
				<div class="control-input">
					<p>Show</p>
					<input type="checkbox" bind:checked={theData.showSigBars} />
				</div>
				{#if theData.showSigBars}
					<div class="control-input">
						<p>Method</p>
						<select bind:value={theData.sigMethod}>
							<option value="auto">Auto (t-test / ANOVA)</option>
							<option value="kruskal">Kruskal-Wallis / Mann-Whitney</option>
						</select>
					</div>
					<div class="control-input">
						<p>α</p>
						<NumberWithUnits bind:value={theData.sigAlpha} step={0.01} />
					</div>
					<div class="control-input">
						<p>Show ns</p>
						<input type="checkbox" bind:checked={theData.showNs} />
					</div>
					{#if theData.sigBarWarnings.length > 0}
						<div class="data-warning">
							{#each theData.sigBarWarnings as warning}
								<p>⚠ {warning}</p>
							{/each}
						</div>
					{/if}

					{#if theData.sigBarResult.pairs.length > 0}
						<details class="tp-output-panel">
							<summary class="tp-output-summary">Pairwise comparisons</summary>
							{#each theData.getSigBarPreviewPairs() as pair}
								<div class="tp-value-block">
									<p><strong>{pair.groupA}</strong> vs <strong>{pair.groupB}</strong></p>
									<p><span class="tp-value-key">p-value:</span> {Number.isFinite(pair.pValue)
										? pair.pValue.toPrecision(4)
										: 'NaN'}</p>
									<p><span class="tp-value-key">p-adjusted:</span> {Number.isFinite(pair.pAdjusted)
										? pair.pAdjusted.toPrecision(4)
										: 'NaN'}</p>
									<p><span class="tp-value-key">Significant:</span> {pair.significant ? 'Yes' : 'No'}</p>
								</div>
							{/each}
							<p>
								Row <NumberWithUnits
									min={1}
									max={Math.max(1, theData.sigBarResult.pairs.length - 5)}
									step={1}
									bind:value={theData.sigBarPreviewStart}
								/> to {Math.min(theData.sigBarPreviewStart + 5, theData.sigBarResult.pairs.length)} of {theData.sigBarResult.pairs.length}
							</p>
						</details>
					{/if}
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
							<div class="control-input">
								<p>x (categories, optional)</p>
							</div>
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
							<div class="control-input">
								<p>y (values)</p>
							</div>
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
		width={theData.plot.parentBox.width}
		height={theData.plot.parentBox.height}
		viewBox="0 0 {theData.plot.parentBox.width} {theData.plot.parentBox.height}"
		style={`background: white; position: absolute;`}
		ontooltip={handleTooltip}
	>
		<!-- Y-axis -->
		<Axis
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
					seriesIndex={i}
					totalSeries={theData.plot.data.length}
					dodgeEnabled={hasCategoryXData(datum)}
					xscale={xScale}
					yscale={yScale}
					xoffset={theData.plot.padding.left}
					yoffset={theData.plot.padding.top}
					which="plot"
				/>
			{/if}
		{/each}

		<Legend
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
			{@const levelStep = dataRange * 0.1}
			{#each theData.plot.sigBarLevels as entry}
				{@const xi = sigXScale(entry.i) + theData.plot.padding.left}
				{@const xj = sigXScale(entry.j) + theData.plot.padding.left}
				{@const barYData =
					(Number.isFinite(dataMax) ? dataMax : theData.plot.ylims[1]) +
					levelStep * (entry.level + 1)}
				{@const barY = sigYScale(barYData) + theData.plot.padding.top}
				<line x1={xi} y1={barY + 4} x2={xi} y2={barY} stroke="black" stroke-width="1" />
				<line x1={xi} y1={barY} x2={xj} y2={barY} stroke="black" stroke-width="1" />
				<line x1={xj} y1={barY} x2={xj} y2={barY + 4} stroke="black" stroke-width="1" />
				<text x={(xi + xj) / 2} y={barY - 3} text-anchor="middle" font-size="11" fill="black"
					>{formatSigLabel(entry.pair.pAdjusted)}</text
				>
			{/each}
		{/if}
	</svg>

	{#if tooltip.visible}
		<div class="tooltip" style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}>
			{@html tooltip.content}
		</div>
	{/if}
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
		border: 1px solid var(--stroke2, var(--color-lightness-85, #d7d7d7));
		border-radius: 0.375rem;
		background: var(--color-lightness-99, #fcfcfc);
	}

	.tp-output-summary {
		cursor: pointer;
		font-weight: 600;
	}

	.tp-value-block {
		margin-top: 0.4rem;
		padding: 0.35rem 0.45rem;
		border: 1px solid var(--color-lightness-93, #ececec);
		border-radius: 0.35rem;
		background: var(--color-lightness-100, #fff);
	}

	.tp-value-block p {
		margin: 0.12rem 0;
	}

	.tp-value-key {
		font-weight: 600;
	}
</style>
