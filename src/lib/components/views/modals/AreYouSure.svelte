<script>
	let {
		showModal = $bindable(false),
		text = 'Are you sure?',
		options = ['Yes', 'No'],
		callback
	} = $props();
	import Modal from '$lib/components/reusables/Modal.svelte';
</script>

<Modal bind:showModal width="30vw" max_height="20vh">
	{#snippet children()}
		<div class="title-container">
			<div id="logo-container" style="width: 36px; height: 36px;"></div>
			<h4>{text}</h4>
		</div>
		<div
			style="    display: flex; flex-direction: row; align-content: center; justify-content: center;"
		>
			{#each options as option}
				<button
					class="dialog-button"
					style="margin: 0.5em;"
					onclick={() => {
						if (callback) callback(option);
						showModal = false;
					}}
				>
					{option}
				</button>
			{/each}
		</div>
	{/snippet}
</Modal>

<style>
	.title-container {
		display: flex;
		justify-content: left; /* Left horizontally */
		align-items: center; /* Center vertically */
		gap: 10px; /* Space between logo and text */
	}
</style>
