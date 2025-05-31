<script>
	import { core } from '$lib/core/theCore.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
</script>


<div class="heading">
	<p>Worksheet Layers</p>

	<div class="add">
		<button>
			<Icon name="add" width={16} height={16} />
		</button>
	</div>
</div>

<div class="data-list">
	
</div>


<style>
	.heading {
		position: sticky;
		top: 0;

		width: 100%;
		height: 4vh;
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;

		border-bottom: 1px solid #d9d9d9;
		background-color: white;
	}

	.heading p {
		margin-left: 1rem;
		font-weight: bold;
	}

	button {
		background-color: transparent;
		border: none;
		margin-right: 0.6rem;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}
</style>
