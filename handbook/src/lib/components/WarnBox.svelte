<script>
	let { title = 'Watch Out', children } = $props();
</script>

<div class="box box-warn">
	<div class="box-title">⚠️ {title}</div>
	{@render children()}
</div>

<style>
	.box-warn {
		background: #fff7ed;
		border-color: #ea580c;
	}
	.box-warn .box-title {
		color: #9a3412;
	}
</style>
