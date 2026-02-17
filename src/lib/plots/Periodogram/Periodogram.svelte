<script module>
	// @ts-nocheck
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import Column from '$lib/core/Column.svelte';
	import Axis from '$lib/components/plotBits/Axis.svelte';
	import { scaleLinear } from 'd3-scale';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import Line, { LineClass } from '$lib/components/plotbits/Line.svelte';
	import Points, { PointsClass } from '$lib/components/plotBits/Points.svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/ControlDisplay.svelte';

	// Import worker source and BigNumber as raw strings so everything is inlined
	import bigNumberSource from 'bignumber.js/bignumber.js?raw';
	import periodogramWorkerSourceRaw from '$lib/workers/periodogram.worker.js?raw';

	export const Periodogram_defaultDataInputs = ['time', 'values'];
	export const Periodogram_controlHeaders = ['Properties', 'Data'];

	// Buffer factor: calculate this much extra beyond the display range
	// e.g. 0.25 means 25% extra on each side
	const CALC_RANGE_BUFFER = 0.25;

	/**
	 * Build a fingerprint string from the data-related params (everything
	 * EXCEPT period range). When this changes, we must always recalculate.
	 */
	function buildDataFingerprint(xData, yData, binSize, method, chiSquaredAlpha, periodSteps) {
		return JSON.stringify({
			xLen: xData?.length ?? 0,
			xFirst: xData?.[0] ?? null,
			xLast: xData?.[xData?.length - 1] ?? null,
			yLen: yData?.length ?? 0,
			yFirst: yData?.[0] ?? null,
			yLast: yData?.[yData?.length - 1] ?? null,
			binSize,
			method,
			chiSquaredAlpha,
			periodSteps
		});
	}

	class PeriodogramDataclass {
		parentPlot = $state();
		x = $state();
		y = $state();
		binSize = $state(0.25);
		method = $state('Chi-squared');

		line = $state();
		points = $state();
		thresholdline = $state();
		chiSquaredAlpha = $state(0.05);

		// Web worker state
		worker = null;
		currentCalculationId = null;
		calculating = $state(false);
		progress = $state({ current: 0, total: 0 });

		// Period data - now $state instead of $derived
		periodData = $state({ x: [], y: [], threshold: [], pvalue: [] });

		// Cache for smart recalculation
		_cache = {
			calcMin: null,
			calcMax: null,
			dataFingerprint: null
		};

		// Debounce timer for calculations
		_debounceTimer = null;
		_debounceDelay = 250; // ms

		constructor(parent, dataIN) {
			this.parentPlot = parent;

			if (dataIN?.x) {
				this.x = ColumnClass.fromJSON(dataIN.x);
			} else {
				if (parent.data.length > 0) {
					this.x = new ColumnClass({ refId: parent.data[parent.data.length - 1].x.refId });
				} else {
					this.x = new ColumnClass({ refId: -1 });
				}
			}
			if (dataIN && dataIN.y) {
				this.y = ColumnClass.fromJSON(dataIN.y);
			} else {
				this.y = new ColumnClass({ refId: -1 });
			}
			this.line = new LineClass(dataIN?.line, this);
			this.thresholdline = new LineClass(dataIN?.thresholdline, this);
			this.points = new PointsClass(dataIN?.points, this);
			this.method = dataIN?.method ?? 'Lomb-Scargle';

			// Initialize worker (doesn't need component context)
			this.initWorker();
		}

		initWorker() {
			// Only create worker in browser environment
			if (typeof Worker === 'undefined') return;

			try {
				// Prepend the local BigNumber source to the worker code
				const blob = new Blob([bigNumberSource, '\n', periodogramWorkerSourceRaw], { type: 'application/javascript' });
				const blobUrl = URL.createObjectURL(blob);
				this.worker = new Worker(blobUrl);
				URL.revokeObjectURL(blobUrl); // Clean up - worker keeps its own reference

				this.worker.onmessage = (e) => {
					const { type, id, result, current, total, error } = e.data;

					// Ignore messages from old calculations
					if (id !== this.currentCalculationId) return;

					if (type === 'progress') {
						this.progress = { current, total };
					} else if (type === 'complete') {
						this.periodData = result;
						this.calculating = false;
						this.progress = { current: 0, total: 0 };
					} else if (type === 'error') {
						console.error('Periodogram calculation error:', error);
						this.calculating = false;
						this.progress = { current: 0, total: 0 };
					} else if (type === 'cancelled') {
						this.calculating = false;
						this.progress = { current: 0, total: 0 };
					}
				};

				this.worker.onerror = (error) => {
					console.error('Worker error:', error);
					this.calculating = false;
					this.progress = { current: 0, total: 0 };
				};
			} catch (error) {
				console.error('Failed to create worker:', error);
			}
		}

		cleanup() {
			this.cancelCalculation();
			if (this._debounceTimer) {
				clearTimeout(this._debounceTimer);
				this._debounceTimer = null;
			}
			if (this.worker) {
				this.worker.terminate();
				this.worker = null;
			}
		}

		// Called by the component's $effect to trigger calculation.
		// Reactive values must be read by the caller ($effect) and passed in.
		triggerCalculation(
			xData,
			yData,
			binSize,
			method,
			chiSquaredAlpha,
			periodSteps,
			displayMin,
			displayMax
		) {
			// Skip if data is invalid
			if (!xData || !yData || xData.length === 0 || yData.length === 0) {
				return;
			}

			// Build fingerprint for data-related params
			const fp = buildDataFingerprint(xData, yData, binSize, method, chiSquaredAlpha, periodSteps);

			// Check cache
			const dataChanged = fp !== this._cache.dataFingerprint;
			const rangeCovered =
				this._cache.calcMin !== null &&
				this._cache.calcMax !== null &&
				this._cache.calcMin <= displayMin &&
				this._cache.calcMax >= displayMax;

			// Skip calculation if cache is valid
			if (!dataChanged && rangeCovered) {
				return;
			}

			// Calculate with buffered range
			const span = displayMax - displayMin;
			const buffer = span * CALC_RANGE_BUFFER;
			const calcMin = Math.max(0.01, displayMin - buffer);
			const calcMax = displayMax + buffer;

			// Update cache
			this._cache.calcMin = calcMin;
			this._cache.calcMax = calcMax;
			this._cache.dataFingerprint = fp;

			// Clear any pending debounced calculation
			if (this._debounceTimer) {
				clearTimeout(this._debounceTimer);
			}

			// Debounce the actual worker call
			this._debounceTimer = setTimeout(() => {
				this.startCalculation({
					xData,
					yData,
					binSize,
					method,
					chiSquaredAlpha,
					periodMin: calcMin,
					periodMax: calcMax,
					periodSteps
				});
			}, this._debounceDelay);
		}

		startCalculation(params) {
			// Skip if worker is not available (SSR or creation failed)
			if (!this.worker) {
				console.warn('Worker not available, skipping calculation');
				return;
			}

			// Cancel any ongoing calculation
			if (this.calculating) {
				this.cancelCalculation();
			}

			// Generate unique ID for this calculation
			this.currentCalculationId = Math.random().toString(36).substring(7);
			this.calculating = true;
			this.progress = { current: 0, total: 0 };

			// Send calculation request to worker
			this.worker.postMessage({
				type: 'calculate',
				id: this.currentCalculationId,
				params
			});
		}

		cancelCalculation() {
			if (this.currentCalculationId && this.worker) {
				this.worker.postMessage({
					type: 'cancel',
					id: this.currentCalculationId
				});
			}
		}

		toJSON() {
			return {
				x: this.x,
				y: this.y,
				line: this.line.toJSON(),
				thresholdline: this.thresholdline.toJSON(),
				points: this.points.toJSON(),
				binSize: this.binSize,
				method: this.method,
				chiSquaredAlpha: this.chiSquaredAlpha
			};
		}

		static fromJSON(json, parent) {
			return new PeriodogramDataclass(parent, {
				x: json.x,
				y: json.y,
				line: LineClass.fromJSON(json.line),
				thresholdline: LineClass.fromJSON(json.thresholdline),
				points: PointsClass.fromJSON(json.points),
				binSize: json.binSize,
				method: json.method,
				chiSquaredAlpha: json.chiSquaredAlpha
			});
		}
	}

	export class Periodogramclass {
		parentBox = $state();
		data = $state([]);
		padding = $state({ top: 15, right: 20, bottom: 30, left: 30 });
		plotheight = $derived(this.parentBox.height - this.padding.top - this.padding.bottom);
		plotwidth = $derived(this.parentBox.width - this.padding.left - this.padding.right);

		periodlimsIN = $state([1, 30]);
		periodSteps = $state(0.25);
		ylimsIN = $state([null, null]);
		ylims = $derived.by(() => {
			if (this.data.length === 0) {
				return [0, 0];
			}

			let ymin = Infinity;
			let ymax = -Infinity;
			this.data.forEach((d, i) => {
				let tempy = this.data[i].periodData.y;
				ymin = Math.floor(Math.min(ymin, Math.min(...tempy)));
				ymax = Math.ceil(Math.max(ymax, Math.max(...tempy)));
			});
			return [
				this.ylimsIN[0] != null ? this.ylimsIN[0] : ymin,
				this.ylimsIN[1] != null ? this.ylimsIN[1] : ymax
			];
		});
		xgridlines = $state(true);
		ygridlines = $state(true);

		constructor(parent, dataIN) {
			this.parentBox = parent;
			if (dataIN) {
				this.addData(dataIN);
			}
		}

		getAutoScaleValues() {
			let axisWidths = { left: null, right: null, top: null, bottom: null };

			const leftSVG = document.getElementById('plot' + this.parentBox.id)?.getBoundingClientRect();

			//LEFT
			const allLeftAxes = document
				.getElementById('plot' + this.parentBox.id)
				?.getElementsByClassName('axis-left');
			if (allLeftAxes.length == 0) {
			} else {
				if (allLeftAxes) {
					let leftMost = 0;
					let leftAxisWhole = allLeftAxes[0].getBoundingClientRect().left;
					for (let i = 1; i < allLeftAxes.length; i++) {
						if (allLeftAxes[i].getBoundingClientRect().left < leftAxisWhole) {
							leftMost = i;
							leftAxisWhole = allLeftAxes[i].getBoundingClientRect().left;
						}
					}
					const leftAxisLine = allLeftAxes[leftMost]
						.getElementsByClassName('domain')[0]
						.getBoundingClientRect().left;
					axisWidths.left = Math.round(leftAxisLine - leftAxisWhole + 6);
				}
			}

			//RIGHT
			const allRightAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-right');
			if (allRightAxes.length == 0) {
			} else {
				if (allRightAxes) {
					let rightMost = 0;
					let rightAxisWhole = allRightAxes[0].getBoundingClientRect().right;
					for (let i = 1; i < allRightAxes.length; i++) {
						if (allRightAxes[i].getBoundingClientRect().right > rightAxisWhole) {
							rightMost = i;
							rightAxisWhole = allRightAxes[i].getBoundingClientRect().right;
						}
					}
					const rightAxisLine = allRightAxes[rightMost]
						.getElementsByClassName('domain')[0]
						.getBoundingClientRect().right;
					axisWidths.right = Math.round(rightAxisWhole - rightAxisLine + 6);
				}
			}

			//TOP
			const allTopAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-top');
			if (allTopAxes.length == 0) {
			} else {
				if (allTopAxes) {
					let topMost = 0;
					let topAxisWhole = allTopAxes[0].getBoundingClientRect().top;
					for (let i = 1; i < allTopAxes.length; i++) {
						if (allTopAxes[i].getBoundingClientRect().top < topAxisWhole) {
							topMost = i;
							topAxisWhole = allTopAxes[i].getBoundingClientRect().top;
						}
					}
					const topAxisLine = allTopAxes[topMost]
						.getElementsByClassName('domain')[0]
						.getBoundingClientRect().top;
					axisWidths.top = Math.round(topAxisLine - topAxisWhole + 6);
				}
			}

			//BOTTOM
			const allBottomAxes = document
				.getElementById('plot' + this.parentBox.id)
				.getElementsByClassName('axis-bottom');
			if (allBottomAxes.length == 0) {
			} else {
				if (allBottomAxes) {
					let bottomMost = 0;
					let bottomAxisWhole = allBottomAxes[0].getBoundingClientRect().bottom;
					for (let i = 1; i < allBottomAxes.length; i++) {
						if (allBottomAxes[i].getBoundingClientRect().bottom > bottomAxisWhole) {
							bottomMost = i;
							bottomAxisWhole = allBottomAxes[i].getBoundingClientRect().bottom;
						}
					}
					const bottomAxisLine = allBottomAxes[bottomMost]
						.getElementsByClassName('domain')[0]
						.getBoundingClientRect().bottom;
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
			if (Object.keys(dataIN).includes('time')) {
				const temp = { x: { refId: dataIN.time.refId }, y: { refId: dataIN.values.refId } };
				dataIN = structuredClone(temp);
			}
			const datum = new PeriodogramDataclass(this, dataIN);
			this.data.push(datum);
		}
		removeData(idx) {
			// Clean up the worker before removing
			if (this.data[idx]) {
				this.data[idx].cleanup();
			}
			this.data.splice(idx, 1);
		}

		toJSON() {
			return {
				periodlimsIN: this.periodlimsIN,
				periodSteps: this.periodSteps,
				ylimsIN: this.ylimsIN,
				padding: this.padding,
				ygridlines: this.ygridlines,
				xgridlines: this.xgridlines,
				data: this.data
			};
		}
		static fromJSON(parent, json) {
			if (!json) {
				return new Periodogramclass(parent, null);
			}

			const periodogram = new Periodogramclass(parent, null);
			periodogram.padding = json.padding ?? json.paddingIN;
			periodogram.periodlimsIN = json.periodlimsIN;
			periodogram.periodSteps = json.periodSteps;
			periodogram.ylimsIN = json.ylimsIN;
			periodogram.ygridlines = json.ygridlines;
			periodogram.xgridlines = json.xgridlines;

			if (json.data) {
				periodogram.data = json.data.map((d) => PeriodogramDataclass.fromJSON(d, periodogram));
			}
			return periodogram;
		}
	}
</script>

<script>
	import { appState } from '$lib/core/core.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';

	import Icon from '$lib/icons/Icon.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';

	let { theData, which } = $props();

	//Tooltip
	let tooltip = $state({ visible: false, x: 0, y: 0, content: '' });
	function handleTooltip(event) {
		tooltip = event.detail;
	}

	onMount(() => {
		if (which == 'plot') {
			theData.plot.autoScalePadding('all');
		}
	});

	onDestroy(() => {
		// Clean up any active workers
		if (which === 'plot' && theData.plot?.data) {
			theData.plot.data.forEach((datum) => {
				datum.cleanup();
			});
		}
	});

	// Set up calculation triggers for all periodogram data.
	// We read all reactive dependencies HERE so Svelte tracks them,
	// then pass the values into the debounced triggerCalculation.
	$effect(() => {
		if (which === 'plot' && theData.plot?.data) {
			theData.plot.data.forEach((datum) => {
				const xData = datum.x.hoursSinceStart;
				const yData = datum.y.getData();
				const binSize = datum.binSize;
				const method = datum.method;
				const chiSquaredAlpha = datum.chiSquaredAlpha;
				const periodSteps = datum.parentPlot.periodSteps;
				const displayMin = datum.parentPlot.periodlimsIN[0];
				const displayMax = datum.parentPlot.periodlimsIN[1];

				datum.triggerCalculation(
					xData,
					yData,
					binSize,
					method,
					chiSquaredAlpha,
					periodSteps,
					displayMin,
					displayMax
				);
			});
		}
	});

	//check for axes if the labels change
	$effect(() => {
		if (which == 'controls') {
			theData.ylabel;
			theData.xlabel;
			theData.ylims;
			theData.xlims;

			theData.autoScalePadding('all');
		}
	});
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

		<div class="control-component">
			<div class="control-component-title">
				<p>Padding</p>
				{#if theData.getAutoScaleValues()?.top != theData.padding.top || theData.getAutoScaleValues()?.bottom != theData.padding.bottom || theData.getAutoScaleValues()?.left != theData.padding.left || theData.getAutoScaleValues()?.right != theData.padding.right}
					<button class="icon" onclick={() => theData.autoScalePadding('all')}>
						<Icon name="reset" width={14} height={14} className="control-component-input-icon" />
					</button>
				{/if}
			</div>

			<div class="control-input-square">
				<div class="control-input">
					<p>Top</p>
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<NumberWithUnits
							bind:value={theData.padding.top}
							style="width: calc(100% - {theData.getAutoScaleValues()?.top != null &&
							theData.getAutoScaleValues().top != theData.padding.top
								? 24
								: 0}px)"
						/>

						{#if theData.getAutoScaleValues()?.top != null && theData.getAutoScaleValues()?.top != theData.padding.top}
							<button class="icon" onclick={() => theData.autoScalePadding('top')}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						{/if}
					</div>
				</div>

				<div class="control-input">
					<p>Bottom</p>
					<div
						style="    display: flex;  justify-content: flex-start; align-items: center; gap: 8px;"
					>
						<NumberWithUnits
							bind:value={theData.padding.bottom}
							style="width: calc(100% - {theData.getAutoScaleValues()?.bottom != null &&
							theData.getAutoScaleValues().bottom != theData.padding.bottom
								? 24
								: 0}px)"
						/>
						{#if theData.getAutoScaleValues()?.bottom != null && theData.getAutoScaleValues()?.bottom != theData.padding.bottom}
							<button class="icon" onclick={() => theData.autoScalePadding('bottom')}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						{/if}
					</div>
				</div>

				<div class="control-input">
					<p>Left</p>
					<div style="display: flex;  justify-content: flex-start; align-items: center; gap: 8px;">
						<NumberWithUnits
							bind:value={theData.padding.left}
							style="width: calc(100% - {theData.getAutoScaleValues()?.left != null &&
							theData.getAutoScaleValues().left != theData.padding.left
								? 24
								: 0}px)"
						/>
						{#if theData.getAutoScaleValues()?.left != null && theData.getAutoScaleValues()?.left != theData.padding.left}
							<button class="icon" onclick={() => theData.autoScalePadding('left')}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						{/if}
					</div>
				</div>

				<div class="control-input">
					<p>Right</p>
					<div
						style="    display: flex;  justify-content: flex-start; align-items: center; gap: 8px;"
					>
						<NumberWithUnits
							bind:value={theData.padding.right}
							style="width: calc(100% - {theData.getAutoScaleValues()?.right != null &&
							theData.getAutoScaleValues().right != theData.padding.right
								? 24
								: 0}px)"
						/>
						{#if theData.getAutoScaleValues()?.right != null && theData.getAutoScaleValues()?.right != theData.padding.right}
							<button class="icon" onclick={() => theData.autoScalePadding('right')}>
								<Icon
									name="reset"
									width={14}
									height={14}
									className="control-component-input-icon"
								/>
							</button>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Y-Axis</p>
				<div class="control-component-title-icons">
					<button class="icon" onclick={() => (theData.ylimsIN = [null, null])}>
						<Icon name="reset" width={14} height={14} className="control-component-title-icon" />
					</button>
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.ygridlines} />
					<p>Grid</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[0] ? theData.ylimsIN[0] : theData.ylims[0]}
						onInput={(val) => {
							theData.ylimsIN[0] = [parseFloat(val)];
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="0.1"
						value={theData.ylimsIN[1] ? theData.ylimsIN[1] : theData.ylims[1]}
						onInput={(val) => {
							theData.ylimsIN[1] = [parseFloat(val)];
						}}
					/>
				</div>
			</div>
		</div>

		<div class="control-component">
			<div class="control-component-title">
				<p>X-Axis</p>
			</div>

			<div class="control-input-vertical">
				<div class="control-input-checkbox">
					<input type="checkbox" bind:checked={theData.xgridlines} />
					<p>Grid</p>
				</div>
			</div>

			<div class="control-input-horizontal">
				<div class="control-input">
					<p>Min</p>
					<NumberWithUnits
						min="0.1"
						step="0.1"
						value={theData.periodlimsIN[0] ? theData.periodlimsIN[0] : theData.periodlims[0]}
						onInput={(val) => {
							theData.periodlimsIN[0] = parseFloat(val);
						}}
					/>
				</div>

				<div class="control-input">
					<p>Max</p>
					<NumberWithUnits
						step="0.1"
						value={theData.periodlimsIN[1] ? theData.periodlimsIN[1] : theData.periodlimsIN[1]}
						onInput={(val) => {
							theData.periodlimsIN[1] = parseFloat(val);
						}}
					/>
				</div>
			</div>

			<div class="control-input-vertical">
				<div class="control-input">
					<p>Period Step</p>
					<NumberWithUnits min="0.01" step="0.01" bind:value={theData.periodSteps} />
				</div>
			</div>
		</div>
	{:else if appState.currentControlTab === 'data'}
		<div id="dataSettings">
			<div class="control-data-add">
				<button
					class="icon"
					onclick={async () => {
						theData.addData({
							x: null,
							y: { refId: -1 }
						});
						await tick();

						//Scroll to the bottom of dataSettings
						dataSettingsScrollTo('bottom');
					}}
				>
					<Icon name="add" width={16} height={16} />
				</button>
			</div>

			<div class="control-data-container">
				{#each theData.data as datum, i (datum.x.id + '-' + datum.y.id)}
					<div
						class="dataBlock"
						animate:flip={{ duration: 500 }}
						in:slide={{ duration: 500, axis: 'y' }}
						out:slide={{ duration: 500, axis: 'y' }}
					>
						<div class="control-component-title">
							<p>
								Data {i}
							</p>
							<button class="icon" onclick={() => theData.removeData(i)}
								><Icon
									name="minus"
									width={16}
									height={16}
									className="control-component-title-icon"
								/></button
							>
						</div>

						<div class="control-data">
							<div class="control-input">
								<p>x</p>
							</div>

							<Column col={datum.x} canChange={true} />
						</div>

						<div class="control-data">
							<div class="control-input">
								<p>y</p>
							</div>

							<Column col={datum.y} canChange={true} />
						</div>

						<div class="control-input">
							<p>Method</p>
							<select bind:value={datum.method}>
								<option value="Lomb-Scargle">Lomb-Scargle</option>
								<option value="Chi-squared">Chi-squared</option>
								<option value="Enright">Enright</option>
							</select>
						</div>

						<!-- New: Method selector -->
						<div class="control-input-horizontal">
							<!-- binSize only relevant for Chi-squared -->
							{#if datum.method === 'Chi-squared'}
								<div class="control-input">
									<p>Bin Size</p>
									<input type="number" step="0.01" min="0.01" bind:value={datum.binSize} />
								</div>

								<div class="control-input">
									<p>Alpha</p>
									<input
										type="number"
										min="0.0001"
										max="0.9999"
										step="0.01"
										bind:value={datum.chiSquaredAlpha}
									/>
								</div>
							{/if}
						</div>

						<Line lineData={datum.line} which="controls" />
						<Points pointsData={datum.points} which="controls" />
						{#if datum.method === 'Chi-squared'}
							<Line lineData={datum.thresholdline} which="controls" title="Threshold" />
						{/if}

						<div class="div-line"></div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet plot(theData)}
	<!-- Check if any data is calculating -->
	{@const isCalculating = theData.plot.data.some((d) => d.calculating)}
	{@const calculatingData = theData.plot.data.find((d) => d.calculating)}

	<!-- Calculating overlay -->
	{#if isCalculating && calculatingData}
		<div
			style="
				position: absolute;
				inset: 0;
				background: rgba(255, 255, 255, 0.9);
				backdrop-filter: blur(3px);
				display: flex;
				align-items: center;
				justify-content: center;
				flex-direction: column;
				gap: 16px;
				z-index: 10;
			"
		>
			<LoadingSpinner
				message="Calculating periodogram..."
				detail={calculatingData.progress.total > 0
					? `${Math.round((calculatingData.progress.current / calculatingData.progress.total) * 100)}%`
					: ''}
			/>
		</div>
	{/if}

	<svg
		id={'plot' + theData.plot.parentBox.id}
		width={theData.plot.parentBox.width}
		height={theData.plot.parentBox.height}
		viewBox="0 0 {theData.plot.parentBox.width} {theData.plot.parentBox.height}"
		style={`background: white; position: absolute;`}
		ontooltip={handleTooltip}
	>
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
				.range([theData.plot.plotheight, 0])}
			position="left"
			plotPadding={theData.plot.padding}
			nticks={5}
			gridlines={theData.plot.ygridlines}
			label="Power"
		/>
		<Axis
			height={theData.plot.plotheight}
			width={theData.plot.plotwidth}
			scale={scaleLinear()
				.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
				.range([0, theData.plot.plotwidth])}
			position="bottom"
			plotPadding={theData.plot.padding}
			nticks={5}
			gridlines={theData.plot.xgridlines}
			label="Period (hours)"
		/>

		{#each theData.plot.data as datum}
			<Line
				lineData={datum.line}
				x={datum.periodData.x}
				y={datum.periodData.y}
				xscale={scaleLinear()
					.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				which="plot"
			/>
			<Points
				pointsData={datum.points}
				x={datum.periodData.x}
				y={datum.periodData.y}
				xscale={scaleLinear()
					.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
					.range([0, theData.plot.plotwidth])}
				yscale={scaleLinear()
					.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
					.range([theData.plot.plotheight, 0])}
				yoffset={theData.plot.padding.top}
				xoffset={theData.plot.padding.left}
				tooltip={true}
				which="plot"
			/>
			{#if datum.method === 'Chi-squared'}
				<Line
					lineData={datum.thresholdline}
					x={datum.periodData.x}
					y={datum.periodData.threshold}
					xscale={scaleLinear()
						.domain([theData.plot.periodlimsIN[0], theData.plot.periodlimsIN[1]])
						.range([0, theData.plot.plotwidth])}
					yscale={scaleLinear()
						.domain([theData.plot.ylims[0], theData.plot.ylims[1]])
						.range([theData.plot.plotheight, 0])}
					yoffset={theData.plot.padding.top}
					xoffset={theData.plot.padding.left}
					which="plot"
				/>
			{/if}
		{/each}
	</svg>
	{#if tooltip.visible}
		<div class="tooltip" style={`left: ${tooltip.x}px; top: ${tooltip.y}px;`}>
			{tooltip.content}
		</div>
	{/if}
{/snippet}

{#if which === 'plot'}
	{@render plot(theData)}
{:else if which === 'controls'}
	{@render controls(theData)}
{/if}
