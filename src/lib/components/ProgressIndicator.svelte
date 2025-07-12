<script>
	import { tick } from 'svelte';

	// Props for the component
	let {
		steps = $bindable(), // Array of { label: string, completed: boolean, active: boolean, isExpanded: boolean }
		currentStep = $bindable(0), // Index of the current active step
		stepContent // Snippet function: (index, step) => content
	} = $props();

	// Debug logging
	$effect(() => {
		console.log('ProgressIndicator: steps =', steps);
		console.log('ProgressIndicator: currentStep =', currentStep);
		console.log('ProgressIndicator: stepContent defined =', !!stepContent);
	});

	// Ensure currentStep stays within bounds and manage active state
	$effect(() => {
		if (!steps || steps.length === 0) {
			currentStep = 0;
			console.log('ProgressIndicator: No steps, setting currentStep to 0');
			return;
		}
		if (currentStep < 0) {
			currentStep = 0;
			console.log('ProgressIndicator: Clamped currentStep to 0');
		}
		if (currentStep >= steps.length) {
			currentStep = steps.length - 1;
			console.log('ProgressIndicator: Clamped currentStep to', currentStep);
		}

		// Ensure only the current step is active and set isExpanded for completed steps
		steps.forEach((step, i) => {
			if (step) {
				step.active = i === currentStep;
				// Initialize isExpanded: true for completed steps, false otherwise
				if (step.completed && step.isExpanded === undefined) {
					step.isExpanded = true;
				} else if (!step.completed && step.isExpanded === undefined) {
					step.isExpanded = false;
				}
			}
		});
	});

	// Function to toggle step expansion
	function toggleStep(index) {
		if (!steps[index]) {
			console.log('ProgressIndicator: Invalid step index', index);
			return;
		}
		if (steps[index].completed) {
			// Toggle isExpanded for completed steps
			steps[index].isExpanded = !steps[index].isExpanded;
			console.log(
				'ProgressIndicator: Toggled isExpanded for step',
				index,
				'to',
				steps[index].isExpanded
			);
		} else if (index === currentStep) {
			// For the current step, do nothing (remains expanded)
		} else {
			// For incomplete steps, move to that step
			currentStep = index;
			console.log('ProgressIndicator: Toggled to step', index);
		}
	}

	// Update completed status when moving to next/previous step
	async function goToStep(index) {
		if (!steps || index < 0 || index >= steps.length) {
			console.log('ProgressIndicator: Invalid goToStep index', index);
			return;
		}
		// Mark all steps up to the current as completed and expanded
		for (let i = 0; i <= index; i++) {
			if (steps[i]) {
				steps[i].completed = true;
				steps[i].isExpanded = true; // Expand completed steps by default
			}
		}
		currentStep = index;
		console.log('ProgressIndicator: Moved to step', index);
		await tick(); // Ensure DOM updates before animations
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
					aria-expanded={index === currentStep || step.isExpanded}
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
				<div class="step-content" class:expanded={index === currentStep || step.isExpanded}>
					<div class="content-inner">
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
					></div>
				{/if}
			</div>
		{/each}
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
		margin: 20px auto;
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
		padding: 10px;
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
		margin-right: 12px;
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
		max-height: 500px; /* Adjust based on content */
	}

	.content-inner {
		padding: 10px 20px 20px 48px; /* Align with step indicator */
		border-left: 2px solid #e5e7eb;
		margin-left: 12px;
	}

	.progress-line {
		width: 2px;
		height: 40px;
		background-color: #e5e7eb;
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

	button {
		padding: 8px 16px;
		background-color: #3b82f6;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 14px;
	}

	button:hover {
		background-color: #2563eb;
	}

	button:disabled {
		background-color: #9ca3af;
		cursor: not-allowed;
	}
</style>
