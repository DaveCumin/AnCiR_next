<script>
	let { title = 'Key Point', children } = $props();
</script>

<div class="box box-note">
	<div class="box-title">📌 {title}</div>
	{@render children()}
</div>

<style>
	.box-note {
		background: #f0fdf4;
		border-color: #16a34a;
	}
	.box-note .box-title {
		color: #15803d;
	}
</style>
