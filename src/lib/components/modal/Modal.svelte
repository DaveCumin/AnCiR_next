<!-- 
 
Template from svelte offcial
https://svelte.dev/playground/modal?version=5.33.7
 
-->
<script>
	import Icon from "$lib/icon/Icon.svelte";

let { showModal = $bindable(), header, children } = $props()

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
	onclick={(e) => { if (e.target === dialog) dialog.close(); }}
>
	<div>
		<!-- svelte-ignore a11y_autofocus -->
		<button autofocus onclick={() => dialog.close()}>
			<Icon name="close" width={16} height={16} className="close"/>
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
		border-radius: 5px;
		border: var(--color-lightness-85);
	}

	dialog::backdrop {
		background-color: rgba(0, 0, 0, 0.05);
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
