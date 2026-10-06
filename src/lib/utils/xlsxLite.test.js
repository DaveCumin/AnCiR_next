// Date-serial conversion in the lightweight xlsx reader. Each test builds a real
// OOXML workbook whose cells carry a date number format, so the serial goes through
// the same styles.xml lookup a file saved by Excel does.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { read, utils } from './xlsxLite.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * A one-column workbook whose cells are the given serials, every cell styled with
 * built-in numFmtId 22 ("m/d/yy h:mm"). `workbookPr` is the raw attribute string
 * for <workbookPr>, or null to leave the element out.
 */
function dateWorkbook(serials, workbookPr = null) {
	const rows = serials
		.map((v, r) => `<row r="${r + 1}"><c r="A${r + 1}" s="1"><v>${v}</v></c></row>`)
		.join('');
	const pr = workbookPr == null ? '' : `<workbookPr ${workbookPr}/>`;
	const files = {
		'[Content_Types].xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`
		),
		'xl/workbook.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL}">${pr}<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
		),
		'xl/_rels/workbook.xml.rels': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
		),
		'xl/styles.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>`
		),
		'xl/worksheets/sheet1.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><dimension ref="A1:A${serials.length}"/><sheetData>${rows}</sheetData></worksheet>`
		)
	};
	return zipSync(files);
}

/** The converted cell strings, one per serial. */
function convert(serials, workbookPr) {
	const wb = read(dateWorkbook(serials, workbookPr), { type: 'array' });
	return utils.sheet_to_csv(wb.Sheets.Sheet1).split('\n');
}

describe('xlsxLite date serials (1900 system)', () => {
	it('serial 45000 is 2023-03-15, as Excel shows it', () => {
		expect(convert([45000])).toEqual(['2023-03-15']);
	});

	it('dates on both sides of the phantom 1900-02-29 are exact', () => {
		expect(convert([1, 59, 61, 25569])).toEqual([
			'1900-01-01',
			'1900-02-28',
			'1900-03-01',
			'1970-01-01'
		]);
	});

	it('serial 60 is the phantom leap day and keeps the label Excel shows', () => {
		expect(convert([60])).toEqual(['1900-02-29']);
	});

	it('keeps the time of day', () => {
		expect(convert([45000.25])).toEqual(['2023-03-15 06:00:00']);
	});

	it('a time that rounds up to midnight rolls into the next day, never 24:00:00', () => {
		// 23:59:59.9 rounds to the next whole second, which is midnight of the 16th.
		const serial = 45000 + (86400 - 0.1) / 86400;
		expect(convert([serial])).toEqual(['2023-03-16']);
	});

	it('a time-only value that rounds to midnight is 00:00:00, not 24:00:00', () => {
		expect(convert([(86400 - 0.1) / 86400])).toEqual(['00:00:00']);
	});
});

describe('xlsxLite date serials (1904 system)', () => {
	it('date1904="1" moves the epoch to 1904-01-01', () => {
		// The same calendar day as serial 45000 in the 1900 system is 1462 days less.
		expect(convert([45000 - 1462, 1], 'date1904="1"')).toEqual(['2023-03-15', '1904-01-02']);
	});

	it('date1904="true" is read the same way', () => {
		expect(convert([45000 - 1462], 'date1904="true"')).toEqual(['2023-03-15']);
	});

	it('date1904="0" stays on the 1900 system', () => {
		expect(convert([45000], 'date1904="0"')).toEqual(['2023-03-15']);
	});
});
