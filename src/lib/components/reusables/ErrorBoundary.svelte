<script>
	// Error containment for one piece of the UI (ROB-12): a node body, a workspace plot card,
	// a facet panel, a hidden compute instance.
	//
	// Without a boundary, a component that throws while rendering (or in one of its effects)
	// unmounts the whole tree above it: one plot wired to the wrong columns, or one analysis
	// fed a column it cannot read, blanked the entire canvas and the session looked lost.
	// Inside one, only this piece is replaced by an ErrorBox with the message and a retry
	// (which re-mounts the content, e.g. after the user fixes the wiring), and the error is
	// reported once through reportError with source 'render', whose toast can then truthfully
	// say it was contained.
	//
	// A boundary catches errors thrown during render and in effects of its subtree. It does
	// not see errors from event handlers, timers or promises: those reach the window-level
	// handler in errorReporter.js, and an async analysis reports its own failure on the node
	// (core/asyncCompute.js).
	import { reportError } from '$lib/core/errorReporter.js';
	import ErrorBox from './ErrorBox.svelte';

	let {
		children,
		/** What was being drawn, for the toast: "while <context>". */
		context = '',
		title = 'This part could not be shown.',
		hint = '',
		/** 'render' for something on screen; 'background' for a hidden compute instance,
		 *  whose error box nobody sees (the toast says so). */
		source = 'render'
	} = $props();
</script>

<svelte:boundary onerror={(e) => reportError(e, { source, context: context || undefined })}>
	{@render children?.()}

	{#snippet failed(error, reset)}
		<ErrorBox
			{title}
			message={error?.message ?? String(error ?? 'Unknown error')}
			{hint}
			onretry={reset}
		/>
	{/snippet}
</svelte:boundary>
