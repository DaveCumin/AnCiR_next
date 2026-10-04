// ROB-23, second half: Confirm Import had the same shape as the preview, so a
// file that previewed but then failed to read in full (changed on disk, a cloud
// sync replacing it mid-import, a parser throwing on a row past the preview) left
// the "Loading data" spinner up forever. The workbook reader is wrapped so the
// SECOND read of a real workbook fails, the way such a file does.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

const failReads = { on: false };
vi.mock('$lib/utils/xlsxLite', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		read: (...args) => {
			if (failReads.on) throw new Error('invalid zip data');
			return real.read(...args);
		}
	};
});

const { openImportModalWithFiles, _importPreviewState, _importTestActions } =
	await import('./ImportData.svelte');
const { core } = await import('$lib/core/core.svelte');

function workbook() {
	const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
	const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
	return zipSync({
		'xl/workbook.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
		),
		'xl/_rels/workbook.xml.rels': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
		),
		'xl/worksheets/sheet1.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:B3"/><sheetData>` +
				`<row r="1"><c r="A1" t="inlineStr"><is><t>hour</t></is></c><c r="B1" t="inlineStr"><is><t>activity</t></is></c></row>` +
				`<row r="2"><c r="A2"><v>0</v></c><c r="B2"><v>12</v></c></row>` +
				`<row r="3"><c r="A3"><v>1</v></c><c r="B3"><v>15</v></c></row>` +
				`</sheetData></worksheet>`
		)
	});
}

beforeEach(() => {
	failReads.on = false;
	core.data = [];
});

describe('Confirm Import that fails (ROB-23)', () => {
	it('stops the spinner, keeps the modal open and says why', async () => {
		await openImportModalWithFiles([new File([workbook()], 'night1.xlsx')]);
		expect(_importPreviewState().importReady).toBe(true);
		expect(_importPreviewState().headers).toEqual(['hour', 'activity']);

		failReads.on = true;
		await _importTestActions().confirmImport();
		const s = _importPreviewState();
		expect(s.awaitingLoad).toBe(false);
		expect(s.showImportModal).toBe(true);
		expect(s.importError).toMatch(/night1\.xlsx/);
		expect(s.importError).toMatch(/invalid zip data/);
		expect(core.data).toHaveLength(0);
	});

	it('imports normally when the file reads', async () => {
		await openImportModalWithFiles([new File([workbook()], 'night1.xlsx')]);
		await _importTestActions().confirmImport();
		const s = _importPreviewState();
		expect(s.importError).toBe('');
		expect(s.showImportModal).toBe(false);
		expect(core.data.map((c) => c.name)).toEqual(['hour', 'activity']);
	});
});
