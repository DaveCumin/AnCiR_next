import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import NodeActions from './NodeActions.svelte';

// @testing-library/svelte doesn't auto-register cleanup in this project's
// vitest setup (no `@testing-library/svelte/vitest` import in
// src/test/setup.js), so without this each test's rendered DOM would leak
// into the next test in this file.
afterEach(() => cleanup());

describe('NodeActions quick-plot button', () => {
	it('renders when showQuickPlot and fires onQuickPlot', async () => {
		const onQuickPlot = vi.fn();
		const { getByLabelText } = render(NodeActions, { revealed: true, showQuickPlot: true, onQuickPlot });
		const btn = getByLabelText('Quick plot');
		await fireEvent.click(btn);
		expect(onQuickPlot).toHaveBeenCalledTimes(1);
	});

	it('is absent when showQuickPlot is false', () => {
		const { queryByLabelText } = render(NodeActions, { revealed: true, showQuickPlot: false });
		expect(queryByLabelText('Quick plot')).toBeNull();
	});
});
