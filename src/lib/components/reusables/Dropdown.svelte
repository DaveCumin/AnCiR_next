<script>
	let { showDropdown = $bindable(), top = 0, left = 0, groups } = $props();
	let dialog = $state();
	let activeSubmenu = $state(null);
	let submenuTimeouts = new Map();

	$effect(() => {
		if (showDropdown && !dialog?.open) {
			dialog?.showModal();
			adjustPosition();
		} else if (!showDropdown && dialog?.open) {
			dialog?.close();
			activeSubmenu = null;
		}
	});

	function adjustPosition() {
		if (!dialog) return;

		const rect = dialog.getBoundingClientRect();
		const padding = 10;

		if (rect.right > window.innerWidth - padding) {
			left = window.innerWidth - rect.width - padding;
		}
		if (rect.left < 0) {
			left = 0;
		}
		if (rect.bottom > window.innerHeight - padding) {
			top = window.innerHeight - rect.height - padding;
		}
		if (rect.top < 0) {
			top = 0;
		}
	}

	function showSubmenu(submenuId, event) {
		if (submenuTimeouts.has(submenuId)) {
			clearTimeout(submenuTimeouts.get(submenuId));
			submenuTimeouts.delete(submenuId);
		}
		activeSubmenu = submenuId;
	}

	function hideSubmenu(submenuId, delay = 200) {
		const timeoutId = setTimeout(() => {
			if (activeSubmenu === submenuId) {
				activeSubmenu = null;
			}
			submenuTimeouts.delete(submenuId);
		}, delay);
		submenuTimeouts.set(submenuId, timeoutId);
	}

	function keepSubmenuOpen(submenuId) {
		if (submenuTimeouts.has(submenuId)) {
			clearTimeout(submenuTimeouts.get(submenuId));
			submenuTimeouts.delete(submenuId);
		}
	}

	function closeDropdown() {
		showDropdown = false;
	}
</script>

{#if showDropdown}
	<dialog
		bind:this={dialog}
		onclose={() => (showDropdown = false)}
		style={`top: ${top}px; left: ${left}px`}
		onclick={(e) => {
			e.stopPropagation();
			if (e.target === dialog) {
				closeDropdown();
			}
		}}
	>
		<div class="dropdown-content">
			{@render groups?.({
				showSubmenu,
				hideSubmenu,
				keepSubmenuOpen,
				activeSubmenu,
				closeDropdown
			})}
		</div>
	</dialog>
{/if}

<style>
	dialog {
		z-index: 1000;
		width: 200px;
		display: flex;
		flex-direction: column;
		padding: 0;
		margin-top: 4px;
		margin-left: 8px;
		background-color: white;
		border-radius: 4px;
		border: 1px solid var(--color-lightness-85);
		box-shadow:
			0 4px 8px 0 rgba(0, 0, 0, 0.2), 
			0 6px 10px 0 rgba(0, 0, 0, 0.1);
	}

	dialog::backdrop {
		background: transparent;
	}

	.dropdown-content {
		display: flex;
		flex-direction: column;
		position: relative;
	}

</style>
