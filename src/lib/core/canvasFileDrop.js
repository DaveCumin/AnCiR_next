// canvasFileDrop.js
//
// Svelte action that lets a canvas accept dropped OS files (CSV / Excel / AWD /
// JSON) to trigger a load. Internal HTML5 drags inside the app (e.g. the data
// panel's column reorder, which uses the `application/x-ancir-drag` MIME type)
// carry no `Files`, so they're ignored — only real file drags activate.
//
// Usage:
//   use:canvasFileDrop={{ onActive: (v) => (fileOver = v), onDrop: handleCanvasFileDrop }}

function dragHasFiles(e) {
	const types = e.dataTransfer?.types;
	if (!types) return false;
	return Array.from(types).includes('Files');
}

export function canvasFileDrop(node, opts = {}) {
	let depth = 0; // dragenter/leave can fire for child elements; count to debounce

	function onDragOver(e) {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}
	function onDragEnter(e) {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		depth += 1;
		opts.onActive?.(true);
	}
	function onDragLeave(e) {
		if (!dragHasFiles(e)) return;
		depth -= 1;
		if (depth <= 0) {
			depth = 0;
			opts.onActive?.(false);
		}
	}
	function onDrop(e) {
		if (!dragHasFiles(e)) return;
		e.preventDefault();
		depth = 0;
		opts.onActive?.(false);
		opts.onDrop?.(e.dataTransfer?.files);
	}

	node.addEventListener('dragover', onDragOver);
	node.addEventListener('dragenter', onDragEnter);
	node.addEventListener('dragleave', onDragLeave);
	node.addEventListener('drop', onDrop);

	return {
		update(next) {
			opts = next ?? {};
		},
		destroy() {
			node.removeEventListener('dragover', onDragOver);
			node.removeEventListener('dragenter', onDragEnter);
			node.removeEventListener('dragleave', onDragLeave);
			node.removeEventListener('drop', onDrop);
		}
	};
}
