// The shared download helper keeps its object URL alive after the click: revoking it at once
// can cancel the download in Firefox and Safari, which read the blob asynchronously (ROB-U2).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { downloadBlob, REVOKE_OBJECT_URL_AFTER_MS } from './downloadBlob.js';

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let revoked;
let clicked;

beforeEach(() => {
	revoked = [];
	clicked = [];
	URL.createObjectURL = () => 'blob:test-url';
	URL.revokeObjectURL = (url) => revoked.push(url);
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
		clicked.push({ name: this.download, href: this.getAttribute('href') });
	});
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	URL.createObjectURL = realCreate;
	URL.revokeObjectURL = realRevoke;
});

describe('downloadBlob', () => {
	it('clicks an anchor named after the file and leaves no anchor behind', () => {
		downloadBlob('data.csv', new Blob(['a,b']));
		expect(clicked).toEqual([{ name: 'data.csv', href: 'blob:test-url' }]);
		expect(document.querySelectorAll('a').length).toBe(0);
	});

	it('revokes the object URL only after the delay', () => {
		downloadBlob('data.csv', new Blob(['a,b']));
		vi.advanceTimersByTime(REVOKE_OBJECT_URL_AFTER_MS - 1);
		expect(revoked).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(revoked).toEqual(['blob:test-url']);
	});
});
