// sessionFiles.js: which FILES can be opened as an AnCiR session, in one place.
//
// A session is the JSON written by outputCoreAsJson, saved as `.json`. It may also be named
// `.ancir`: the content is the same JSON, the extension just says what the file is for. Every
// entry point that opens a session (canvas drop, the Load session modal, the start screen's
// picker, the Import modal's routing) reads its accepted names from here, so the two extensions
// can never drift apart between them.
//
// The extension only ROUTES a file towards the session loader. Whether it IS a session is still
// decided by its content (looksLikeSession / sessionShapeProblem), so a `.ancir` holding anything
// else gets the same safe refusal as a `.json` would, with the open session left intact.

/** Extensions a session file may have, lower case with the dot. */
export const SESSION_FILE_EXTENSIONS = ['.json', '.ancir'];

/** For an `<input type="file" accept>`. The MIME type keeps the OS dialog showing .json files. */
export const SESSION_FILE_ACCEPT = [...SESSION_FILE_EXTENSIONS, 'application/json'].join(',');

/** For window.showOpenFilePicker({ types }). */
export const SESSION_PICKER_TYPES = [
	{ description: 'AnCiR session', accept: { 'application/json': SESSION_FILE_EXTENSIONS } }
];

const SESSION_FILE_RE = new RegExp(
	`(${SESSION_FILE_EXTENSIONS.map((e) => e.replace('.', '\\.')).join('|')})$`,
	'i'
);

/** True when a file NAME has a session extension (.json or .ancir, any case). */
export function isSessionFileName(name) {
	return SESSION_FILE_RE.test(String(name ?? ''));
}

/** A session file's name without its session extension, e.g. "rest-activity.ancir" -> "rest-activity". */
export function sessionBaseName(name) {
	return String(name ?? '').replace(SESSION_FILE_RE, '');
}
