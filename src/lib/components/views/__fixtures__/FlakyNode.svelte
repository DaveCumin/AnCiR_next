<script>
	// @ts-nocheck
	// Test fixture: a node component (`p` prop, like every analysis) that throws while
	// rendering when `p.args.fail` is set.
	let { p } = $props();
	// Read inside a function so the throw happens at mount without capturing the prop's
	// initial value at the top level (state_referenced_locally).
	const failIfAsked = () => {
		if (p.args.fail) throw new Error(`node ${p.id} broke`);
	};
	failIfAsked();
</script>

<span data-testid={`node-${p.id}`}>node {p.id} computing</span>
