<script>
    export let top = 0;
	export let left = 0;
</script>

<div class="dropdown" style="top: {top}px; left: {left}px;">
    <p>hello</p>
</div>



<style>
	.dropdown {
		position: fixed;
		z-index: 999;
		min-width: 8vw;
		
		background-color: #d9d9d9;
		margin-top: 4px;
		margin-left: 8px;
	}
</style>