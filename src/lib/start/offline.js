// @ts-nocheck
// Fetching the files that ship NEXT TO index.html (the example library under
// sessions/, the classroom lessons, the handbook).
//
// AnCiR is also offered as a single downloadable index.html that runs from disk
// (file://). Those sibling files are not part of that download, and browsers refuse
// fetch() from a file:// page anyway: Chromium logs "URL scheme 'file' is not
// supported" and WebKit reports an uncaught access-control error even when the
// promise is caught. So on file:// we do not try at all, and every caller gets the
// same plain-language reason to show instead of a raw network error.

export const HOSTED_URL = 'https://ancir.pages.dev';

export const EXAMPLES_UNAVAILABLE_MESSAGE =
	'Example sessions need an internet connection or the hosted version of AnCiR.';

export const OFFLINE_FILE_NOTE = 'They are not included in the downloaded offline file.';

/** True when the app is running from a local file (the offline download). */
export function isOfflineFile() {
	return typeof location !== 'undefined' && location.protocol === 'file:';
}

/** A shipped file could not be reached; `message` is fit to show to the user as is. */
export class AppAssetUnavailableError extends Error {
	constructor(message) {
		super(message);
		this.name = 'AppAssetUnavailableError';
	}
}

/** The user-facing reason shipped files are unavailable here. */
export function assetsUnavailableMessage() {
	return isOfflineFile()
		? `${EXAMPLES_UNAVAILABLE_MESSAGE} ${OFFLINE_FILE_NOTE}`
		: EXAMPLES_UNAVAILABLE_MESSAGE;
}

const isAbsoluteHttp = (url) => /^https?:\/\//i.test(String(url));

/**
 * fetch() for a file shipped with the app. Throws AppAssetUnavailableError (with a
 * message for the user) when running from file:// or when the request cannot be
 * made at all, and a plain Error for an HTTP error status. Absolute http(s) URLs
 * are fetched normally even from file://, since those can legitimately work.
 */
export async function fetchAppAsset(url, init) {
	if (isOfflineFile() && !isAbsoluteHttp(url)) {
		throw new AppAssetUnavailableError(assetsUnavailableMessage());
	}
	let res;
	try {
		res = await fetch(url, init);
	} catch {
		throw new AppAssetUnavailableError(assetsUnavailableMessage());
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res;
}

/** The message to show for a failed example-library load. */
export function describeAssetError(err) {
	return err instanceof AppAssetUnavailableError
		? err.message
		: `Could not load the example library (${err?.message ?? err}).`;
}
