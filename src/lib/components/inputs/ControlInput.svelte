<script>
	// @ts-nocheck
	/**
	 * A single labelled control in the control panel.
	 *
	 * Renders the label as a real <label> element (when `associate` is true, the
	 * default) wrapping the control, so the control is *programmatically*
	 * associated with its label: screen readers announce the label, and clicking
	 * the label focuses/activates the control. This replaces the old
	 *   <div class="control-input"><p>Label</p><Control/></div>
	 * pattern, where the <p> had no link to the control (WCAG 1.3.1 / 4.1.2).
	 *
	 * Props:
	 *  - label: string label text (the common case).
	 *  - labelContent: optional snippet that overrides `label` for rich labels
	 *      (e.g. a trailing "mixed" tag). Receives no args.
	 *  - variant: '' | 'checkbox' | 'color' → picks the matching base class.
	 *  - associate: set false to render a plain <div> instead of a <label>, for
	 *      composite controls where a wrapping label would mis-handle clicks
	 *      (multi-input widgets, lists, etc.).
	 *  - style: forwarded inline style on the wrapper (e.g. max-width).
	 *  - children: the control itself.
	 */
	let {
		label = '',
		labelContent = undefined,
		variant = '',
		associate = true,
		style = '',
		children
	} = $props();

	const cls = $derived(variant ? `control-input-${variant}` : 'control-input');
	const hasLabel = $derived(labelContent != null || label !== '');
</script>

<svelte:element this={associate ? 'label' : 'div'} class={cls} {style}>
	{#if hasLabel}
		<span class="ci-label">
			{#if labelContent}{@render labelContent()}{:else}{label}{/if}
		</span>
	{/if}
	{@render children?.()}
</svelte:element>
