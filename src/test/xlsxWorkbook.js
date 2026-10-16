// @ts-nocheck
// A genuine OOXML workbook (one sheet, shared strings), as Excel writes it, for import
// tests. Same construction as ImportData.parsing.test.js's makeWorkbook, plus blank cells:
// a null or '' value writes no <c> at all, which is how Excel stores an empty cell.
import { zipSync, strToU8 } from 'fflate';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Column letters for a 0-based index: 0 -> A, 25 -> Z, 26 -> AA. */
function colName(i) {
	let s = '';
	for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
		s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
	return s;
}

/**
 * @param {Array<Array<string | number | null>>} rows
 * @returns {Uint8Array} the .xlsx bytes
 */
export function makeWorkbook(rows) {
	const strings = [];
	const sIndex = (s) => {
		let i = strings.indexOf(s);
		if (i === -1) i = strings.push(s) - 1;
		return i;
	};
	const width = Math.max(1, ...rows.map((r) => r.length));
	const sheetRows = rows
		.map((row, r) => {
			const cells = row
				.map((v, c) => {
					if (v == null || v === '') return '';
					const ref = `${colName(c)}${r + 1}`;
					return typeof v === 'number'
						? `<c r="${ref}"><v>${v}</v></c>`
						: `<c r="${ref}" t="s"><v>${sIndex(v)}</v></c>`;
				})
				.join('');
			return `<row r="${r + 1}">${cells}</row>`;
		})
		.join('');
	const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
	const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
	return zipSync({
		'[Content_Types].xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`
		),
		'_rels/.rels': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
		),
		'xl/workbook.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
		),
		'xl/_rels/workbook.xml.rels': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`
		),
		'xl/worksheets/sheet1.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:${colName(width - 1)}${rows.length}"/><sheetData>${sheetRows}</sheetData></worksheet>`
		),
		'xl/sharedStrings.xml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${ns}" count="${strings.length}" uniqueCount="${strings.length}">${strings
				.map((s) => `<si><t>${esc(s)}</t></si>`)
				.join('')}</sst>`
		)
	});
}
