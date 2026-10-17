<script>
	// The Overlays tab of a host plot (overlays plan 2026-10-15): the `+ Add line` / `+ Add band` row
	// (the shared BlockAdd row, with a one-line empty state)
	// and one block per overlay. A button is shown only when the host allows at least one form
	// of its kind (overlayCapabilities). Each host keeps the literal
	// `{:else if appState.currentControlTab === 'overlays'}` branch that mounts this
	// (controlTabsCoverage.test.js greps for it).
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';
	import { dataSettingsScrollTo } from '$lib/components/views/dataSettingsScroll.js';
	import Overlay from './Overlay.svelte';
	import BlockAdd from './BlockAdd.svelte';
	import { allowedForms, capabilitiesOf } from './overlaySpec.js';

	let {
		/** the host plot's inner data object (see overlayHost.js) */
		inner
	} = $props();

	const lineForms = $derived(allowedForms(capabilitiesOf(inner), 'line'));
	const bandForms = $derived(allowedForms(capabilitiesOf(inner), 'band'));

	/** 'a, b or c' */
	function either(list) {
		return list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;
	}

	async function add(kind) {
		inner.addOverlay(kind);
		await tick();
		dataSettingsScrollTo('bottom');
	}
</script>

<div id="overlaySettings">
	<BlockAdd
		actions={[
			...(lineForms.length > 0
				? [
						{
							label: 'Add line',
							tooltip: `Add a reference line (${either(lineForms)})`,
							onadd: () => add('line')
						}
					]
				: []),
			...(bandForms.length > 0
				? [
						{
							label: 'Add band',
							tooltip: `Add a shaded band (${either(bandForms)})`,
							onadd: () => add('band')
						}
					]
				: [])
		]}
		count={inner.overlays.length}
		empty="No reference lines or bands yet"
	/>

	{#each inner.overlays as overlay (overlay.id)}
		<div
			class="dataBlock"
			animate:flip={{ duration: 500 }}
			in:slide={{ duration: 500, axis: 'y' }}
			out:slide={{ duration: 500, axis: 'y' }}
		>
			<Overlay {overlay} {inner} which="controls" />
			<div class="div-line"></div>
		</div>
	{/each}
</div>
