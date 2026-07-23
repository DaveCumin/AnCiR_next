import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Every workflow demo also ships its DATA on its own, as a CSV listed under
// Import data → Examples, so someone can practise on a real record without inheriting a pipeline
// they did not build. These guard the two ways that can go wrong: a workflow added without its
// dataset, and analysis outputs leaking into what is meant to be raw data.
const DIR = join(process.cwd(), 'static', 'sessions', 'demos');
const manifest = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).sessions;
const workflows = manifest.filter((s) => s.kind === 'workflow');
const datasets = manifest.filter((s) => s.kind === 'dataset');

const datasetFor = (workflowId) => datasets.find((d) => d.id === `dataset-${workflowId}`);
/** Read through the manifest url, so a broken link fails here rather than only in the browser. */
const csvOf = (workflowId) => readFileSync(join(DIR, datasetFor(workflowId).url.split('/').pop()), 'utf8');
const headerOf = (id) => csvOf(id).split('\n')[0].split(',');

describe('workflow data exports', () => {
	it('ships a dataset for every workflow', () => {
		const missing = workflows
			.map((w) => w.id)
			.filter((id) => !datasets.some((d) => d.id === `dataset-${id}`));
		expect(missing).toEqual([]);
	});

	it('names the CSV for a human, since the file name becomes the imported group name', () => {
		for (const d of datasets.filter((x) => x.id.startsWith('dataset-workflow-'))) {
			const file = d.url.split('/').pop();
			expect(file).not.toMatch(/^(data-)?workflow-/); // not the generator's internal id
			expect(file).toMatch(/^[a-z0-9-]+\.csv$/);
		}
	});

	it('points each dataset at a file that exists', () => {
		const broken = datasets.filter((d) => !existsSync(join(DIR, d.url.split('/').pop())));
		expect(broken.map((d) => d.url)).toEqual([]);
	});

	it.each(workflows.map((w) => w.id))('%s exports data, not analysis', (id) => {
		const session = JSON.parse(readFileSync(join(DIR, `demo-${id}.json`), 'utf8'));
		const header = headerOf(id);

		// Nothing produced by a table process may appear in the raw data export.
		const computed = session.data
			.filter((c) => c.tableProcessGUId || c.producerNodeId)
			.map((c) => c.customName ?? c.name);
		expect(header.filter((h) => computed.includes(h))).toEqual([]);

		// ...and every genuine source column must be there.
		const sources = session.data
			.filter((c) => !c.tableProcessGUId && !c.producerNodeId)
			.map((c) => c.customName ?? c.name);
		expect(header.length).toBe(sources.length);
	});

	it.each(workflows.map((w) => w.id))('%s has rows, and every row matches the header width', (id) => {
		const lines = csvOf(id).trimEnd().split('\n');
		const width = lines[0].split(',').length;
		expect(lines.length).toBeGreaterThan(1);
		// Ragged series are padded, not truncated: two demos carry different sampling rates.
		const wrong = lines.slice(1).filter((l) => l.split(',').length !== width);
		expect(wrong).toEqual([]);
	});

	it('describes each dataset with its real shape', () => {
		for (const d of datasets.filter((x) => x.id.startsWith('dataset-workflow-'))) {
			const lines = readFileSync(join(DIR, d.url.split('/').pop()), 'utf8').trimEnd().split('\n');
			expect(d.description).toContain(`${lines[0].split(',').length} columns`);
			expect(d.description).toContain(`${lines.length - 1} rows`);
		}
	});
});
