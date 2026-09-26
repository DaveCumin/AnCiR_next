<script>
	// @ts-nocheck
	// The Save dialog: ONE popup for exporting plots as images.
	//
	// It replaces a dropdown whose choices sat two submenus deep (single image vs
	// individual files, then PNG vs SVG) and that could not show what it was about to
	// write. The preview here IS the export: `buildExport` produces the same svg the
	// download will serialise, so a title band or a panel label shows up exactly as
	// it will land in the file.
	//
	// Resolution and size are edited here too, and they are the plot's own: the dpi
	// lives in the figure style (`style.exportDpi`, which the MCP rasteriser reads) and
	// the width/height are the plot's box. Edits preview live (the plot is re-rendered
	// at the new size, see withPlotSize) but reach the plot only on Save, as one undo
	// step; Cancel discards them.
	//
	// Options are remembered per browser (localStorage), never in the session. The
	// dimensions are never remembered: they belong to the plot.
	import { untrack } from 'svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { resolvePlotRef, ownerPlotOf } from '$lib/core/plotRefs.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { PX_PER_MM, physicalWidthPx } from '$lib/plots/figureStyle.js';
	import {
		buildExport,
		normalisePlotIds,
		saveExport,
		svgDataUrl,
		rasterisePng,
		loadExportOptions,
		saveExportOptions,
		saveDataAsCSV,
		showDataAsTable,
		isValidDpi,
		DPI_MIN,
		DPI_MAX,
		DPI_PRESETS,
		PANEL_LABEL_STYLES
	} from '$lib/components/plotbits/helpers/save.svelte.js';

	let { open = $bindable(false), Id } = $props();

	const ids = $derived(normalisePlotIds(Id));
	const multi = $derived(ids.length > 1);
	// A plot or a facet PANEL (string id): a panel carries the same surface (name, style,
	// width, height, plot), so the dialog pages through panels exactly as through plots.
	const plotById = (id) => resolvePlotRef(id);
	const firstPlot = $derived(plotById(ids[0]));
	const heading = $derived(
		multi ? `Save ${ids.length} plots` : `Save ${firstPlot?.name ?? 'plot'}`
	);
	const hasData = $derived(!multi && typeof firstPlot?.plot?.getDownloadData === 'function');

	let format = $state('png');
	let includeTitle = $state(true);
	let panelLabels = $state(false);
	let combined = $state(true);
	let labelStyle = $state('lower');
	let lockAspect = $state(true);
	// The dpi field's text: free entry, followed on every keystroke, validated on blur
	// and on Save. `dpi` is null while the text is not a usable value; `dpiHeld` is the
	// last usable one, so the preview never sees a half-typed number.
	let dpiText = $state('300');
	const dpi = $derived.by(() => {
		const text = String(dpiText ?? '').trim();
		const n = text === '' ? NaN : Number(text);
		return isValidDpi(n) ? Math.round(n) : null;
	});
	let dpiHeld = $state(300);
	$effect(() => {
		if (dpi != null) dpiHeld = dpi;
	});

	// Individual files: which plot the dialog is looking at. Single plot: always ids[0].
	const individual = $derived(multi && !combined);
	let page = $state(0);
	const current = $derived(individual ? (ids[page] ?? ids[0]) : ids[0]);
	const currentPlot = $derived(plotById(current));

	// Sizes edited in this dialog, by plot id. Only plots the user touched are here, so
	// Save writes exactly those and paging keeps each plot's own numbers.
	let sizes = $state({});
	// Each plot's size when the dialog opened: the aspect the lock holds, and the
	// baseline a write-back is measured against.
	let originals = {};

	const options = $derived({
		format,
		includeTitle,
		panelLabels,
		combined,
		labelStyle,
		lockAspect,
		dpi: format === 'png' ? (dpi ?? dpiHeld) : null,
		sizes
	});

	// The element that had focus when the dialog opened, so closing hands it back.
	let opener = null;

	$effect(() => {
		if (!open) return;
		const active = document.activeElement;
		if (active && !active.closest('dialog')) opener = active;
		const saved = loadExportOptions();
		format = saved.format;
		includeTitle = saved.includeTitle;
		panelLabels = saved.panelLabels;
		combined = saved.combined;
		labelStyle = saved.labelStyle;
		lockAspect = saved.lockAspect;
		untrack(() => {
			// The plot's own dpi first (that is where the export resolution lives); the
			// remembered one only for a plot with no style.
			const own = plotById(ids[0])?.style?.exportDpi;
			dpiText = String(isValidDpi(own) ? Math.round(own) : saved.dpi);
			originals = {};
			for (const id of ids) {
				const p = plotById(id);
				if (p) originals[id] = { width: p.width, height: p.height };
			}
			sizes = {};
			page = 0;
		});
	});

	// --- Resolution -----------------------------------------------------------
	function setDpi(n) {
		dpiText = String(Math.round(n));
	}
	/** Pull a typed value into range once the user leaves the field. */
	function settleDpi() {
		const text = String(dpiText ?? '').trim();
		const n = text === '' ? NaN : Number(text);
		if (!Number.isFinite(n)) {
			dpiText = String(plotById(ids[0])?.style?.exportDpi ?? loadExportOptions().dpi);
			return;
		}
		setDpi(Math.min(DPI_MAX, Math.max(DPI_MIN, n)));
	}

	// --- Dimensions -----------------------------------------------------------
	const showDims = $derived(!multi || individual);
	const currentSize = $derived.by(() => {
		if (!currentPlot) return null;
		return (
			sizes[current] ??
			originals[current] ?? { width: currentPlot.width, height: currentPlot.height }
		);
	});
	const mm = (px) => Math.round(px / PX_PER_MM);
	const physicalText = $derived(
		currentSize ? `≈ ${mm(currentSize.width)} × ${mm(currentSize.height)} mm` : ''
	);

	/** A field's typed value as a usable size in whole px, or null while it is not one. */
	function readPx(value) {
		const n = Number(value);
		return Number.isFinite(n) && n >= 10 && n <= 20000 ? Math.round(n) : null;
	}

	/** One field edited; the other follows on the plot's original aspect when locked. */
	function setDimension(which, value) {
		const n = readPx(value);
		if (n == null || !currentSize) return false;
		const base = originals[current] ?? currentSize;
		const ratio = base.width > 0 && base.height > 0 ? base.height / base.width : 1;
		const next =
			which === 'width'
				? { width: n, height: lockAspect ? Math.round(n * ratio) : currentSize.height }
				: { width: lockAspect ? Math.round(n / ratio) : currentSize.width, height: n };
		sizes = { ...sizes, [current]: next };
		return true;
	}

	// What the two fields SHOW. They follow every keystroke: the model (`sizes`) takes
	// each usable value as it is typed, the partner field and the preview follow, and
	// the field being typed in is left alone so "8" on the way to "800" is not snapped
	// to the model's rounded value mid-edit. An unusable value ("", "abc", "8") changes
	// nothing: the model holds the last usable size until the text is one again.
	let widthText = $state('');
	let heightText = $state('');
	let typing = null;
	$effect(() => {
		const size = currentSize;
		untrack(() => {
			if (typing !== 'width') widthText = size ? String(size.width) : '';
			if (typing !== 'height') heightText = size ? String(size.height) : '';
			typing = null;
		});
	});
	function onDimensionInput(which, text) {
		typing = which;
		if (!setDimension(which, text)) typing = null;
	}
	/** Leaving the field: show the value the model settled on (rounded, or held). */
	function settleDimension(which) {
		typing = null;
		if (!currentSize) return;
		if (which === 'width') widthText = String(currentSize.width);
		else heightText = String(currentSize.height);
	}

	// --- Pager ----------------------------------------------------------------
	const pageCount = $derived(individual ? ids.length : 1);

	const labelSample = $derived(
		PANEL_LABEL_STYLES.find((st) => st.id === labelStyle)?.sample ?? 'a, b, c'
	);
	function goTo(i) {
		if (!individual) return;
		page = Math.min(pageCount - 1, Math.max(0, i));
	}

	// --- Preview -------------------------------------------------------------
	let previewSrc = $state('');
	let previewJobs = $state([]);
	let previewBusy = $state(false);
	let previewSerial = 0;

	function describe(job) {
		if (!job) return '';
		if (job.format === 'svg') {
			return `SVG, ${mm(job.width)} × ${mm(job.height)} mm`;
		}
		const at = Math.round(job.scale * 96);
		return `PNG, ${Math.round(job.width * job.scale)} × ${Math.round(job.height * job.scale)} px at ${at} dpi`;
	}

	const caption = $derived.by(() => {
		if (!previewJobs.length) return 'Nothing to preview: the selected plots are not on screen.';
		const first = describe(previewJobs[0]);
		if (individual) return `Plot ${page + 1} of ${pageCount}: ${first}`;
		return first;
	});

	async function refreshPreview() {
		const serial = ++previewSerial;
		// Individual files: preview the plot on the current page only, so paging does not
		// re-render every plot.
		const jobs = buildExport(individual ? [current] : ids, options);
		if (serial !== previewSerial) return;
		previewJobs = jobs;
		const job = jobs[0];
		if (!job) {
			previewSrc = '';
			return;
		}
		// The vector preview is instant and exact; a PNG preview shows the real raster
		// once it is ready (kept at the vector when there is no canvas to draw on).
		previewSrc = svgDataUrl(job.svgString);
		if (job.format !== 'png') return;
		previewBusy = true;
		try {
			const png = await rasterisePng(job.svgString, job.width, job.height, job.scale);
			if (serial === previewSerial) previewSrc = png;
		} catch {
			/* keep the vector preview */
		} finally {
			if (serial === previewSerial) previewBusy = false;
		}
	}

	// Re-render when anything the export depends on changes, debounced so a burst of
	// toggles (or a large combined figure) does not rasterise on every keystroke.
	$effect(() => {
		if (!open) return;
		void ids;
		void options;
		void current;
		const t = setTimeout(refreshPreview, 120);
		return () => clearTimeout(t);
	});

	// --- Actions -------------------------------------------------------------
	function close() {
		open = false;
	}

	function restoreFocus() {
		previewSerial++;
		previewSrc = '';
		previewJobs = [];
		const el = opener;
		opener = null;
		if (el && typeof el.focus === 'function' && document.contains(el)) {
			queueMicrotask(() => el.focus());
		}
	}

	/**
	 * The history ops that make the plots match the dialog: a size per edited plot, and
	 * the dpi into the figure style of every plot the raster resolution applies to
	 * (single: the plot; individual: each; combined: the first panel, whose style the
	 * combined figure is rasterised at). Empty when nothing changed, so Save on an
	 * untouched dialog records nothing.
	 */
	function writeBackOps() {
		const ops = [];
		const dpiTargets = format !== 'png' || dpi == null ? [] : combined || !multi ? [ids[0]] : ids;
		for (const id of ids) {
			const plot = plotById(id);
			if (!plot) continue;
			// The ops address the PLOT: for a panel that is its generator (whose size and
			// style every panel shares), so one op per generator however many panels paged.
			const targetId = ownerPlotOf(plot)?.id ?? id;
			if (ops.some((o) => o.id === targetId)) continue;
			const size = showDims ? sizes[id] : null;
			const base = originals[id];
			const sizeChanged =
				size && base && (size.width !== base.width || size.height !== base.height);
			const dpiChanged = dpiTargets.includes(id) && plot.style?.exportDpi !== dpi;
			if (sizeChanged) {
				ops.push({
					kind: 'setPlotPosition',
					id: targetId,
					width: size.width,
					height: size.height
				});
			}
			if (sizeChanged || dpiChanged) {
				const style = { ...($state.snapshot(plot.style) ?? {}) };
				if (dpiChanged) style.exportDpi = dpi;
				// A style that FIXES a physical width (a preset, or a custom mm) would snap the
				// plot back the next time the figure panel is touched. Point it at the new size
				// instead; a style that fixes nothing is left alone.
				if (sizeChanged && physicalWidthPx(style) != null) {
					style.widthPreset = 'custom';
					style.widthMm = Math.round((size.width / PX_PER_MM) * 10) / 10;
				}
				const styleChanged =
					dpiChanged ||
					style.widthPreset !== plot.style?.widthPreset ||
					style.widthMm !== plot.style?.widthMm;
				if (styleChanged)
					ops.push({ kind: 'setPlotProperty', id: targetId, key: 'style', value: style });
			}
		}
		return ops;
	}

	async function save() {
		settleDpi();
		const chosen = { ...options, dpi: format === 'png' ? (dpi ?? dpiHeld) : null };
		saveExportOptions(chosen);
		const ops = writeBackOps();
		if (ops.length) mutationService.atomicBatch(ops);
		close();
		await saveExport(ids, chosen);
	}

	function isTextField(el) {
		if (!el) return false;
		const tag = el.tagName;
		if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
		return tag === 'INPUT' && el.type !== 'checkbox';
	}

	function onKeydown(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
			return;
		}
		// Left/Right page through the plots, unless the user is in a field (where the
		// arrows move the caret, or change a radio).
		if (!individual || isTextField(document.activeElement)) return;
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			goTo(page + 1);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			goTo(page - 1);
		}
	}

	// Escape closes from anywhere while open. A modal <dialog> cancels on Escape
	// natively, but focus can sit on the dialog element itself (outside this
	// component's markup) and the native cancel is not guaranteed in every host, so
	// listen at the document too. Keyed on `open` so the listener never outlives it.
	$effect(() => {
		if (!open) return;
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});
</script>

<Modal bind:showModal={open} width="min(44rem, 94vw)" max_height="92vh" onclose={restoreFocus}>
	{#snippet header()}
		<div class="save-heading">
			<h2>{heading}</h2>
		</div>
	{/snippet}

	<div class="save-dialog" role="group" aria-label="Export options">
		<div class="preview-pane">
			{#if individual}
				<div class="pager">
					<button
						type="button"
						class="pager-btn"
						onclick={() => goTo(page - 1)}
						disabled={page === 0}
						aria-label="Previous plot"
					>
						‹ Previous
					</button>
					<span class="pager-label" aria-live="polite">Plot {page + 1} of {pageCount}</span>
					<button
						type="button"
						class="pager-btn"
						onclick={() => goTo(page + 1)}
						disabled={page >= pageCount - 1}
						aria-label="Next plot"
					>
						Next ›
					</button>
				</div>
			{/if}
			<div class="preview-frame" class:busy={previewBusy}>
				{#if previewSrc}
					<img class="export-preview" src={previewSrc} alt="Preview of the exported image" />
				{:else}
					<p class="preview-empty">No preview</p>
				{/if}
			</div>
			<p class="preview-caption" aria-live="polite">{caption}</p>
		</div>

		<div class="options-pane">
			<fieldset>
				<legend>Format</legend>
				<div class="format-row">
					<div class="segmented" role="radiogroup" aria-label="Format">
						<label class:active={format === 'png'}>
							<input type="radio" name="save-format" value="png" bind:group={format} />
							PNG
						</label>
						<label class:active={format === 'svg'}>
							<input type="radio" name="save-format" value="svg" bind:group={format} />
							SVG
						</label>
					</div>
					{#if format === 'png'}
						<label class="unit-field" title="Resolution of the PNG, in dots per inch">
							<input
								type="number"
								name="dpi"
								inputmode="numeric"
								min={DPI_MIN}
								max={DPI_MAX}
								step="1"
								bind:value={dpiText}
								onblur={settleDpi}
								aria-label="Resolution in dpi"
								class:invalid={dpi == null}
							/>
							<span class="unit">dpi</span>
						</label>
					{/if}
				</div>
				{#if format === 'png'}
					<div class="chips" aria-label="Resolution presets">
						{#each DPI_PRESETS as preset (preset)}
							<button
								type="button"
								class="chip"
								class:active={dpi === preset}
								onclick={() => setDpi(preset)}
							>
								{preset}
							</button>
						{/each}
					</div>
				{/if}
			</fieldset>

			<fieldset>
				<legend>Size</legend>
				{#if showDims && currentSize}
					<div class="dims-row">
						<label class="unit-field" title="Width of the plot, in canvas pixels">
							<span class="dim-name">W</span>
							<input
								type="number"
								name="width"
								inputmode="decimal"
								min="10"
								max="20000"
								step="1"
								bind:value={widthText}
								oninput={(e) => onDimensionInput('width', e.currentTarget.value)}
								onblur={() => settleDimension('width')}
								aria-label="Width in pixels"
							/>
						</label>
						<span class="dims-times" aria-hidden="true">×</span>
						<label class="unit-field" title="Height of the plot, in canvas pixels">
							<span class="dim-name">H</span>
							<input
								type="number"
								name="height"
								inputmode="decimal"
								min="10"
								max="20000"
								step="1"
								bind:value={heightText}
								oninput={(e) => onDimensionInput('height', e.currentTarget.value)}
								onblur={() => settleDimension('height')}
								aria-label="Height in pixels"
							/>
						</label>
						<span class="unit">px</span>
					</div>
					<p class="physical-size">{physicalText}</p>
					<label class="check-row">
						<input type="checkbox" bind:checked={lockAspect} />
						Lock aspect
					</label>
					<p class="hint">Saving resizes the plot too (one undo step).</p>
				{:else}
					<p class="dims-note">Laid out as arranged on the canvas.</p>
				{/if}
			</fieldset>

			<fieldset>
				<legend>Content</legend>
				<label class="check-row">
					<input type="checkbox" bind:checked={includeTitle} />
					Include title
					<span class="hint">the plot name, top-left</span>
				</label>
			</fieldset>

			{#if multi}
				<fieldset>
					<legend>Layout</legend>
					<label class="check-row">
						<input type="radio" name="save-layout" value={true} bind:group={combined} />
						Combined image
						<span class="hint">as arranged on the canvas</span>
					</label>
					<label class="check-row">
						<input type="radio" name="save-layout" value={false} bind:group={combined} />
						Individual files
					</label>
					<label class="check-row indent" class:disabled={!combined}>
						<input type="checkbox" bind:checked={panelLabels} disabled={!combined} />
						Panel labels
						<span class="hint">{labelSample}</span>
					</label>
					{#if combined && panelLabels}
						<div class="label-styles indent" role="radiogroup" aria-label="Panel label style">
							<div class="segmented small">
								{#each PANEL_LABEL_STYLES as style (style.id)}
									<label class:active={labelStyle === style.id} title={style.sample}>
										<input
											type="radio"
											name="save-label-style"
											value={style.id}
											bind:group={labelStyle}
											aria-label={style.sample}
										/>
										{style.glyph}
									</label>
								{/each}
							</div>
						</div>
					{/if}
				</fieldset>
			{/if}

			{#if hasData}
				<div class="data-links">
					<button
						type="button"
						class="link-btn"
						onclick={() => {
							close();
							showDataAsTable(ids[0]);
						}}
					>
						View data
					</button>
					<span aria-hidden="true">·</span>
					<button
						type="button"
						class="link-btn"
						onclick={() => {
							close();
							saveDataAsCSV(ids[0]);
						}}
					>
						Download data as CSV
					</button>
				</div>
			{/if}
		</div>

		<div class="button-row">
			<button type="button" class="dialog-button ghost" onclick={close}>Cancel</button>
			<button type="button" class="dialog-button primary" onclick={save}>
				Save {format.toUpperCase()}
			</button>
		</div>
	</div>
</Modal>

<style>
	.save-heading h2 {
		margin: 0 0 var(--space-5);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--divider);
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-lightness-25);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		/* Room for the modal's close button, which is fixed at the top-right corner. */
		padding-right: 2.5rem;
	}

	.save-dialog {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 15rem);
		grid-template-areas:
			'preview options'
			'buttons buttons';
		gap: var(--space-6);
		outline: none;
	}

	@media (max-width: 640px) {
		.save-dialog {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'preview'
				'options'
				'buttons';
		}
	}

	.preview-pane {
		grid-area: preview;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* A checkerboard so a transparent background reads as transparent. */
	.preview-frame {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 10rem;
		max-height: 50vh;
		padding: var(--space-4);
		border: 1px solid var(--divider);
		border-radius: var(--radius-md);
		background-color: var(--surface-muted);
		background-image:
			linear-gradient(45deg, var(--color-lightness-92) 25%, transparent 25%),
			linear-gradient(-45deg, var(--color-lightness-92) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--color-lightness-92) 75%),
			linear-gradient(-45deg, transparent 75%, var(--color-lightness-92) 75%);
		background-size: 16px 16px;
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
		overflow: hidden;
		transition: opacity 0.15s ease;
	}
	.preview-frame.busy {
		opacity: 0.7;
	}

	.export-preview {
		display: block;
		max-width: 100%;
		max-height: calc(50vh - 2 * var(--space-4));
		width: auto;
		height: auto;
		object-fit: contain;
		box-shadow: var(--shadow-1);
	}

	.preview-empty {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--font-md);
	}

	.preview-caption {
		margin: 0;
		font-size: var(--font-sm);
		color: var(--color-text-muted);
	}

	.options-pane {
		grid-area: options;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	legend {
		padding: 0;
		margin-bottom: var(--space-2);
		font-size: var(--font-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.segmented {
		display: inline-flex;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		overflow: hidden;
		align-self: flex-start;
	}
	.segmented label {
		padding: var(--space-2) var(--space-5);
		font-size: var(--font-md);
		color: var(--color-lightness-35);
		cursor: pointer;
		user-select: none;
		background: var(--surface-card);
		transition:
			background 0.15s,
			color 0.15s;
	}
	.segmented label + label {
		border-left: 1px solid var(--color-lightness-85);
	}
	.segmented label:hover {
		background: var(--color-lightness-97);
	}
	.segmented label.active {
		background: var(--color-accent-fill);
		color: white;
		font-weight: 600;
	}
	.segmented label:focus-within {
		box-shadow: var(--shadow-focus-soft);
	}
	/* Visually hidden radios; the label carries the state. */
	.segmented input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
		margin: 0;
		pointer-events: none;
	}

	.check-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
		font-size: var(--font-md);
		color: var(--color-lightness-25);
		cursor: pointer;
	}
	.check-row input {
		margin: 0;
		accent-color: var(--color-accent-fill);
	}
	.check-row.indent {
		padding-left: var(--space-7);
	}
	.check-row.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.hint {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
	}
	.label-styles {
		display: flex;
	}
	.segmented.small label {
		padding: 0.15rem 0.6rem;
		font-size: var(--font-sm);
		font-variant-numeric: tabular-nums;
	}

	.format-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	/* A small number with its unit: "300 dpi", "W 500". */
	.unit-field {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		font-size: var(--font-sm);
		color: var(--color-text-muted);
	}
	.unit-field input {
		width: 4.6rem;
		min-width: 0;
		padding: 0.3rem 0.4rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		color: var(--color-lightness-25);
		font: inherit;
		font-size: var(--font-md);
		font-variant-numeric: tabular-nums;
	}
	.unit-field input:focus-visible {
		outline: none;
		border-color: var(--color-accent-fill);
		box-shadow: var(--shadow-focus-soft);
	}
	.unit-field input.invalid {
		border-color: var(--color-danger, #c0392b);
	}
	.dim-name {
		font-size: var(--font-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.unit {
		font-size: var(--font-xs);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		appearance: none;
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 999px;
		background: var(--surface-card);
		color: var(--color-lightness-35);
		font: inherit;
		font-size: var(--font-xs);
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}
	.chip:hover {
		background: var(--color-lightness-97);
	}
	.chip.active {
		background: var(--color-accent-fill);
		border-color: var(--color-accent-fill);
		color: white;
		font-weight: 600;
	}
	.chip:focus-visible {
		outline: none;
		box-shadow: var(--shadow-focus-soft);
	}

	.dims-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.dims-row .unit-field input {
		width: 4.2rem;
	}
	.dims-times {
		color: var(--color-text-muted);
		font-size: var(--font-sm);
	}
	.physical-size,
	.dims-note {
		margin: 0;
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.hint {
		margin: 0;
	}

	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.pager-label {
		font-size: var(--font-sm);
		font-weight: 600;
		color: var(--color-lightness-25);
		font-variant-numeric: tabular-nums;
	}
	.pager-btn {
		appearance: none;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--surface-card);
		color: var(--color-lightness-35);
		font: inherit;
		font-size: var(--font-sm);
		cursor: pointer;
	}
	.pager-btn:hover:not(:disabled) {
		background: var(--color-lightness-97);
	}
	.pager-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.pager-btn:focus-visible {
		outline: none;
		box-shadow: var(--shadow-focus-soft);
	}

	.data-links {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: 1px solid var(--divider-soft);
		font-size: var(--font-sm);
		color: var(--color-text-muted);
	}
	.link-btn {
		appearance: none;
		background: transparent;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--color-accent-text);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.link-btn:hover {
		color: color-mix(in srgb, var(--color-accent-text) 80%, black);
	}

	.button-row {
		grid-area: buttons;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.65rem;
		padding-top: var(--space-4);
		border-top: 1px solid var(--divider);
	}

	/* Same buttons as AreYouSure, so every dialog in the app reads the same. */
	.dialog-button {
		background: var(--color-lightness-95);
		color: var(--color-lightness-35);
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-lightness-85);
		padding: 0.55rem var(--space-6);
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}
	.dialog-button:hover:not(:disabled) {
		background: var(--color-lightness-90);
	}
	.dialog-button.primary {
		background: var(--color-accent-fill);
		border-color: var(--color-accent-fill);
		color: white;
	}
	.dialog-button.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent-fill) 88%, black);
		border-color: color-mix(in srgb, var(--color-accent-fill) 88%, black);
	}
	.dialog-button.ghost {
		background: var(--surface-card);
	}
	.dialog-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
