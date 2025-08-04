<script>
	import { tick } from 'svelte';

	// Props for the component
	let {
		steps = $bindable(), // Array of { label: string, completed: boolean, active: boolean, isExpanded: boolean }
		currentStep = $bindable(0), // Index of the current active step
		stepContent, // Snippet function: (index, step) => content
		footerContent // snipped for the end (Accept, eg)
	} = $props();

	// Function to toggle step expansion
	function toggleStep(index) {
		if (!steps[index]) {
			return;
		}
		// Allow toggling for active or completed steps
		if (steps[index].completed || index === currentStep || steps[index - 1]?.completed) {
			steps[index].isExpanded = !steps[index].isExpanded;
		} else {
			// For incomplete and non-active steps, move to that step without expanding
			// currentStep = index;
			// steps[index].isExpanded = true; // Expand the new active step
			// console.log('ProgressIndicator: Moved to step', index);
		}
	}
</script>

<div class="progress-indicator">
	{#if steps && steps.length > 0}
		{#each steps as step, index (index)}
			<div class="step" class:completed={step.completed} class:active={index === currentStep}>
				<!-- Step Header -->
				<div
					class="step-header"
					role="button"
					aria-expanded={step.isExpanded}
					onclick={() => toggleStep(index)}
				>
					<div class="step-indicator">
						{#if step.completed}
							<span class="checkmark" aria-label="Completed">✔</span>
						{:else if index === currentStep}
							<span class="active-dot" aria-label="Active step"></span>
						{:else}
							<span class="dot" aria-label="Incomplete step"></span>
						{/if}
					</div>
					<span class="step-label">{step.label || `Step ${index + 1}`}</span>
				</div>

				<!-- Step Content (Accordion) -->
				<div class="step-content" class:expanded={step.isExpanded}>
					<div
						class="content-inner"
						style="border-left: 2px solid {step.completed ? '#10b981' : '#e5e7eb'};"
					>
						{#if stepContent}
							{@render stepContent(index, step)}
						{:else}
							<p>No content provided for {step.label || `Step ${index + 1}`}</p>
						{/if}
					</div>
				</div>

				<!-- Progress Line (except for last step) -->
				{#if index < steps.length - 1}
					<div
						class="progress-line"
						class:completed={step.completed && steps[index + 1]?.completed}
						style="background-color: {step.completed ? '#10b981' : '#e5e7eb'};"
					></div>
				{/if}
			</div>
		{/each}
		{#if footerContent}
			{@render footerContent()}
		{/if}
	{:else}
		<p>No steps provided</p>
	{/if}
</div>

<style>
	.progress-indicator {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		max-width: 600px;
		margin: 5px;
		font-family: Arial, sans-serif;
	}

	.step {
		display: flex;
		flex-direction: column;
		width: 100%;
		position: relative;
	}

	.step-header {
		display: flex;
		align-items: center;
		padding: 5px;
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.step-header:hover {
		background-color: #f5f5f5;
	}

	.step-indicator {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: 6px;
		margin-left: -3px;
	}

	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background-color: #ccc;
	}

	.active-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background-color: #3b82f6;
	}

	.checkmark {
		color: #10b981;
		font-size: 16px;
		font-weight: bold;
	}

	.step-label {
		font-size: 16px;
		font-weight: 500;
		color: #333;
	}

	.step.completed .step-label {
		color: #10b981;
	}

	.step.active .step-label {
		color: #3b82f6;
	}

	.step-content {
		max-height: 0;
		overflow: hidden;
		transition: max-height 0.3s ease;
	}

	.step-content.expanded {
		max-height: 1500px; /* Adjust based on content */
	}

	.content-inner {
		padding: 10px 10px 10px 24px; /* Align with step indicator */
		margin-left: 12px;
	}

	.progress-line {
		width: 2px;
		height: 10px;
		margin-top: -2px;
		margin-left: 12px; /* Center under step indicator */
	}

	.progress-line.completed {
		background-color: #10b981;
	}

	.navigation {
		display: flex;
		gap: 10px;
		margin-top: 20px;
		margin-left: 48px;
	}
</style>
