/**
 * Revoking an object URL straight after click() can cancel the download in Firefox and
 * Safari, which read the blob asynchronously (ROB-U2). A minute is far longer than any
 * download needs to start, and the blob is freed after it.
 */
export const REVOKE_OBJECT_URL_AFTER_MS = 60_000;

/**
 * Download a Blob through a temporary anchor, keeping its object URL alive long enough
 * for every browser to start the download.
 * @param {string} filename
 * @param {Blob} blob
 */
export function downloadBlob(filename, blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), REVOKE_OBJECT_URL_AFTER_MS);
}
