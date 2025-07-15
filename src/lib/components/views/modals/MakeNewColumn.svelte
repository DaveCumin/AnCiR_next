<script>
	import ProgressIndicator from '$lib/components/ProgressIndicator.svelte';
	import Modal from '$lib/components/reusables/Modal.svelte';
	let steps = $state([
		{ label: 'lab 1', completed: false, isExpanded: true },
		{ label: 'lab 2', completed: false, isExpanded: false },
		{ label: 'lab 3', completed: false, isExpanded: false },
		{ label: 'lab 4', completed: false, isExpanded: false }
	]);

	//This assumes that each step must be completed before the next
	let currentStep = $derived.by(() => {
		//look backwards to find the last completed step and make the next one the current one
		for (let i = steps.length - 1; i >= 0; i--) {
			console.log(i, steps[i]);
			if (steps[i].completed) {
				return i + 1;
			}
		}
		return 0;
	});

	function enforceSequentialCompletion(changedIndex) {
		// If the changed step is marked incomplete, reset all subsequent steps
		if (!steps[changedIndex].completed) {
			for (let i = changedIndex + 1; i < steps.length; i++) {
				steps[i].completed = false;
				steps[i].isExpanded = false;
			}
		}
	}

	let { show } = $props();
</script>

{#snippet stepContent(index, step)}
	{#if index === 0}
		<p>Content for Lab 1</p>
		<input
			type="text"
			placeholder="Enter data for Lab 1"
			oninput={(e) => {
				step.completed = e.target.value !== '';
				enforceSequentialCompletion(index);
			}}
		/>
	{:else if index === 1}
		<p>Content for Lab 2</p>
		<textarea
			placeholder="Enter details for Lab 2"
			oninput={(e) => {
				step.completed = e.target.value !== '';
				enforceSequentialCompletion(index);
			}}
		></textarea>
	{:else if index === 2}
		<p>Content for Label 3</p>
		<textarea
			placeholder="Enter details for Label 3"
			oninput={(e) => {
				step.completed = e.target.value !== '';
				enforceSequentialCompletion(index);
			}}
		></textarea>
	{:else if index === 3}
		<p>Content for Lab 4</p>
		<textarea
			placeholder="Enter details for Lab 4"
			oninput={(e) => {
				step.completed = e.target.value !== '';
				enforceSequentialCompletion(index);
			}}
		></textarea>
	{/if}
{/snippet}

<Modal bind:showModal={show}>
	<ProgressIndicator bind:steps bind:currentStep {stepContent} />
</Modal>
