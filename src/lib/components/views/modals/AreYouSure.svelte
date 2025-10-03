<script>
	let {
		showModal = $bindable(false),
		text = 'Are you sure?',
		options = ['Cancel', 'Remove'],
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
			style="display: flex; flex-direction: row; align-content: center; justify-content: right; gap: 0.5rem;"
		>
			{#each options as option}
				<button
					class="dialog-button"
					class:dialog-button-cancel={option === 'Cancel'}
					class:dialog-button-close={option === 'Remove'}
					style="width: 6rem;"
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
	.dialog-button {
		background: var(--color-lightness-95);
		color: var(--color-lightness-35);
		border-radius: 6px;
		border: none;
		padding: 0.5em 1.5em;
		margin: 0.5em;
		font-weight: bold;
		font-size: 1rem;
		transition: background 0.15s;

		display: flex;
		justify-content: center;
		align-items: center;
	}
	/* .dialog-button:hover {
		background: var(--color-lightness-90);
	} */
</style>
