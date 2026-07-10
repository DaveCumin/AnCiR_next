// Builds the LLM system prompt: static, human-tunable rules from `prompts/system.md`
// + a live capability catalogue derived from the MCP `list_capabilities` result. Shared
// by the app agent and the agnostic test client so there is one prompt to maintain.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const TEMPLATE_PATH = fileURLToPath(new URL('./prompts/system.md', import.meta.url));

let _template = null;
function template() {
	if (_template == null) _template = readFileSync(TEMPLATE_PATH, 'utf8');
	return _template;
}

/** A short version tag so logs can attribute build quality to a prompt revision. */
export function promptVersion() {
	return createHash('sha256').update(template()).digest('hex').slice(0, 8);
}

/**
 * One flat `args` object per analysis (input-column fields + params together), so the
 * model doesn't nest under "inputs"/"params". Mirrors the shapes AnCiR expects.
 */
function argsTemplate(a) {
	const t = {};
	for (const f of a.inputs?.scalar ?? []) t[f] = '<col>';
	for (const f of a.inputs?.array ?? []) t[f] = ['<col>'];
	Object.assign(t, a.params);
	// Free-period fitting is unreliable on a time axis; a known-period rhythm should use
	// a fixed period — surface that as the working default.
	if ('useFixedPeriod' in t) t.useFixedPeriod = true;
	return t;
}

/** Render the capability catalogue block from a describeCapabilities() result. */
export function buildCatalogue(caps) {
	if (!caps?.analyses) return '- Call list_capabilities if unsure of names/params.';
	const analysisRef = caps.analyses
		.map((a) => `  ${a.id}: args=${JSON.stringify(argsTemplate(a))}`)
		.join('\n');
	const plotRef = (caps.plots ?? [])
		.map((p) => `${p.id}[${(p.inputs || []).join(',')}]`)
		.join(', ');
	return (
		'ANALYSES (run_table_process name + args) — exact shapes:\n' +
		analysisRef +
		'\nPLOTS (add_plot type + inputs): ' +
		plotRef
	);
}

/** The full system prompt string: static rules + live catalogue. */
export function buildSystemPrompt(caps) {
	return template().replace('{{CATALOGUE}}', buildCatalogue(caps));
}
