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

// --- saving ---------------------------------------------------------------------------------------
// A saved session is named "<name> <YYYY-MM-DD>.ancir", so a folder of saves sorts by subject and
// then by day, and every save no longer lands as "session.json", "session (1).json", ... (UI-15).

/** The extension a session is SAVED with. Opening still accepts every SESSION_FILE_EXTENSIONS. */
export const SESSION_SAVE_EXTENSION = '.ancir';

/** What an unnamed session is called. */
export const UNNAMED_SESSION = 'AnCiR session';

/** Room for the name; the date and extension add 17 more, well inside every file system's limit. */
const MAX_NAME_CHARS = 100;

/** Extensions a source name may carry over from the file it came from (data or session). */
const CARRIED_EXTENSION_RE = /\.(csv|tsv|txt|xlsx?|awd|json|ancir)$/i;

/** Characters Windows, macOS or Linux refuse in a file name, plus control characters. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
const UNSAFE_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;

/** A date (YYYY-MM-DD) at the end of a name, as an earlier save would have left it. */
const TRAILING_DATE_RE = /\s*\d{4}-\d{2}-\d{2}$/;

/** The LOCAL calendar date as YYYY-MM-DD (not toISOString, which is UTC and can be a day off). */
function localIsoDate(date) {
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The file name to save a session under: the name made safe for any file system, the local
 * date and `.ancir`. A name with nothing usable left becomes "AnCiR session".
 * @param {string | null | undefined} name
 * @param {Date} [date]
 */
export function sessionSaveFileName(name, date = new Date()) {
	const safe = String(name ?? '')
		.replace(UNSAFE_CHARS_RE, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(CARRIED_EXTENSION_RE, '')
		.replace(TRAILING_DATE_RE, '')
		// Windows drops trailing dots and spaces, and a leading dot hides the file on macOS/Linux.
		.replace(/^[\s.]+|[\s.]+$/g, '')
		.slice(0, MAX_NAME_CHARS)
		.trim();
	return `${safe || UNNAMED_SESSION} ${localIsoDate(date)}${SESSION_SAVE_EXTENSION}`;
}

/**
 * The name a session is saved under, before sessionSaveFileName makes it a file name. AnCiR has
 * no session title, so this is the data source: the first group that import named after its
 * file. Groups left with the default name "Group" say nothing about the session and are skipped.
 * Null when there is none, so the caller falls back to "AnCiR session".
 * @param {{ groups?: { name?: string }[] }} core
 */
export function sessionNameForSave(core) {
	const named = (core?.groups ?? []).find((g) => {
		const n = String(g?.name ?? '').trim();
		return n !== '' && n !== 'Group';
	});
	return named ? named.name.trim() : null;
}
