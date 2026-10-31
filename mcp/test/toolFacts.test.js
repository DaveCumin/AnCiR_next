// The MCP server describes add_plot / render_plot from the generated catalogue before the
// engine has loaded (src/toolFacts.js). Pin those facts to the live registry's, so the text a
// client lists at startup is the text it would have got from the warm engine.
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureRegistry } from '../src/engine/session.js';
import { overlayHostTypes, overlayFormsSummary } from '../src/engine/overlays.js';
import { encodingHostsSummary } from '../src/engine/encodings.js';
import { staticToolFacts } from '../src/toolFacts.js';
import catalogue from '../src/emit/session-schema.generated.json';

beforeAll(async () => {
	await ensureRegistry();
});

describe('static tool facts (catalogue) match the live registry', () => {
	const stat = staticToolFacts(catalogue);
	it('overlay hosts and forms', () => {
		expect(overlayHostTypes().length).toBeGreaterThan(0);
		expect(stat.overlayHosts).toBe(overlayHostTypes().join(', '));
		expect(stat.overlayForms).toBe(overlayFormsSummary());
	});
	it('Colour by / Size by hosts, modes and colormaps', () => {
		expect(stat.enc.colourHosts.length).toBeGreaterThan(0);
		expect(stat.enc).toEqual(encodingHostsSummary());
	});
});
