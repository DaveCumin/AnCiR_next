import { describe, it, expect } from 'vitest';
import { referenceEdges, findQuickPlot } from './referenceEdges.js';

const plotNode = (id, plotObj) => ({ id: `plot_${id}`, type: 'plot', plotObj: { id, ...plotObj } });
const tpNode = (id) => ({ id: `tableprocess_${id}`, type: 'tableprocess' });
const pairs = (edges) => edges.map((e) => `${e.fromId}->${e.toId}`);

describe('referenceEdges', () => {
	it("links a Plot's-computed-data Table to its source plot", () => {
		const nodes = [
			plotNode(1, { type: 'periodogram', plot: {} }),
			plotNode(2, { type: 'tableplot', plot: { source: 'plot', sourcePlotId: 1 } })
		];
		const edges = referenceEdges(nodes);
		expect(pairs(edges)).toEqual(['plot_1->plot_2']);
		expect(edges[0]).toMatchObject({ type: 'reference', fromPort: null, toPort: null });
	});

	it('links a Node-results Table to its source node', () => {
		const nodes = [
			tpNode(5),
			plotNode(2, {
				type: 'tableplot',
				sourceNodeId: 'tableprocess_5',
				plot: { source: 'node', resultKey: 'permutations' }
			})
		];
		expect(pairs(referenceEdges(nodes))).toEqual(['tableprocess_5->plot_2']);
	});

	it('draws both links when a plot carries both, and a shared source once', () => {
		const nodes = [
			tpNode(5),
			plotNode(1, { type: 'scatterplot', plot: {} }),
			plotNode(2, {
				type: 'tableplot',
				sourceNodeId: 'tableprocess_5',
				plot: { source: 'plot', sourcePlotId: 1 }
			}),
			plotNode(3, {
				type: 'tableplot',
				sourceNodeId: 'plot_1',
				plot: { source: 'plot', sourcePlotId: 1 }
			})
		];
		expect(pairs(referenceEdges(nodes)).sort()).toEqual(
			['plot_1->plot_2', 'tableprocess_5->plot_2', 'plot_1->plot_3'].sort()
		);
	});

	it('a static legacy Data View with a source node gets its edge (was an else-if)', () => {
		const nodes = [
			tpNode(5),
			plotNode(2, {
				type: 'dataview',
				sourceNodeId: 'tableprocess_5',
				plot: { sourceType: 'static', sourcePlotId: null }
			})
		];
		expect(pairs(referenceEdges(nodes))).toEqual(['tableprocess_5->plot_2']);
	});

	it('a facet panel source falls back to its generator when the panel is not a node', () => {
		const nodes = [
			plotNode(7, { type: 'scatterplot', facet: true, plot: {} }),
			plotNode(2, { type: 'tableplot', plot: { source: 'plot', sourcePlotId: '7:c112#0' } })
		];
		expect(pairs(referenceEdges(nodes))).toEqual(['plot_7->plot_2']);
	});

	it('a missing source draws nothing; a Columns Table draws nothing for sourcePlotId', () => {
		const nodes = [
			plotNode(2, { type: 'tableplot', plot: { source: 'plot', sourcePlotId: 99 } }),
			plotNode(3, {
				type: 'tableplot',
				sourceNodeId: 'tableprocess_404',
				plot: { source: 'node', resultKey: 'stats' }
			}),
			plotNode(1, { type: 'scatterplot', plot: {} }),
			plotNode(4, { type: 'tableplot', plot: { columnRefs: [], sourcePlotId: 1 } })
		];
		expect(referenceEdges(nodes)).toEqual([]);
	});

	it('never links a plot to itself', () => {
		const nodes = [plotNode(2, { type: 'tableplot', plot: { source: 'plot', sourcePlotId: 2 } })];
		expect(referenceEdges(nodes)).toEqual([]);
	});
});

describe('findQuickPlot', () => {
	const results = {
		id: 10,
		type: 'tableplot',
		sourceNodeId: 'tableprocess_5',
		plot: { source: 'node', resultKey: 'permutations' }
	};
	const legacyView = {
		id: 11,
		type: 'dataview',
		sourceNodeId: 'tableprocess_5',
		plot: { sourceType: 'static' }
	};
	const quick = { id: 12, type: 'scatterplot', sourceNodeId: 'tableprocess_5', plot: {} };

	it('ignores a node-results Table and a legacy Data View', () => {
		expect(findQuickPlot([results, legacyView], 'tableprocess_5')).toBeNull();
		expect(findQuickPlot([results, legacyView, quick], 'tableprocess_5')).toBe(quick);
	});

	it('a Columns-mode quick-plot Table still counts as the quick plot', () => {
		const table = { id: 13, type: 'tableplot', sourceNodeId: 'tableprocess_5', plot: {} };
		expect(findQuickPlot([results, table], 'tableprocess_5')).toBe(table);
	});

	it('only matches the given node', () => {
		expect(findQuickPlot([quick], 'tableprocess_6')).toBeNull();
	});
});
