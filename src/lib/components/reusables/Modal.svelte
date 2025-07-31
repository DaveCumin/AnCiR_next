<!-- 
Template from svelte offcial
https://svelte.dev/playground/modal?version=5.33.7
 -->
<script>
	import Icon from '$lib/icons/Icon.svelte';

	let {
		showModal = $bindable(),
		onclose = () => {},
		onopen = () => {},
		header,
		children,
		button,
		width = '36rem',
		max_height = '50vh'
	} = $props();
	import { fade } from 'svelte/transition';

	let dialog = $state();

	$effect(() => {
		if (showModal && !dialog?.open) {
			dialog?.showModal();
			onopen();
		} else if (!showModal && dialog?.open) {
			close();
		}
	});

	function close() {
		showModal = false;
		dialog.close();
		onclose();
	}
</script>

{#if showModal}
	<div class="backdrop" transition:fade={{ duration: 360 }}>
		<dialog
			style="width: {width}; max-height: {max_height}"
			bind:this={dialog}
			onclose={() => (showModal = false)}
			onclick={(e) => {
				if (e.target === dialog) {
					close();
				}
			}}
			transition:fade={{ duration: 360 }}
		>
			<div>
				<!-- svelte-ignore a11y_autofocus -->
				<button onclick={() => close()}>
					<Icon name="close" width={16} height={16} className="close" />
				</button>
			</div>

			<div class="dialog-container">
				{@render header?.()}
				{@render children?.()}
				{@render button?.()}
			</div>
		</dialog>
	</div>
{/if}

<style>
	dialog {
		border-radius: 5px;
		border: 1px, solid, var(--color-lightness-85);
		box-shadow:
			0 4px 8px 0 var(--color-lightness-85),
			0 6px 10px 0 var(--color-lightness-95);
	}
	.backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(255, 255, 255, 0);
		backdrop-filter: blur(0px);
	}

	/* Apply backdrop effect when dialog is open */
	.backdrop:not([hidden]) {
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
