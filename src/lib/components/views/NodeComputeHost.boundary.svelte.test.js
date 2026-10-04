// @ts-nocheck
// ROB-12: NodeComputeHost mounts a hidden instance of every node nobody is looking at. With no
// boundary, ONE of them throwing unmounted the host, and every other hidden node stopped
// computing, silently.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import NodeComputeHost from './NodeComputeHost.svelte';
import FlakyNode from './__fixtures__/FlakyNode.svelte';
import { appConsts, core } from '$lib/core/core.svelte.js';
import { notifications } from '$lib/core/notifications.svelte.js';

let saved;
beforeEach(() => {
	notifications.list.length = 0;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	globalThis.fetch = () => Promise.resolve(new Response('{}'));
	saved = core.tableProcesses;
	core.tableProcesses = [
		{ id: 901, name: 'flaky-test', displayName: 'Broken node', args: { fail: true } },
		{ id: 902, name: 'flaky-test', displayName: 'Healthy node', args: { fail: false } }
	];
	appConsts.tableProcessMap.set('flaky-test', { component: FlakyNode });
});
afterEach(() => {
	cleanup();
	core.tableProcesses = saved;
	appConsts.tableProcessMap.delete('flaky-test');
	vi.restoreAllMocks();
});

describe('NodeComputeHost with a hidden node that throws', () => {
	it('keeps every other hidden node computing, and reports the broken one', async () => {
		const { findByTestId, container } = render(NodeComputeHost);
		// Hidden instances mount after the host's short grace period.
		expect((await findByTestId('node-902')).textContent).toMatch(/computing/);
		expect(container.querySelector('[data-testid="node-901"]')).toBeNull();
		expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/node 901 broke/);
		const toast = notifications.list.find((n) => n.type === 'error');
		expect(toast.message).toMatch(/while calculating "Broken node"/);
		// Contained, but nobody can see this error box: the toast says what that means.
		expect(toast.message).toMatch(/not on screen: its outputs may be out of date/);
	});
});
