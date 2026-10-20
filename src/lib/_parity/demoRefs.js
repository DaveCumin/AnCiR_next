// @ts-nocheck
/**
 * Finding a demo session's plots and columns by what they ARE, not by their saved id.
 *
 * Demo ids come from one counter that runs across the whole generator (scripts that build
 * static/sessions/demos), so a demo added or grown earlier in the run shifts the ids of every
 * demo after it. The parity emitters (emitBoxplot, emitAxisStyle) used to name plots and
 * columns by id and broke on every regeneration that added a node. These look them up by
 * name and order instead, and throw (naming what they looked for) when a demo no longer has
 * it, so a renamed plot fails loudly rather than drawing nothing.
 */

/** The plot named `name` (exactly one). */
export function plotByName(session, name, demo = '') {
	const hits = (session.plots ?? []).filter((p) => p.name === name);
	if (hits.length !== 1) {
		const have = (session.plots ?? []).map((p) => p.name).join(' | ');
		throw new Error(`${demo}: ${hits.length} plots named "${name}" (plots: ${have})`);
	}
	return hits[0];
}

/** The id of the `nth` column (0-based, saved order) named `name`. */
export function colId(session, name, nth = 0, demo = '') {
	const hits = (session.data ?? []).filter((c) => c.name === name);
	if (!hits[nth]) {
		throw new Error(`${demo}: no column #${nth} named "${name}" (${hits.length} found)`);
	}
	return hits[nth].id;
}

/**
 * The id of the first Join Data output joined from column `sourceId` (Join Data names its
 * outputs `joined_<sourceId>_<nodeId>`).
 */
export function joinedColId(session, sourceId, demo = '') {
	const hit = (session.data ?? []).find((c) => c.name?.startsWith(`joined_${sourceId}_`));
	if (!hit) throw new Error(`${demo}: no Join Data output from column ${sourceId}`);
	return hit.id;
}

/** The three lookups bound to one session, for a case's `edit(plotJSON, ref)`. */
export function demoRefs(session, demo = '') {
	return {
		col: (name, nth = 0) => colId(session, name, nth, demo),
		joined: (sourceId) => joinedColId(session, sourceId, demo)
	};
}
