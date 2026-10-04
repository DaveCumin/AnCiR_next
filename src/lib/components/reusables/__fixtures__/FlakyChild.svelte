<script>
	// @ts-nocheck
	// Test fixture: throws while rendering whenever `control.fail` is set, otherwise renders
	// its label. `control` is a plain object the test flips between mounts.
	let { control, label } = $props();
	// Read inside a function so the throw happens at mount without capturing the props'
	// initial values at the top level (state_referenced_locally).
	const failIfAsked = () => {
		if (control.fail) throw new Error(`${label} broke`);
	};
	failIfAsked();
</script>

<span data-testid={label}>{label} ok</span>
