// @ts-nocheck
//
// `core.generatedBy` — provenance for an AI-built session.
//
// Why this is held on core rather than read off the imported JSON and forgotten: a bug report
// arrives as a SAVED session, so the fingerprint has to survive a re-export. `sessionId` is what
// joins it back to the Worker log line (prompt, model, outcome) that built it.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts, outputCoreAsJson } from './core.svelte.js';

const FP = {
	source: 'ancir-nl',
	route: 'build',
	sessionId: '75e8c0de-0000-4000-8000-000000000001',
	model: 'openai/gpt-oss-120b',
	generatedAt: '2026-07-17T00:12:49.650Z'
};

beforeEach(() => {
	core.generatedBy = null;
});

describe('session provenance', () => {
	it('is absent by default — a human-built session claims no generator', () => {
		const out = JSON.parse(outputCoreAsJson());
		// Absent, not `generatedBy: null`: the key showing up at all implies something set it.
		expect('generatedBy' in out).toBe(false);
	});

	it('round-trips through an export, so a re-saved AI session stays traceable', () => {
		core.generatedBy = { ...FP };
		const out = JSON.parse(outputCoreAsJson());
		expect(out.generatedBy).toEqual(FP);
		// The id is the join key to the Worker's logs — the one field that must survive verbatim.
		expect(out.generatedBy.sessionId).toBe(FP.sessionId);
	});

	it('sits beside the version, where provenance belongs', () => {
		core.generatedBy = { ...FP };
		const keys = Object.keys(JSON.parse(outputCoreAsJson()));
		expect(keys.indexOf('generatedBy')).toBe(keys.indexOf('version') + 1);
	});

	it('carries no secrets — the session is handed to a user and may be shared on', () => {
		core.generatedBy = { ...FP };
		const blob = JSON.stringify(JSON.parse(outputCoreAsJson()).generatedBy);
		expect(blob).not.toMatch(/sk-|gsk_|apiKey/i);
	});

	it('exports the real app version alongside it', () => {
		core.generatedBy = { ...FP };
		expect(JSON.parse(outputCoreAsJson()).version).toBe(appConsts.version);
	});
});
