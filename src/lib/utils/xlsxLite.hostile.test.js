// Crafted workbooks that used to hang or exhaust the tab (SEC-U3, 2026-10-28). Each was
// first reproduced in headless Chromium through the Import dialog:
//   - a <dimension> that claims the whole sheet (A1:XFD1048576) over six real cells: the
//     CSV walk visited 17 billion cells and the tab froze;
//   - one real cell at XFD1048576: the same freeze, and the grid really is that big;
//   - <col min="3" max="2147483647" hidden="1">: a Set of 2 billion entries, which failed
//     with "Set maximum size exceeded" and the message blamed a damaged file;
//   - a 1.5 GB entry the reader never needs (zip bomb): unzipSync inflated it anyway;
//   - an entity-expansion DOCTYPE (billion laughs): Chromium refuses the expansion, the
//     document comes back as a parse error and the header names silently vanished.
// OOXML parts never carry a DTD (ECMA-376 Part 2 forbids DTDs in package parts), so a
// DOCTYPE is refused outright.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { read, utils, MAX_SHEET_CELLS } from './xlsxLite.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const ROWS = [1, 2, 3, 4, 5]
	.map(
		(r) =>
			`<row r="${r + 1}"><c r="A${r + 1}"><v>${r}</v></c><c r="B${r + 1}"><v>${r * 2}</v></c></row>`
	)
	.join('');

function sheetXml({ dim = 'A1:B6', cols = '', extra = '' } = {}) {
	const dimension = dim == null ? '' : `<dimension ref="${dim}"/>`;
	return (
		`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}">${dimension}${cols}<sheetData>` +
		`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>${ROWS}${extra}</sheetData></worksheet>`
	);
}

function sharedStrings(prolog = '', a = 'time', b = 'value') {
	return `<?xml version="1.0" encoding="UTF-8"?>${prolog}<sst xmlns="${NS}"><si><t>${a}</t></si><si><t>${b}</t></si></sst>`;
}

function workbook(overrides = {}) {
	const files = {
		'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
		'xl/worksheets/sheet1.xml': sheetXml(),
		'xl/sharedStrings.xml': sharedStrings(),
		...overrides
	};
	return zipSync(
		Object.fromEntries(
			Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])
		)
	);
}

/** Edit the zip central-directory entry for `name` in place; returns how many matched. */
function patchEntry(bytes, name, edit) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let patched = 0;
	for (let i = 0; i + 46 < bytes.length; i++) {
		if (view.getUint32(i, true) !== 0x02014b50) continue; // central directory entry
		const nameLen = view.getUint16(i + 28, true);
		if (new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLen)) !== name) continue;
		edit(view, i);
		patched++;
	}
	return patched;
}

const csvOf = (bytes) => utils.sheet_to_csv(read(bytes, { type: 'array' }).Sheets.Sheet1);

const GOOD_CSV = 'time,value\n1,2\n2,4\n3,6\n4,8\n5,10';

describe('xlsxLite on hostile workbooks', () => {
	it('reads the well-formed control workbook', () => {
		expect(csvOf(workbook())).toBe(GOOD_CSV);
	});

	it('a <dimension> larger than the cells it holds is trimmed to the cells', () => {
		const wb = read(workbook({ 'xl/worksheets/sheet1.xml': sheetXml({ dim: 'A1:XFD1048576' }) }), {
			type: 'array'
		});
		expect(wb.Sheets.Sheet1['!ref']).toBe('A1:B6');
		expect(utils.sheet_to_csv(wb.Sheets.Sheet1)).toBe(GOOD_CSV);
	});

	it('a <dimension> that starts after A1 still starts there', () => {
		const wb = read(workbook({ 'xl/worksheets/sheet1.xml': sheetXml({ dim: 'B2:B6' }) }), {
			type: 'array'
		});
		expect(wb.Sheets.Sheet1['!ref']).toBe('B2:B6');
	});

	it('a used range past the cell limit is refused with a message a user can act on', () => {
		const bytes = workbook({
			'xl/worksheets/sheet1.xml': sheetXml({
				dim: null,
				extra: '<row r="1048576"><c r="XFD1048576"><v>1</v></c></row>'
			})
		});
		let err;
		try {
			read(bytes, { type: 'array' });
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(Error);
		expect(err.userMessage).toMatch(/1,048,576 rows by 16,384 columns/);
		expect(err.userMessage).toMatch(/save .*as CSV/i);
		expect(16384 * 1048576).toBeGreaterThan(MAX_SHEET_CELLS);
	});

	it('a hidden column range past the last Excel column is clamped, not enumerated', () => {
		const t0 = performance.now();
		const wb = read(
			workbook({
				'xl/worksheets/sheet1.xml': sheetXml({
					cols: '<cols><col min="2" max="2147483647" hidden="1"/></cols>'
				})
			}),
			{ type: 'array' }
		);
		expect(performance.now() - t0).toBeLessThan(2000);
		expect(wb.Sheets.Sheet1._hiddenCols.size).toBeLessThanOrEqual(16384);
		expect(utils.sheet_to_csv(wb.Sheets.Sheet1, { skipHidden: true })).toBe('time\n1\n2\n3\n4\n5');
	});

	it('a DOCTYPE (entity expansion) is refused, never parsed', () => {
		let ents = '<!ENTITY lol "lol">';
		for (let i = 1; i <= 9; i++)
			ents += `<!ENTITY lol${i} "${`&lol${i === 1 ? '' : i - 1};`.repeat(10)}">`;
		const bytes = workbook({
			'xl/sharedStrings.xml': sharedStrings(`<!DOCTYPE sst [${ents}]>`, '&lol9;')
		});
		expect(() => read(bytes, { type: 'array' })).toThrow(/document type declaration/i);
	});

	it('parts the reader never uses are not inflated (zip bomb)', () => {
		// The skip is what keeps a bomb in an unused part harmless. It is shown with a part
		// whose compression method (12, bzip2) fflate cannot inflate: reading it at all throws.
		const bytes = workbook({ 'xl/media/image1.bin': new Uint8Array(1000) });
		expect(
			patchEntry(bytes, 'xl/media/image1.bin', (view, at) => view.setUint16(at + 10, 12, true))
		).toBe(1);
		expect(csvOf(bytes)).toBe(GOOD_CSV);
	});

	it('a part the reader needs that inflates past the size limit is refused', () => {
		// A real sheet larger than the limit cannot be built in a unit test, so the check
		// reads the size the zip directory declares: patch it to 2 GiB.
		const bytes = workbook();
		const patched = patchEntry(bytes, 'xl/worksheets/sheet1.xml', (view, at) =>
			view.setUint32(at + 24, 0x80000000, true)
		); // uncompressed size
		expect(patched).toBe(1);
		expect(() => read(bytes, { type: 'array' })).toThrow(/too large/i);
	});
});
