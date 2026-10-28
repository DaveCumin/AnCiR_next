import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { openApp } from './helpers.js';

// The "possible, not confirmed" items of the 2026-10-03 review, checked as a user meets them
// (2026-10-28). Works against the dev server and a production preview (no dev-only hooks).
//
//   SEC-U3  crafted workbooks: a lying <dimension> or one far cell froze the tab; now the
//           first imports, the second is refused with a message, a DOCTYPE is refused.
//   ROB-U6  an analysis this build does not know: the load warns and the card says so.
//   UI-U2   opening an example records no undo step (refuted; guard).
//   UI-U4   deleting a note is undoable (refuted; guard).
//   UI-U5   a reload of an untouched example returns to the start screen, and an edited
//           session asks before it unloads (refuted; guard).

test.use({ viewport: { width: 1400, height: 900 } });

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ROWS = [1, 2, 3, 4, 5]
	.map(
		(r) =>
			`<row r="${r + 1}"><c r="A${r + 1}"><v>${r}</v></c><c r="B${r + 1}"><v>${r * 2}</v></c></row>`
	)
	.join('');

function workbook({ dim = 'A1:B6', extra = '', prolog = '' } = {}) {
	const files = {
		'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
		'xl/sharedStrings.xml': `<?xml version="1.0"?>${prolog}<sst xmlns="${NS}"><si><t>time</t></si><si><t>value</t></si></sst>`,
		'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="${NS}">${dim ? `<dimension ref="${dim}"/>` : ''}<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>${ROWS}${extra}</sheetData></worksheet>`
	};
	return Buffer.from(
		zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
	);
}

async function previewWorkbook(page, name, buffer) {
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	await page.locator('#fileInput').setInputFiles({
		name,
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer
	});
}

test.describe('SEC-U3: crafted workbooks never freeze the tab', () => {
	test('a <dimension> claiming the whole sheet previews the six real rows', async ({ page }) => {
		await previewWorkbook(page, 'huge-dimension.xlsx', workbook({ dim: 'A1:XFD1048576' }));
		await expect(page.locator('#confirmImport')).toBeVisible({ timeout: 10000 });
		await expect(page.locator('dialog[open]')).toContainText('5 rows to import');
	});

	test('one cell at XFD1048576 is refused with a message, quickly', async ({ page }) => {
		await previewWorkbook(
			page,
			'far-cell.xlsx',
			workbook({ dim: null, extra: '<row r="1048576"><c r="XFD1048576"><v>1</v></c></row>' })
		);
		await expect(page.locator('dialog[open]')).toContainText(
			'used range is 1,048,576 rows by 16,384 columns',
			{ timeout: 10000 }
		);
	});

	test('a DOCTYPE (entity expansion) is refused', async ({ page }) => {
		let ents = '<!ENTITY lol "lol">';
		for (let i = 1; i <= 9; i++)
			ents += `<!ENTITY lol${i} "${`&lol${i === 1 ? '' : i - 1};`.repeat(10)}">`;
		await previewWorkbook(page, 'laughs.xlsx', workbook({ prolog: `<!DOCTYPE sst [${ents}]>` }));
		await expect(page.locator('dialog[open]')).toContainText('document type declaration', {
			timeout: 10000
		});
	});
});

test('ROB-U6: an unknown analysis is marked on its card and named in a warning', async ({
	page
}) => {
	const json = JSON.parse(
		readFileSync(path.resolve('static/sessions/demos/demo-tp-smootheddata.json'), 'utf8')
	);
	for (const tp of json.tableProcesses) if (tp.name === 'SmoothedData') tp.name = 'NoSuchAnalysis';
	await openApp(page);
	await page.locator('button.primary-card', { hasText: 'Import data' }).click();
	await page.locator('#fileInput').setInputFiles({
		name: 'unknown.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(json))
	});
	const card = page.locator('.workflow-node-wrapper[data-node-id="tableprocess_89"]');
	await expect(card.locator('.tp-unknown')).toContainText('Unknown analysis "NoSuchAnalysis"', {
		timeout: 30000
	});
	await expect(card.locator('.node-warning-badge')).toBeVisible();
	await expect(page.getByText(/does not\s+know: "NoSuchAnalysis"/)).toBeVisible();
});

async function openExample(page, name) {
	await openApp(page);
	await page.getByRole('button', { name }).first().click();
	await expect(page.locator('.workflow-node-wrapper').first()).toBeVisible({ timeout: 30000 });
	await page.waitForTimeout(2000); // computed nodes settle
}

const undoButton = (page) => page.locator('button[aria-label="Undo"]');

test('UI-U2: opening an example leaves nothing to undo', async ({ page }) => {
	for (const name of [/Anscombe/, /Simpson/]) {
		await openExample(page, name);
		await expect(undoButton(page)).toBeDisabled();
		const nodes = await page.locator('.workflow-node-wrapper').count();
		await page.keyboard.press('ControlOrMeta+z');
		await page.waitForTimeout(500);
		await expect(page.locator('.workflow-node-wrapper')).toHaveCount(nodes);
		await page.goto('/');
	}
});

test('UI-U4: deleting a note can be undone and redone', async ({ page }) => {
	await openExample(page, /Anscombe/);
	await page.getByTestId('nav-workspace-view').click();
	const notes = page.locator('.canvas-inner .note-card');
	await expect(notes).toHaveCount(1);
	const text = await notes.first().locator('textarea').inputValue();
	await notes.first().hover();
	await notes.first().locator('button[title="Delete note"]').click();
	await expect(notes).toHaveCount(0);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(notes).toHaveCount(1);
	await expect(notes.first().locator('textarea')).toHaveValue(text);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(notes).toHaveCount(0);
});

test('UI-U5: reload of an untouched example shows the start screen; an edit asks first', async ({
	page
}) => {
	// Whether the unload guard would ask, read the way the browser does: a cancelable
	// beforeunload event that a listener prevents. (Headless Chromium never shows the dialog.)
	const guardAsks = () =>
		page.evaluate(() => {
			const e = new Event('beforeunload', { cancelable: true });
			window.dispatchEvent(e);
			return e.defaultPrevented;
		});
	await openExample(page, /Anscombe/);
	expect(await guardAsks()).toBe(false);
	await page.reload();
	await expect(page.locator('[aria-labelledby="start-heading"]')).toBeVisible({ timeout: 30000 });

	await openExample(page, /Anscombe/);
	const title = page.locator('.tp-title').first();
	await title.dblclick();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('Renamed');
	await page.keyboard.press('Enter');
	await expect(page.locator('.tp-title').first()).toContainText('Renamed');
	expect(await guardAsks()).toBe(true);
});
