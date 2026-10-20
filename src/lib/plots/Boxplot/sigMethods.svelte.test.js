// @ts-nocheck
// The significance-bar methods: ONE list (./sigMethods.js) behind the Boxplot's own dropdown, the
// multi-select panel and the AI/MCP editor. They used to differ: the dropdown offered
// auto / kruskal, the multi-select auto / tukey / ttest / mannwhitney.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { appConsts, appState } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import { getSharedSchema } from '$lib/plots/sharedControls.js';
import { plotProps } from '$lib/utils/aiEdit.js';
import { Boxplotclass } from './Boxplot.svelte';
import {
	SIG_METHODS,
	SIG_METHOD_VALUES,
	SIG_METHOD_LABELS,
	normaliseSigMethod,
	isNonParametricSigMethod
} from './sigMethods.js';

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});
afterEach(() => cleanup());

describe('the one list', () => {
	it('is parametric and non-parametric, with plain labels', () => {
		expect(SIG_METHOD_VALUES).toEqual(['auto', 'kruskal']);
		expect(SIG_METHOD_LABELS).toEqual(SIG_METHODS.map((m) => m.label));
		for (const label of SIG_METHOD_LABELS) expect(label).toMatch(/^(Parametric|Non-parametric) \(/);
	});

	it('old values load as the method they always ran', () => {
		expect(normaliseSigMethod('auto')).toBe('auto');
		expect(normaliseSigMethod('kruskal')).toBe('kruskal');
		expect(normaliseSigMethod('tukey')).toBe('auto');
		expect(normaliseSigMethod('ttest')).toBe('auto');
		expect(normaliseSigMethod('anova')).toBe('auto');
		expect(normaliseSigMethod('mannwhitney')).toBe('kruskal');
		for (const bad of [undefined, null, 3, 'magic']) expect(normaliseSigMethod(bad)).toBe('auto');
		expect(isNonParametricSigMethod('mannwhitney')).toBe(true);
		expect(isNonParametricSigMethod('tukey')).toBe(false);
	});

	it('a saved old value loads as its current one and runs the same tests', () => {
		const run = (method) => {
			const b = Boxplotclass.fromJSON(null, {
				...new Boxplotclass(null, null).toJSON(),
				sigMethod: method
			});
			return b.sigMethod;
		};
		expect(run('tukey')).toBe('auto');
		expect(run('ttest')).toBe('auto');
		expect(run('mannwhitney')).toBe('kruskal');
		expect(run('kruskal')).toBe('kruskal');
		expect(run(undefined)).toBe('auto');
	});

	it('every saved session the app ships uses a current value', () => {
		const root = join(process.cwd(), 'static', 'sessions');
		const seen = [];
		for (const dir of ['demos', 'classroom']) {
			for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith('.json'))) {
				const text = readFileSync(join(root, dir, f), 'utf8');
				for (const m of text.matchAll(/"sigMethod":\s*"([^"]*)"/g)) seen.push(m[1]);
			}
		}
		expect(seen.length).toBeGreaterThan(0);
		for (const v of seen) expect(SIG_METHOD_VALUES).toContain(v);
	});
});

describe('every surface offers the same list', () => {
	const boxplot = () => new Plot({ type: 'boxplot', name: 'b', plot: { data: [] } });

	it('the multi-select panel (descriptor) and the AI editor', () => {
		const field = getSharedSchema(boxplot()).find((f) => f.path === 'plot.sigMethod');
		expect(field).toMatchObject({
			input: 'select',
			options: [...SIG_METHOD_VALUES],
			optionLabels: [...SIG_METHOD_LABELS]
		});
		const prop = plotProps(boxplot()).find((p) => p.path === 'plot.sigMethod');
		expect(prop).toMatchObject({
			options: [...SIG_METHOD_VALUES],
			optionLabels: [...SIG_METHOD_LABELS],
			value: 'auto'
		});
	});

	it("the Boxplot's own dropdown", async () => {
		appState.currentControlTab = 'properties';
		const plot = boxplot();
		const Comp = appConsts.plotMap.get('boxplot').plot;
		const { container } = render(Comp, { props: { theData: plot.plot, which: 'controls' } });
		flushSync();
		await tick();
		const select = [...container.querySelectorAll('select')].find((s) =>
			[...s.options].some((o) => o.value === 'kruskal')
		);
		expect(select).toBeTruthy();
		expect([...select.options].map((o) => [o.value, o.textContent.trim()])).toEqual(
			SIG_METHODS.map((m) => [m.value, m.label])
		);
	});
});
