import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

// The Worker is the unit under test's only collaborator, and a real /build call would cost an
// LLM round-trip and be non-deterministic. Stub it: what matters here is the DECISION the modal
// makes about the response, not how the response was produced.
vi.mock('$lib/utils/nlSession.js', () => ({
	buildNlSession: vi.fn()
}));

import AiPrompt from './AiPrompt.svelte';
import { buildNlSession } from '$lib/utils/nlSession.js';

// @testing-library/svelte doesn't auto-register cleanup in this project's vitest setup, so
// without this each test's rendered DOM leaks into the next (see NodeActions.quickplot.test.js).
afterEach(() => cleanup());

const SESSION_URL = 'https://ancir-nl.example.workers.dev/s/abc123';

/** `load()` assigns window.location.href; jsdom won't navigate, so capture the assignment. */
function captureNavigation() {
	const calls = [];
	delete window.location;
	window.location = {
		origin: 'https://ancir.example',
		pathname: '/',
		set href(v) {
			calls.push(v);
		},
		get href() {
			return calls.at(-1) ?? 'https://ancir.example/';
		}
	};
	return calls;
}

async function build(container, getByText, text = 'plot an actogram') {
	const ta = container.querySelector('textarea');
	await fireEvent.input(ta, { target: { value: text } });
	await fireEvent.click(getByText('Build session'));
}

describe('AiPrompt: partial-success gate', () => {
	let nav;
	beforeEach(() => {
		vi.clearAllMocks();
		nav = captureNavigation();
	});

	it('loads straight through when nothing was dropped', async () => {
		buildNlSession.mockResolvedValue({ sessionUrl: SESSION_URL, errors: [], warnings: [] });
		const { container, getByText } = render(AiPrompt, { showModal: true });

		await build(container, getByText);

		await waitFor(() => expect(nav).toHaveLength(1));
		// Loads into THIS deployment, not the Worker's configured production origin.
		expect(nav[0]).toBe(`https://ancir.example/?loadFromURL=${encodeURIComponent(SESSION_URL)}`);
		expect(container.querySelector('.gate')).toBeNull();
	});

	it('holds the session and lists what was dropped when the Worker reports errors', async () => {
		// The reported bug: HTTP 200, session built, actogram silently missing.
		buildNlSession.mockResolvedValue({
			sessionUrl: SESSION_URL,
			errors: ['Plot actogram: a series wired nothing (expected time, values). Skipped.'],
			warnings: ['BinnedData: generator outputs not baked.']
		});
		const { container, getByText } = render(AiPrompt, { showModal: true });

		await build(container, getByText);

		await waitFor(() => expect(container.querySelector('.gate')).not.toBeNull());
		expect(nav).toHaveLength(0); // the whole point: it did NOT redirect past the problem
		const gate = container.querySelector('.gate');
		expect(gate.textContent).toContain('a series wired nothing');
		expect(gate.textContent).toContain('generator outputs not baked'); // warnings shown too
		expect(gate.getAttribute('role')).toBe('alert'); // announced, not just painted amber
	});

	it('"Load anyway" loads the session that was actually built', async () => {
		buildNlSession.mockResolvedValue({
			sessionUrl: SESSION_URL,
			errors: ['Plot actogram: a series wired nothing.'],
			warnings: []
		});
		const { container, getByText } = render(AiPrompt, { showModal: true });
		await build(container, getByText);
		await waitFor(() => expect(container.querySelector('.gate')).not.toBeNull());

		await fireEvent.click(getByText('Load anyway'));

		expect(nav).toEqual([`https://ancir.example/?loadFromURL=${encodeURIComponent(SESSION_URL)}`]);
	});

	it('warnings alone do not gate — they describe a session worth opening', async () => {
		buildNlSession.mockResolvedValue({
			sessionUrl: SESSION_URL,
			errors: [],
			warnings: ['Cosinor: no data at emit time; outputs may not compute on load.']
		});
		const { container, getByText } = render(AiPrompt, { showModal: true });

		await build(container, getByText);

		await waitFor(() => expect(nav).toHaveLength(1));
		expect(container.querySelector('.gate')).toBeNull();
	});

	it('re-building after a gate clears the previous result', async () => {
		buildNlSession.mockResolvedValueOnce({
			sessionUrl: SESSION_URL,
			errors: ['Plot actogram: a series wired nothing.'],
			warnings: []
		});
		const { container, getByText } = render(AiPrompt, { showModal: true });
		await build(container, getByText);
		await waitFor(() => expect(container.querySelector('.gate')).not.toBeNull());

		// Second attempt succeeds: the stale gate must not survive into it.
		buildNlSession.mockResolvedValueOnce({ sessionUrl: SESSION_URL, errors: [], warnings: [] });
		await fireEvent.click(getByText('Build again'));

		await waitFor(() => expect(nav).toHaveLength(1));
		expect(container.querySelector('.gate')).toBeNull();
	});

	it('a thrown failure is still reported as an error, not a gate', async () => {
		buildNlSession.mockRejectedValue(new Error('Too many requests.'));
		const { container, getByText } = render(AiPrompt, { showModal: true });

		await build(container, getByText);

		await waitFor(() => expect(container.querySelector('.error')).not.toBeNull());
		expect(container.querySelector('.error').textContent).toContain('Too many requests.');
		expect(container.querySelector('.gate')).toBeNull();
		expect(nav).toHaveLength(0);
	});
});
