<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import { appState } from '$lib/core/core.svelte.js';
	import { exportJson, importJson } from '$lib/components/iconActions/Setting.svelte';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { tick } from 'svelte';

	let {
		handleTooltip = () => {}
	} = $props();

	let fileInput;

	function tooltip(content) {
		return {
			onmouseenter: (e) =>
				handleTooltip({ detail: { visible: true, x: e.clientX + 10, y: e.clientY + 10, content } }),
			onmouseleave: (e) =>
				handleTooltip({ detail: { visible: false, x: e.clientX + 10, y: e.clientY + 10, content: '' } })
		};
	}

	async function handleLoad(e) {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			const json = JSON.parse(text);
			appState.loadingState.isLoading = true;
			appState.loadingState.loadingMsg = 'Loading session…';
			await tick();
			await importJson(json, (detail) => {
				appState.loadingState.loadingMsg = detail;
			});
		} catch (err) {
			addNotification(`Failed to load session: ${err?.message ?? err}`);
		} finally {
			appState.loadingState.isLoading = false;
			appState.loadingState.loadingMsg = '';
			e.target.value = '';
		}
	}
</script>

<button
	type="button"
	class="nav-btn"
	onclick={exportJson}
	{...tooltip('Save session to file')}
>
	<Icon name="disk" />
</button>

<button
	type="button"
	class="nav-btn"
	onclick={() => fileInput?.click()}
	{...tooltip('Load session from file')}
>
	<Icon name="add-file" />
</button>

<input
	bind:this={fileInput}
	type="file"
	accept="application/json"
	style="display: none"
	onchange={handleLoad}
/>

<style>
	.nav-btn {
		background: transparent;
		border: none;
		padding: 0.3rem 0.5rem;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
		border-radius: 0.25rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.nav-btn:hover {
		background: var(--color-lightness-95, #eee);
	}
</style>
