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
		showCloseButton = true,
		width = '36rem',
		max_height = '75vh'
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
		<!-- The dialog is in the top layer visually but still a DOM descendant of
		     wherever it was mounted, so its clicks, pointer-downs and wheel events would
		     bubble into the host (a canvas that deselects on click, pans on pointerdown
		     and zooms on wheel, unmounting the modal mid-interaction). A modal owns its
		     input; stop them here. -->
		<dialog
			style="width: calc({width} + 2em); max-height: calc({max_height} + 2em)"
			bind:this={dialog}
			onclose={() => {
				// The browser closed the dialog itself (Escape), so close() never ran and the
				// caller's onclose is still owed (ROB-25). When close() did run it set showModal
				// false before dialog.close(), so this skips it and onclose runs once.
				if (!showModal) return;
				showModal = false;
				onclose();
			}}
			onclick={(e) => {
				e.stopPropagation();
				if (e.target === dialog) {
					close();
				}
			}}
			onpointerdown={(e) => e.stopPropagation()}
			onwheel={(e) => e.stopPropagation()}
			transition:fade={{ duration: 360 }}
		>
			<!-- The close button sits in its own bar above the scrolling body, so a long dialog
			     scrolls BELOW it and never under it (it used to be position: fixed over the
			     content, covering whatever scrolled past). -->
			{#if showCloseButton}
				<div class="modal-topbar">
					<button class="modal-close" aria-label="Close" onclick={() => close()}>
						<Icon name="close" width={16} height={16} className="close" />
					</button>
				</div>
			{/if}

			<div class="modal-body" class:no-topbar={!showCloseButton}>
				<div class="dialog-container">
					{@render header?.()}
					{@render children?.()}
					{@render button?.()}
				</div>
			</div>
		</dialog>
	</div>
{/if}

<style>
	dialog {
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-lightness-85);
		box-shadow: var(--shadow-3);
		/* The body scrolls, not the dialog: the top bar stays put above it. The 1em side
		   padding moved onto the body, so the inline width and max-height add it back (same outer and
		   content widths as before). */
		padding: 0;
		overflow: hidden;
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
	}
	.modal-topbar {
		flex: none;
		display: flex;
		justify-content: flex-end;
		padding: var(--space-3) var(--space-3) 0;
	}
	.modal-body {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding: 0 1em 1em;
	}
	/* Without the bar, the content starts where it always did (1em less the old 5px pull-up). */
	.modal-body.no-topbar {
		padding-top: calc(1em - 5px);
	}
	/* A modal owns its pointer events, whatever its host does with them. The plot
	   toolbar mounts its Save dialog inside a `pointer-events: none` host (so the
	   toolbar strip lets clicks fall through to the canvas), and without this the
	   inherited value made the whole dialog unclickable. */
	dialog,
	.backdrop {
		pointer-events: auto;
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
		margin: 0 20px 20px;
	}

	.modal-close {
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background-color: transparent;
		cursor: pointer;
	}
</style>
