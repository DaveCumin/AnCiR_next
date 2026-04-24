<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';

	/**
	 * Presentational chrome around a table-process's inner component:
	 * delete button, title, and the outer container. Body content
	 * (inner TP component, chain selector, chained panel) is supplied
	 * as the `children` snippet by TableProcess.svelte.
	 *
	 * `onDelete` is the handler fired when the user clicks the delete
	 * button. Kept as a prop so the shell stays agnostic about how
	 * parent coordinates the deletion flow (confirm modal, etc.).
	 */
	let { p, onDelete, children = undefined } = $props();
</script>

{#if p}
	<div class="tableProcess-container">
		<div
			class="control-component-title-icons"
			style="margin-bottom: -1.75rem; z-index: 9999; margin-top: 0.25rem;"
		>
			<button class="icon" onclick={() => onDelete(p)}>
				<Icon name="minus" width={16} height={16} className="menu-icon" />
			</button>
		</div>
		<div style="margin-top: 0.7rem;">{p.displayName}</div>
		{@render children?.()}
	</div>
{/if}
