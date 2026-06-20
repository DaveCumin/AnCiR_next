<script>
	// @ts-nocheck
	// Worksheet-canvas card for a standalone Note. Shares core.notes with the
	// workflow canvas, so editing/moving here also reflects in the workflow
	// editor and vice-versa.
	import Icon from '$lib/icons/Icon.svelte';
	import { appState, snapToGrid, removeNote } from '$lib/core/core.svelte.js';

	let { note } = $props();

	let dragStartX = 0;
	let dragStartY = 0;
	let mouseStartX = 0;
	let mouseStartY = 0;
	let dragging = false;
	let resizing = false;
	let initialWidth = 0;
	let initialHeight = 0;

	const MIN_W = 120;
	const MIN_H = 80;

	function onHeaderPointerDown(e) {
		if (e.target.closest('button.icon')) return;
		e.stopPropagation();
		mouseStartX = e.clientX;
		mouseStartY = e.clientY;
		dragStartX = note.x;
		dragStartY = note.y;
		dragging = true;
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	function startResize(e) {
		e.stopPropagation();
		mouseStartX = e.clientX;
		mouseStartY = e.clientY;
		initialWidth = note.width;
		initialHeight = note.height;
		resizing = true;
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}

	function onPointerMove(e) {
		const scale = appState.canvasScale || 1;
		if (dragging) {
			const dx = (e.clientX - mouseStartX) / scale;
			const dy = (e.clientY - mouseStartY) / scale;
			note.x = Math.max(0, snapToGrid(dragStartX + dx));
			note.y = Math.max(0, snapToGrid(dragStartY + dy));
		} else if (resizing) {
			const dx = (e.clientX - mouseStartX) / scale;
			const dy = (e.clientY - mouseStartY) / scale;
			note.width = snapToGrid(Math.max(MIN_W, initialWidth + dx));
			note.height = snapToGrid(Math.max(MIN_H, initialHeight + dy));
		}
	}

	function onPointerUp() {
		dragging = false;
		resizing = false;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
	}
</script>

<div
	class="note-card"
	style="left: {note.x}px;
		top: {note.y}px;
		width: {note.width}px;
		height: {note.height}px;"
	role="presentation"
	onclick={(e) => e.stopPropagation()}
>
	<div class="note-header" role="presentation" onpointerdown={onHeaderPointerDown}>
		<p>Note</p>
		<button class="icon" onclick={() => removeNote(note.id)} title="Delete note">
			<Icon name="close" width={16} height={16} />
		</button>
	</div>
	<textarea
		class="note-body"
		value={note.text ?? ''}
		placeholder="Write a note"
		oninput={(e) => (note.text = e.currentTarget.value)}
		onpointerdown={(e) => e.stopPropagation()}
	></textarea>
	<div
		class="resize-handle"
		role="presentation"
		onpointerdown={startResize}
	></div>
</div>

<style>
	.note-card {
		position: absolute;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		background: #fffde7;
		border: 1px solid rgba(0, 0, 0, 0.18);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-1);
		overflow: hidden;
		user-select: none;
		z-index: 5;
	}

	.note-header {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
		padding: 0.35rem 0.4rem 0.35rem var(--space-5);
		background: #fff9c4;
		border-bottom: 1px solid rgba(0, 0, 0, 0.1);
		cursor: move;
		font-weight: bold;
	}

	.note-header p {
		margin: 0;
		font-size: 0.85rem;
	}

	.note-body {
		flex: 1;
		width: 100%;
		resize: none;
		border: none;
		padding: var(--space-4) 0.6rem;
		font-family: inherit;
		font-size: 0.85rem;
		line-height: 1.4;
		background: #fffef6;
		outline: none;
		box-sizing: border-box;
		user-select: text;
	}

	.note-body:focus {
		background: var(--surface-card);
	}

	.resize-handle {
		position: absolute;
		width: 16px;
		height: 16px;
		right: 0;
		bottom: 0;
		cursor: nwse-resize;
	}
</style>
