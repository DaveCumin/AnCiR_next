<script>
	// @ts-nocheck
	// Visual-container node. Unlike WorkflowNode (a fixed 160px card), a Group
	// is a dashed-frame box the user resizes; data/process nodes dragged inside
	// its rect become its children (membership reconciled in WorkflowEditor's
	// stopAll). The group has no input/output ports and no edges.
	import Editable from '$lib/components/reusables/Editable.svelte';
	import NodeNoteButton from './NodeNoteButton.svelte';
	import { removeGroup } from '$lib/core/core.svelte.js';

	let { node, selected = false } = $props();

	let group = $derived(node.groupObj);

	function renameGroup(next) {
		if (!group) return;
		const trimmed = (next ?? '').trim();
		group.name = trimmed === '' ? 'Group' : trimmed;
	}

	function deleteGroup(e) {
		e.stopPropagation();
		if (group) removeGroup(group.id);
	}

	// Resize handle drag (bottom-right corner). Uses pointer events on window
	// so the drag continues even if the cursor leaves the small handle target.
	let resizing = $state(null);
	function startResize(e) {
		e.stopPropagation();
		e.preventDefault();
		if (!group) return;
		resizing = {
			startMouse: { x: e.clientX, y: e.clientY },
			startW: group.width,
			startH: group.height
		};
		window.addEventListener('pointermove', onResizeMove);
		window.addEventListener('pointerup', stopResize, { once: true });
	}
	function onResizeMove(e) {
		if (!resizing || !group) return;
		const dx = e.clientX - resizing.startMouse.x;
		const dy = e.clientY - resizing.startMouse.y;
		group.width = Math.max(160, resizing.startW + dx);
		group.height = Math.max(120, resizing.startH + dy);
	}
	function stopResize() {
		resizing = null;
		window.removeEventListener('pointermove', onResizeMove);
	}
</script>

<div
	class="group-node"
	class:selected
	style="width:{group?.width ?? 280}px; height:{group?.height ?? 220}px;"
>
	<div class="group-header" onpointerdown={(e) => e.stopPropagation()} role="presentation">
		<div class="group-title">
			<Editable
				value={group?.name ?? 'Group'}
				placeholder="Group"
				ariaLabel="Rename group"
				title="Double-click to rename"
				onCommit={renameGroup}
			/>
		</div>
		<NodeNoteButton nodeId={node.id} />
		<button
			class="group-close"
			type="button"
			onclick={deleteGroup}
			title="Delete group"
			aria-label="Delete group"
		>✕</button>
	</div>
	<div class="group-body"></div>
	<div
		class="group-resize-handle"
		onpointerdown={startResize}
		title="Drag to resize"
		role="presentation"
	></div>
</div>

<style>
	.group-node {
		position: relative;
		background: rgba(77, 159, 227, 0.04);
		border: 1.5px dashed rgba(77, 159, 227, 0.45);
		border-radius: 8px;
		box-sizing: border-box;
		cursor: grab;
		user-select: none;
	}
	.group-node.selected {
		border-color: var(--color-accent, #4d9fe3);
		background: rgba(77, 159, 227, 0.08);
	}
	.group-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		height: 28px;
		background: rgba(77, 159, 227, 0.12);
		border-bottom: 1px solid rgba(77, 159, 227, 0.3);
		border-radius: 7px 7px 0 0;
		font-weight: 600;
		font-size: 13px;
		color: rgba(0, 0, 0, 0.7);
		box-sizing: border-box;
	}
	.group-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.group-close {
		background: transparent;
		border: none;
		cursor: pointer;
		color: rgba(0, 0, 0, 0.5);
		font-size: 12px;
		padding: 0 4px;
		line-height: 1;
	}
	.group-close:hover {
		color: rgba(0, 0, 0, 0.9);
	}
	.group-body {
		position: absolute;
		inset: 28px 0 0 0;
		pointer-events: none;
	}
	.group-resize-handle {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 14px;
		height: 14px;
		cursor: nwse-resize;
		background: linear-gradient(
			135deg,
			transparent 0 6px,
			rgba(77, 159, 227, 0.6) 6px 8px,
			transparent 8px 100%
		);
	}
</style>
