<script>
	let {
		showModal = $bindable(false),
		text = 'Are you sure?',
		options = ['Yes', 'No'],
		callback
	} = $props();
	import Modal from '$lib/components/reusables/Modal.svelte';

	/** @param {string} message */
	function getDestructiveActionLabel(message) {
		const lower = String(message ?? '').toLowerCase();
		if (lower.includes('delete')) return 'Delete';
		if (lower.includes('remove')) return 'Remove';
		if (lower.includes('discard')) return 'Discard';
		if (lower.includes('reset')) return 'Reset';
		if (lower.includes('overwrite')) return 'Overwrite';
		return null;
	}

	let destructiveAction = $derived.by(() => getDestructiveActionLabel(text));
	let renderedOptions = $derived.by(() => {
		return (options ?? []).map((option, index) => {
			const value = String(option ?? '');
			const isYes = /^yes$/i.test(value);
			const isNo = /^no$/i.test(value);
			const isCancel = /^cancel$/i.test(value);
			const isOk = /^ok$/i.test(value);
			const label = isYes && destructiveAction ? destructiveAction : isNo && destructiveAction ? 'Cancel' : value;

			let tone = 'secondary';
			if (isCancel || isNo) {
				tone = 'ghost';
			} else if (destructiveAction) {
				tone = 'destructive';
			} else if (isOk || (options?.length === 2 && index === 0)) {
				tone = 'primary';
			}

			return { value: option, label, tone };
		});
	});

	const emptySnippet = () => null;
</script>

<Modal
	bind:showModal
	width="30vw"
	max_height="20vh"
	header={emptySnippet}
	button={emptySnippet}
	showCloseButton={false}
>
	{#snippet children()}
		<div class="modal-shell">
			<div class="title-container">
				<h4>{text}</h4>
			</div>
			<div class="button-row">
				{#each renderedOptions as option}
				<button
					class={`dialog-button ${option.tone}`}
					onclick={() => {
						if (callback) callback(option.value);
						showModal = false;
					}}
				>
					{option.label}
				</button>
				{/each}
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.modal-shell {
		padding: 0.4rem;
	}

	.title-container {
		display: flex;
		align-items: flex-start;
		margin-bottom: 1rem;
	}

	h4 {
		margin: 0;
		color: var(--color-lightness-35);
		font-size: 1rem;
		line-height: 1.4;
	}

	.button-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.dialog-button {
		background: var(--color-lightness-95);
		color: var(--color-lightness-35);
		border-radius: 8px;
		border: 1px solid var(--color-lightness-85);
		padding: 0.55rem 1rem;
		font-weight: 600;
		font-size: 0.95rem;
		transition:
			background 0.15s,
			border-color 0.15s,
			transform 0.15s;
	}

	.dialog-button:hover {
		background: var(--color-lightness-90);
	}

	.dialog-button.primary {
		background: var(--color-hover);
		border-color: var(--color-hover);
		color: white;
	}

	.dialog-button.primary:hover {
		background: color-mix(in srgb, var(--color-hover) 92%, black);
		border-color: color-mix(in srgb, var(--color-hover) 92%, black);
	}

	.dialog-button.destructive {
		background: var(--color-error);
		border-color: var(--color-error);
		color: white;
	}

	.dialog-button.destructive:hover {
		background: color-mix(in srgb, var(--color-error) 90%, black);
		border-color: color-mix(in srgb, var(--color-error) 90%, black);
	}

	.dialog-button.ghost {
		background: white;
	}

	.dialog-button:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-hover) 45%, white);
		outline-offset: 2px;
	}
</style>
