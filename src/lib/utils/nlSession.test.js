import { describe, expect, it } from 'vitest';
import { isTrustedSessionUrl } from './nlSession.js';

// Only sessions our own Worker built get re-tidied + the AI warning. Everything else — above
// all a user's own session URL — must be left exactly as they saved it.
describe('isTrustedSessionUrl', () => {
	it('trusts our Worker host', () => {
		expect(isTrustedSessionUrl('https://ancir-nl.david-cumin.workers.dev/sessions/abc')).toBe(true);
		expect(isTrustedSessionUrl('https://anything.david-cumin.workers.dev/sessions/x')).toBe(true);
	});

	it('does NOT trust a URL that merely CONTAINS the host string', () => {
		// The whole reason for parsing the hostname instead of `url.includes(host)`: otherwise
		// any site could pass itself off as ours and have its layout silently rewritten.
		expect(isTrustedSessionUrl('https://evil.example/?x=ancir-nl.david-cumin.workers.dev')).toBe(
			false
		);
		expect(isTrustedSessionUrl('https://david-cumin.workers.dev.evil.example/s')).toBe(false);
		expect(isTrustedSessionUrl('https://notdavid-cumin.workers.dev/s')).toBe(false);
	});

	it("does not trust someone else's host, a relative URL, or junk", () => {
		expect(isTrustedSessionUrl('https://example.com/my-session.json')).toBe(false);
		expect(isTrustedSessionUrl('https://other.workers.dev/sessions/x')).toBe(false);
		expect(isTrustedSessionUrl('/static/sessions/demos/demo-tp-cosinor.json')).toBe(false);
		expect(isTrustedSessionUrl('')).toBe(false);
		expect(isTrustedSessionUrl('not a url')).toBe(false);
		expect(isTrustedSessionUrl(undefined)).toBe(false);
	});

	it('is case-insensitive about the host', () => {
		expect(isTrustedSessionUrl('https://ANCIR-NL.David-Cumin.Workers.Dev/sessions/a')).toBe(true);
	});
});
