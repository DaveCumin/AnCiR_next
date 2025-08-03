<script>
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	let { showDropdown = $bindable(), top = 0, left = 0, groups } = $props();
	let dialog = $state();

	$effect(() => {
		if (showDropdown && !dialog.open) {
			dialog.showModal();
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
		} else if (!showDropdown && dialog?.open) {
			dialog.close();
		}
	});
</script>

{#if showDropdown}
	<dialog
		bind:this={dialog}
		onclose={() => (showDropdown = false)}
		style={`top: ${top}px; left: ${left}px`}
		onclick={(e) => {
			e.stopPropagation();
			showDropdown = false;
		}}
	>
		<div>
			<div
				class="group"
				onmouseleave={(e) => {
					dispatch('mouseOut', e);
				}}
			>
				{@render groups?.()}
			</div>
		</div>
	</dialog>
{/if}

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
