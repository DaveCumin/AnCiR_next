<script>
	// @ts-nocheck
	// A plot that fails the way a real one does: during render, reading a field its fromJSON
	// left undefined. Stands in for the periodogram whose `periodlimsIN` was clobbered.
	let { theData } = $props();
	const boom = theData.plot.periodlimsIN[0];
</script>

<div>{boom}</div>
