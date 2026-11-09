// The legal values of a node's select parameters, read from the node's own editor markup, so
// run_table_process / add_column_process can refuse a value the app does not offer instead of
// running a node that silently produces nothing (`analysis: "Periodogram"` matched none of the
// node's branches and returned no outputs).
//
// The node registry carries no option lists: they live only in each component's <select>
// markup (see mcp/src/emit/paramNotes.js, and the drift guard that reads the same markup,
// src/lib/tableProcesses/paramNotesCoverage.test.js). So the source is read here the same way:
//   · <AttributeSelect bind:value={p.args.X} options={['a', 'b']} />, the options an inline
//     list of string literals or a constant (declared in the component or exported by a
//     $lib module it imports);
//   · <select bind:value={p.args.X}> … <option value="a"> … </select>, every option a literal,
//     or one {#each LIST as o}<option value={o.value}> over a constant the component declares;
//   · the same with a one-way value={p.args.X} whose onchange assigns p.args.X.
// A param is only checked when EVERY select bound to it was read and every option is a string:
// anything this reader cannot follow (options built at run time, an {#each}, numeric options)
// leaves the param unchecked rather than refusing a value the app would accept.

const SOURCES = {
	tableProcess: import.meta.glob('$lib/tableProcesses/*.svelte', {
		query: '?raw',
		import: 'default'
	}),
	process: import.meta.glob('$lib/processes/*.svelte', { query: '?raw', import: 'default' })
};
// Modules a component may import an options constant from.
const LIB_MODULES = import.meta.glob('$lib/**/*.js');

// `${kind}:${name}` → Map<param, string[] | null>, filled once by loadSelectOptions().
const OPTIONS = new Map();
let loading = null;

function findByBasename(glob, file) {
	const key = Object.keys(glob).find((k) => k.endsWith(`/${file}`));
	return key ? glob[key] : null;
}

/** A list of string literals (`'a', "b"`), or null when anything else is in it. */
function stringLiterals(body) {
	const items = body
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
	const out = [];
	for (const it of items) {
		const m = /^(['"])(.*)\1$/.exec(it);
		if (!m) return null;
		out.push(m[2]);
	}
	return out;
}

/** An options constant: declared in the component, else exported by an imported $lib module. */
async function resolveConstant(source, ident) {
	const constRe = new RegExp(`(?:export\\s+)?const\\s+${ident}\\s*=\\s*\\[([^\\]]*)\\]`);
	const local = constRe.exec(source);
	if (local) return stringLiterals(local[1]);
	const imp = new RegExp(
		`import\\s*\\{[^}]*\\b${ident}\\b[^}]*\\}\\s*from\\s*['"]\\$lib/([^'"]+)['"]`
	).exec(source);
	if (!imp) return null;
	const load = findByBasename(LIB_MODULES, imp[1]);
	if (!load) return null;
	const mod = await load();
	const v = mod?.[ident];
	return Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v] : null;
}

/**
 * Every select param of a component and its legal values. A param with any select this reader
 * cannot follow maps to null (left unchecked).
 * @param {string} source the component's .svelte source
 * @returns {Promise<Map<string, string[] | null>>}
 */
export async function selectOptionsFromSource(source) {
	const found = new Map();
	const add = (param, values) => {
		if (!param) return;
		if (values == null || found.get(param) === null) return void found.set(param, null);
		found.set(param, [...new Set([...(found.get(param) ?? []), ...values])]);
	};
	const argParam = (bind) => /\bargs\.([A-Za-z0-9_]+)\s*$/.exec(bind?.trim() ?? '')?.[1] ?? null;

	for (const el of source.matchAll(/<AttributeSelect\b[\s\S]*?\/>/g)) {
		const block = el[0];
		const param = argParam(/bind:value=\{([^}]*)\}/.exec(block)?.[1]);
		if (!param) continue;
		const literal = /options=\{\s*\[([^\]]*)\]\s*\}/.exec(block);
		if (literal) {
			add(param, stringLiterals(literal[1]));
			continue;
		}
		const ident = /options=\{\s*([A-Za-z0-9_$]+)\s*\}/.exec(block);
		add(param, ident ? await resolveConstant(source, ident[1]) : null);
	}

	// A select's opening tag: attribute values in braces may hold `>` (an arrow function).
	for (const el of source.matchAll(/<select\b((?:[^>{]|\{[^}]*\})*)>([\s\S]*?)<\/select>/g)) {
		const param = selectParam(el[1]);
		if (!param) continue;
		const body = el[2];
		add(param, optionValues(source, body));
	}
	return found;
}

/**
 * The param a <select> edits: `bind:value={p.args.X}`, or a one-way `value={p.args.X …}`
 * whose `onchange` assigns `p.args.X`.
 * @param {string} attrs the opening tag's attributes
 */
function selectParam(attrs) {
	const bound = /bind:value=\{([^}]*)\}/.exec(attrs)?.[1];
	if (bound) return /\bargs\.([A-Za-z0-9_]+)\s*$/.exec(bound.trim())?.[1] ?? null;
	const oneWay = /(?:^|\s)value=\{\s*p\.args\.([A-Za-z0-9_]+)\b/.exec(attrs)?.[1];
	return oneWay && new RegExp(`p\\.args\\.${oneWay}\\s*=[^=]`).test(attrs) ? oneWay : null;
}

/**
 * Every option value of a select body, or null when one cannot be read: literal `<option
 * value="a">`s, or one `{#each LIST as o}` over a constant the component declares (a list of
 * string literals, or of `{ value: 'a', … }` objects) with `<option value={o}>` /
 * `value={o.value}`.
 * @param {string} source the component source
 * @param {string} body the select's inner markup
 */
function optionValues(source, body) {
	const each =
		/\{#each\s+([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)\b[^}]*\}([\s\S]*?)\{\/each\}/.exec(body);
	if (each) {
		const [, list, item, inner] = each;
		// Only an each that is the whole body (no literal options beside it) is read.
		if (body.replace(each[0], '').includes('<option')) return null;
		const opt = new RegExp(`<option\\b[^>]*\\bvalue=\\{\\s*${item}(\\.value)?\\s*\\}`).exec(inner);
		if (!opt) return null;
		const decl = new RegExp(`const\\s+${list}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(source);
		if (!decl) return null;
		if (!opt[1]) return stringLiterals(decl[1]);
		const objects = decl[1].match(/\{[^}]*\}/g) ?? [];
		const values = objects.map((o) => /\bvalue:\s*(['"])(.*?)\1/.exec(o)?.[2]);
		return objects.length && values.every((v) => v != null) ? values : null;
	}
	const options = [...body.matchAll(/<option\b([^>]*)>/g)].map((o) => o[1]);
	if (!options.length || /\{#each\b/.test(body)) return null;
	const values = [];
	for (const attrs of options) {
		const v = /\bvalue=(?:"([^"]*)"|'([^']*)'|\{\s*(['"])(.*?)\3\s*\})/.exec(attrs);
		if (!v) return null;
		values.push(v[1] ?? v[2] ?? v[4]);
	}
	return values;
}

/**
 * Read every node's select options once (ensureRegistry awaits it), so the checks below are
 * synchronous: add_column_process is a synchronous call.
 */
export function loadSelectOptions() {
	loading ??= Promise.all(
		Object.entries(SOURCES).flatMap(([kind, glob]) =>
			Object.entries(glob).map(async ([path, load]) => {
				const source = await load();
				// Keyed as the registry keys the node: its file name, unless the definition pins
				// a `registryKey` (Normalize.svelte is registered as 'normalize'; keyed by file
				// name its options were never found, so a bad value was never refused).
				const name =
					/\bregistryKey:\s*['"]([^'"]+)['"]/.exec(source)?.[1] ??
					path.split('/').pop().replace('.svelte', '');
				OPTIONS.set(`${kind}:${name}`, await selectOptionsFromSource(source));
			})
		)
	);
	return loading;
}

/**
 * The select params of a registered node and their legal values (null: not checkable). Empty
 * until loadSelectOptions() has run.
 * @param {'tableProcess'|'process'} kind
 * @param {string} name registry id (the component's file name)
 * @returns {Map<string, string[] | null>}
 */
export function selectOptionsOf(kind, name) {
	return OPTIONS.get(`${kind}:${name}`) ?? new Map();
}

/**
 * Throw when a caller-supplied select param holds a value the node does not offer. Only string
 * values on params whose default is a string are checked (a select of numbers is left alone).
 * @param {'tableProcess'|'process'} kind
 * @param {string} name
 * @param {object} args the caller's args (before defaults are filled)
 * @param {Map<string, any>} [defaults] the registry defaults (`{ val }` wrapped or bare)
 */
export function assertSelectOptions(kind, name, args, defaults) {
	if (!args || typeof args !== 'object') return;
	const options = selectOptionsOf(kind, name);
	for (const [param, allowed] of options) {
		if (!allowed?.length || !(param in args)) continue;
		const value = args[param];
		if (value == null) continue; // omitted: the default fills it
		const d = defaults?.get?.(param);
		const def = d && typeof d === 'object' && 'val' in d ? d.val : d;
		if (def != null && typeof def !== 'string') continue;
		if (typeof value === 'string' && allowed.includes(value)) continue;
		const near =
			typeof value === 'string'
				? allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase())
				: null;
		throw new Error(
			`${name}: "${param}" must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}; ` +
				`got ${JSON.stringify(value)}.${near ? ` Did you mean ${JSON.stringify(near)}? (values are case-sensitive)` : ''}`
		);
	}
}
