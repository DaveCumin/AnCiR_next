// dataSourceActions.js
//
// A tiny, decoupled registry so any component can trigger the single
// `ImportData` modal instance (mounted once in +page.svelte) without
// prop-drilling a component reference through the tree.
//
// +page.svelte calls `registerDataSourceActions({...})` after it mounts
// <ImportData bind:this>. Empty-state prompts, the node palette, and canvas
// file-drop handlers call the exported helpers below.

const actions = {
	/** @type {null | (() => void)} */
	openImport: null,
	/** @type {null | ((files: FileList | File[]) => void)} */
	openImportFiles: null,
	/** @type {null | ((url: string) => void)} */
	openImportUrl: null,
	/** @type {null | ((file: File) => void)} */
	loadSessionFile: null
};

/**
 * Register imperative data-source actions. Pass only the keys you provide;
 * existing handlers are preserved for keys you omit.
 * @param {Partial<typeof actions>} handlers
 */
export function registerDataSourceActions(handlers) {
	Object.assign(actions, handlers);
}

/** Open the file-import modal (CSV / Excel / AWD). No-op if not yet registered. */
export function openImportData() {
	actions.openImport?.();
}

/** Open the import modal pre-seeded with dropped/selected data files. */
export function openImportDataFiles(files) {
	actions.openImportFiles?.(files);
}

/** Open the import modal pre-seeded with a URL to a CSV/text file (previews it). */
export function openImportDataUrl(url) {
	actions.openImportUrl?.(url);
}

/** Load a dropped `.json` session file. */
export function loadSessionFile(file) {
	actions.loadSessionFile?.(file);
}

const DATA_FILE_RE = /\.(csv|tsv|txt|xlsx|xls|awd)$/i;
const SESSION_FILE_RE = /\.json$/i;

/** True if a filename looks like a tabular data file AnCiR can import. */
export function isImportableDataFile(name) {
	return DATA_FILE_RE.test(name ?? '');
}

/**
 * Route files dropped onto a canvas: tabular data files open the import modal;
 * a lone `.json` is treated as a session. Returns true if anything was handled.
 * @param {FileList | File[]} fileList
 */
export function handleCanvasFileDrop(fileList) {
	const files = [...(fileList ?? [])].filter(Boolean);
	if (files.length === 0) return false;
	const dataFiles = files.filter((f) => DATA_FILE_RE.test(f.name));
	const sessionFiles = files.filter((f) => SESSION_FILE_RE.test(f.name));
	if (dataFiles.length > 0) {
		openImportDataFiles(dataFiles);
		return true;
	}
	if (sessionFiles.length > 0) {
		loadSessionFile(sessionFiles[0]);
		return true;
	}
	// Unknown extension — fall back to the import modal (it can still parse many
	// delimited text files regardless of extension).
	openImportDataFiles(files);
	return true;
}
