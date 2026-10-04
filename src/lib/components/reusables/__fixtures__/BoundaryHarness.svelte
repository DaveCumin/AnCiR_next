<script>
	// @ts-nocheck
	// Test fixture: two siblings, each in its own ErrorBoundary, the way a worksheet holds
	// plot cards or the compute host holds hidden node instances.
	import ErrorBoundary from '../ErrorBoundary.svelte';
	import FlakyChild from './FlakyChild.svelte';

	let { a, b } = $props();
</script>

<ErrorBoundary context="drawing A" title="A couldn't be drawn.">
	<FlakyChild control={a} label="A" />
</ErrorBoundary>
<ErrorBoundary context="drawing B" title="B couldn't be drawn.">
	<FlakyChild control={b} label="B" />
</ErrorBoundary>
