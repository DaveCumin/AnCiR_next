<script>
	let { showDropdown = $bindable(), top = 0, left = 0, groups } = $props();

	let dialog = $state();

	$effect(() => {
		if (showDropdown && !dialog.open) {
			dialog.showModal(); // dialog function
			//move it to be within the page
			const rect = dialog.getBoundingClientRect();
			const padding = 10;
			if (rect.right > window.innerWidth - padding) {
				left = window.innerWidth - rect.width - padding;
			}
			if (rect.left < 0) {
				left = 0;
			}
			if (rect.bottom > window.innerHeight - padding) {
				top = window.innerHeight - rect.height - padding;
			}
			if (rect.top < 0) {
				top = 0;
			}
		} else if (!showDropdown && dialog.open) {
			dialog.close();
		}
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => (showDropdown = false)}
	onclick={(e) => {
		e.stopPropagation();
		if (e.target === dialog) dialog.close();
	}}
	style={`top: ${top}px; left: ${left}px`}
>
	<div>
		<!-- svelte-ignore a11y_autofocus -->
		<div class="group">
			{@render groups?.()}
		</div>
	</div>
</dialog>

<style>
	dialog {
		z-index: 999;
		width: 200px;

		display: flex;
		flex-direction: column;

		padding: 0;
		margin-top: 4px;
		margin-left: 8px;

		background-color: white;
		border-radius: 4px;
		border: 1px solid var(--color-lightness-85);

		box-shadow:
			0 4px 8px 0 var(--color-lightness-85),
			0 6px 10px 0 var(--color-lightness-95);
	}

	dialog::backdrop {
		background: rgba(255, 255, 255, 0);
		/* backdrop-filter: blur(2px); */
	}

	.group {
		display: flex;
		flex-direction: column;
	}
</style>
