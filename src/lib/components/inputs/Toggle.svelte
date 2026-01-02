<script>
	let {
		value = $bindable(),
		onChange = (v) => {},
		Labels = ['On', 'Off'],
		inactiveColor = '#b3b3b3',
		activeColor = '#737373',
		untoggleColour = '#b3b3b3',
		toggleColour = '#737373',
		buttonColour = '#fafafa'
	} = $props();
	let checked = $state(false);
	function change(v) {
		onChange(v);
	}
</script>

<div class="toggle-wrapper">
	<span
		class="toggle-label off"
		class:active={!checked}
		style="--active-color: {activeColor}; --inactive-color: {inactiveColor}">{Labels[0]}</span
	>
	<label class="toggle-switch">
		<input type="checkbox" bind:checked onchange={(v) => change(v.target.checked)} />
		<span
			class="slider"
			style="--toggleColour-color: {toggleColour}; --untoggleColour-color:{untoggleColour}; --buttonColour-color:{buttonColour};"
		></span>
	</label>
	<span
		class="toggle-label on"
		class:active={checked}
		style="--active-color: {activeColor}; --inactive-color: {inactiveColor}">{Labels[1]}</span
	>
</div>

<style>
	.toggle-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: inherit;
		font-family: inherit;
		font-weight: inherit;
	}

	.toggle-label {
		user-select: none;
		color: var(--inactive-color, rgba(50, 50, 50, 0.7));
	}

	/* Active state: uses custom color and bold */
	.toggle-label.active {
		color: var(--active-color);
	}

	/* Toggle styles */
	.toggle-switch {
		position: relative;
		display: inline-block;
		width: 2rem;
		height: 1rem;
		cursor: pointer;
	}

	.toggle-switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.slider {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: var(--toggleColour-color);
		border-radius: 1rem;
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
		transition: background-color 0.3s ease;
	}

	.slider:before {
		content: '';
		position: absolute;
		height: 0.8rem;
		width: 0.8rem;
		left: 0.1rem;
		bottom: 0.1rem;
		background-color: var(--buttonColour-color);
		border-radius: 50%;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
		transition: transform 0.3s ease;
	}

	.toggle-switch input:checked + .slider {
		background-color: var(--untoggleColour-color);
	}

	.toggle-switch input:checked + .slider:before {
		transform: translateX(1rem);
	}

	.toggle-switch input:focus-visible + .slider {
		outline-offset: 2px;
	}
</style>
