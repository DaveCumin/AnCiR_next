<script>
	let { usecanvas, container = $bindable(), width, height } = $props();
</script>

{#if !usecanvas}
	<svg bind:this={container} {width} {height} style={`background: white; position: absolute;`}>
		<slot></slot>
	</svg>
{:else}
	<canvas
		bind:this={container}
		{width}
		{height}
		style={`background: white; position: absolute; `}
	/>
	<slot></slot>
{/if}
