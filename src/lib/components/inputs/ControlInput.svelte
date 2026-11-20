<script>
	// @ts-nocheck
	import { setControlLabel } from './controlLabel.js';
	/**
	 * A single labelled control in the control panel.
	 *
	 * Renders the label as a real <label> element (when `associate` is true, the
	 * default) wrapping the control, so the control is *programmatically*
	 * associated with its label: screen readers announce the label, and clicking
	 * the label focuses/activates the control. This replaces the old
	 *   <div class="control-input"><p>Label</p><Control/></div>
	 * pattern, where the <p> had no link to the control (WCAG 1.3.1 / 4.1.2).
	 * src/lib/_tests/controlLabels.guard.test.js keeps the old pattern from coming back.
	 *
	 * Props:
	 *  - label: string label text (the common case).
	 *  - labelContent: optional snippet that overrides `label` for rich labels
	 *      (e.g. a trailing "mixed" tag). Receives no args.
	 *  - variant: '' | 'checkbox' | 'color' → picks the matching base class.
	 *  - associate: set false to render a plain <div> instead of a <label>, for
	 *      composite controls where a wrapping label would mis-handle clicks (a
	 *      dropdown trigger, a colour swatch whose popup renders inside it, a switch
	 *      with its own <label>). The label span then gets an id, shared through
	 *      controlLabel.js, and ColumnSelector, ColourPicker, Toggle, DateTimeHrs and
	 *      ColourPaletteSelect name themselves from it (aria-labelledby). A control
	 *      that is NOT inside (the plot series rows, where the label sits above a
	 *      <Column>) is named by passing `id` here and `labelledby={id}` to it.
	 *  - group: with associate false, makes the wrapper a role="group" named by the
	 *      label, for a row of controls that share it (an icon-button row).
	 *  - id: the label span's id (only rendered when associate is false); defaults
	 *      to a generated one.
	 *  - class: extra classes on the wrapper (e.g. control-input-swatch).
	 *  - style: forwarded inline style on the wrapper (e.g. max-width).
	 *  - children: the control itself.
	 */
	let {
		label = '',
		labelContent = undefined,
		variant = '',
		associate = true,
		group = false,
		id = undefined,
		class: extraClass = '',
		style = '',
		children
	} = $props();

	const uid = $props.id();
	const cls = $derived(variant ? `control-input-${variant}` : 'control-input');
	const hasLabel = $derived(labelContent != null || label !== '');
	const labelId = $derived(!associate && hasLabel ? (id ?? `${uid}-label`) : undefined);

	// Getters, so a control reading this at init still sees a label that changes later.
	setControlLabel({
		get id() {
			return labelId ?? null;
		},
		get label() {
			return label;
		}
	});
</script>

<svelte:element
	this={associate ? 'label' : 'div'}
	class={[cls, extraClass]}
	{style}
	role={group && !associate ? 'group' : undefined}
	aria-labelledby={group && !associate ? labelId : undefined}
>
	{#if hasLabel}
		<span class="ci-label" id={labelId}>
			{#if labelContent}{@render labelContent()}{:else}{label}{/if}
		</span>
	{/if}
	{@render children?.()}
</svelte:element>
