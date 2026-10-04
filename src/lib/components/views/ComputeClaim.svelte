<script>
	// @ts-nocheck
	// Renders nothing. Mounted beside a node's visible computing instance (a plot card, a
	// plot preview, a facet generator's headless instance), it claims the node in the
	// compute-owner registry for exactly as long as it is mounted, which stands down
	// NodeComputeHost's hidden instance of that node. For mount sites with no element of
	// their own to attach to; an element can use the `computeOwner` attachment instead.
	import { claimComputeOwner } from '$lib/core/computeOwners.svelte.js';

	let { computeKey } = $props();

	$effect(() => claimComputeOwner(computeKey));
</script>
