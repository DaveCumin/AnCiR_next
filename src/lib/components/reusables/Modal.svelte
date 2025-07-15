<!-- 
Template from svelte offcial
https://svelte.dev/playground/modal?version=5.33.7
 -->
<script>
	import Icon from '$lib/icons/Icon.svelte';

	let { showModal = $bindable(), header, children } = $props();

	let dialog = $state();

	$effect(() => {
		if (showModal && !dialog.open) {
			dialog.showModal();
		} else if (!showModal && dialog.open) {
			dialog.close();
		}
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => (showModal = false)}
	onclick={(e) => {
		if (e.target === dialog) dialog.close();
	}}
>
	<div>
		<!-- svelte-ignore a11y_autofocus -->
		<button autofocus onclick={() => dialog.close()}>
			<Icon name="close" width={16} height={16} className="close" />
		</button>

		<div class="dialog-container">
			{@render header?.()}
			{@render children?.()}
		</div>
	</div>
</dialog>

<style>
	dialog {
		width: 36em;
		max-height: 50vh;
		border-radius: 5px;
		border: 1px, solid, var(--color-lightness-85);
		box-shadow:
			0 4px 8px 0 var(--color-lightness-85),
			0 6px 10px 0 var(--color-lightness-95);
	}

	dialog::backdrop {
		background: rgba(255, 255, 255, 0.8);
		backdrop-filter: blur(2px);
	}

	.dialog-container {
		margin-left: 20px;
		margin-right: 20px;
		margin-top: -5px;
		margin-bottom: 20px;
	}

	button {
		background-color: transparent;
		border: none;
		padding: 0;
		border-radius: 0;
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;

		margin-left: -0.2em;
		margin-top: -0.2em;
	}
</style>
