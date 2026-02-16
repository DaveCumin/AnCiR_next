<script module>
	// @ts-nocheck
	import Papa from 'papaparse';
	import * as XLSX from 'xlsx';
	import { DateTime } from 'luxon';

	import { appConsts, core, pushObj } from '$lib/core/core.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import { Column } from '$lib/core/Column.svelte';
	import { guessDateofArray, forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
	import { numToString } from '$lib/utils/GeneralUtils';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import Modal from '$lib/components/reusables/Modal.svelte';
	import TableLayout from '$lib/components/plotbits/Table.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { tick } from 'svelte';
	import { stackOrderInsideOut } from 'd3-shape';
	import { parse } from 'svelte/compiler';

	const specialValues = ['NaN', 'NA', 'null'];

	let importReady = $state(false);
	let hasHeader = $state(true);
	let headers = $state([]);
	let delimiter = $state('');
	let targetFile = $state();
	let previewIN = $state(6);
	let skipLines = $state(0);
	let error = $state({});
	let parsedData = $state(null);
	let errorInfile = $state(false);
	let specialRecognised = $state(false);
	let awaitingPreview = $state(false);
	let awaitingLoad = $state(false);

	// Progress feedback
	let loadProgress = $state({ stage: '', detail: '' });

	let showImportModal = $state(false);
	let fileInput = $state();

	let buttonText = $derived(targetFile ? 'Change file' : 'Choose File');

	function resetValues() {
		parsedData = null;
		importReady = false;
		hasHeader = true;
		delimiter = '';
		targetFile = null;
		previewIN = 6;
		skipLines = 0;
		errorInfile = false;
		error = {};
		specialRecognised = false;
		loadProgress = { stage: '', detail: '' };
	}

	export async function openImportModal() {
		resetValues();
		showImportModal = true;
		await tick();
		fileInput?.click();
	}

	async function onFileChange(e) {
		targetFile = e.target.files[0];

		if (targetFile) {
			await doPreview();
		}
	}

	async function doPreview() {
		awaitingPreview = true;
		loadProgress = { stage: 'Reading file', detail: targetFile?.name ?? '' };
		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms));

		loadProgress = { stage: 'Parsing', detail: 'Detecting format…' };
		await tick();

		await parseFile();

		loadProgress = { stage: '', detail: '' };
		awaitingPreview = false;
		importReady = true;
	}

	async function confirmImport() {
		awaitingLoad = true;
		loadProgress = { stage: 'Loading data', detail: 'Reading full file…' };
		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms));
		await loadData();
		awaitingLoad = false;
		resetValues();
		showImportModal = false;
	}

	async function parseXLSX(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();

			reader.onload = async (e) => {
				try {
					loadProgress = { stage: 'Parsing', detail: 'Reading Excel workbook…' };
					await tick();

					const data = new Uint8Array(e.target.result);
					const workbook = XLSX.read(data, { type: 'array' });

					const firstSheetName = workbook.SheetNames[0];
					const worksheet = workbook.Sheets[firstSheetName];

					loadProgress = { stage: 'Parsing', detail: `Converting sheet "${firstSheetName}"…` };
					await tick();

					const csv = XLSX.utils.sheet_to_csv(worksheet, {
						skipHidden: true,
						blankrows: false
					});
					console.log('Converted CSV: ', csv);

					loadProgress = { stage: 'Parsing', detail: 'Parsing rows…' };
					await tick();

					Papa.parse(csv, {
						preview: previewIN,
						header: hasHeader,
						dynamicTyping: true,
						skipEmptyLines: 'greedy',
						skipFirstNLines: skipLines,
						complete: (results) => {
							dealWithData(results.meta.fields, results.data);
							resolve();
						},
						error: (err) => {
							error = { err, reason: 'Failed to parse XLSX data' };
							errorInfile = true;
							reject(err);
						}
					});
				} catch (err) {
					error = { err, reason: 'Failed to read XLSX file' };
					errorInfile = true;
					reject(err);
				}
			};

			reader.onerror = () => {
				error = { err: reader.error, reason: 'Failed to read file' };
				errorInfile = true;
				reject(reader.error);
			};

			reader.readAsArrayBuffer(file);
		});
	}

	async function parseFile() {
		if (!targetFile) {
			errorInfile = true;
			return;
		}

		errorInfile = false;

		const isExcel = targetFile.name.toLowerCase().match(/\.(xlsx|xls)$/);

		if (isExcel) {
			return await parseXLSX(targetFile);
		}

		return new Promise((resolve, reject) => {
			let parseAttempts = 0;
			const maxAttempts = 2;

			function tryParse() {
				Papa.parse(targetFile, {
					preview: previewIN,
					header: hasHeader,
					dynamicTyping: true,
					skipEmptyLines: 'greedy',
					skipFirstNLines: skipLines,
					delimiter: delimiter,
					error: function (err, file, inputElem, reason) {
						console.warn('PapaParse Error: ' + err + ' | ' + reason);
						parsedData = {};
						error = { err, reason };
						reject(err);
					},
					beforeFirstChunk: (chunk) => {
						const lines = chunk.split(/\r\n|\r|\n/);
						const firstLine = lines[0].split(/[,;\t]/);

						if (firstLine?.includes('Actiware Export File') && !specialRecognised) {
							specialRecognised = 'actiware';
							skipLines = 148;
						} else if (firstLine?.includes('UserID') && !specialRecognised) {
							specialRecognised = 'MW8';
							skipLines = 10;
							hasHeader = true;
						}

						return lines.join('\n');
					},
					complete: async (results, file) => {
						if (file.name.toLowerCase().endsWith('.awd')) {
							results.errors = [];
							if (previewIN === skipLines) {
								previewIN = 14;
								if (parseAttempts < maxAttempts) {
									parseAttempts++;
									tryParse();
									return;
								}
							} else {
								results.data = awdTocsv(results.data);
							}
						}

						if (results.errors.length > 0) {
							errorInfile = true;
						}

						if (
							(specialRecognised === 'actiware' || specialRecognised === 'MW8') &&
							parseAttempts === 0
						) {
							parseAttempts++;
							tryParse();
							return;
						}

						dealWithData(results.meta.fields, results.data);
						resolve();
					}
				});
			}

			tryParse();
		});
	}

	function dealWithData(headersIN, dataIN) {
		if (hasHeader) {
			headers = headersIN;
		} else {
			headers = Array(dataIN[0].length)
				.fill(1)
				.map((_, i) => numToString(i));
		}

		parsedData = convertArrayToObject(dataIN);
	}

	function convertArrayToObject(inputArray) {
		try {
			let resultObject = {};
			headers.forEach((key) => {
				resultObject[key] = [];
			});

			inputArray.forEach((row, r) => {
				Object.keys(row).forEach((k, idx) => {
					resultObject[headers[idx]].push(row[k]);
				});
			});
			return resultObject;
		} catch (error) {
			console.warn('Error converting array to object:', error);
			return {};
		}
	}

	function changeObjectKeys(object, newKeys) {
		const newObject = {};

		Object.keys(object).forEach((originalKey, i) => {
			const newKey = newKeys[i] || originalKey;
			if (object[originalKey]) {
				object[originalKey].splice(0, 1);
				newObject[newKey] = object[originalKey];
			}
		});

		return newObject;
	}

	async function loadData() {
		previewIN = 0;

		loadProgress = { stage: 'Loading data', detail: 'Parsing full file…' };
		await tick();

		await parseFile();

		loadProgress = { stage: 'Loading data', detail: 'Building columns…' };
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 10));

		doBasicFileImport(parsedData, targetFile.name);
	}

	async function doBasicFileImport(result, fname) {
		const newDataEntry = new Table();
		newDataEntry.setName(`data_${newDataEntry.id}`);

		const keys = Object.keys(result);
		const totalColumns = keys.length;

		for (let i = 0; i < totalColumns; i++) {
			const f = keys[i];

			// Update progress for each column
			loadProgress = {
				stage: 'Loading data',
				detail: `Processing column ${i + 1} of ${totalColumns}: "${f}"`
			};
			// Yield to the UI every few columns so the progress text updates
			if (i % 5 === 0) {
				await tick();
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			const datum = getFirstValid(result[f], 5);
			const guessedFormat = guessDateofArray(result[f]);
			const df = new Column({});

			if (guessedFormat != -1 && guessedFormat.length > 0) {
				console.log('time here...');
				console.log('guess: ', guessedFormat);
				console.log('result: ', result[f]);

				df.type = 'time';
				df.timeFormat = guessedFormat;
			} else if (!isNaN(datum)) {
				df.type = 'number';
			} else {
				df.type = 'category';
			}
			df.name = f;
			core.rawData.set(df.id, result[f]);
			df.data = df.id;
			newDataEntry.addColumn(df);
		}

		loadProgress = { stage: 'Loading data', detail: 'Finalising…' };
		await tick();

		pushObj(newDataEntry);

		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms || 10));
	}

	function getFirstValid(data) {
		for (const value of data) {
			if (value !== null && value !== '' && !specialValues.includes(value)) {
				return value;
			}
		}
		return null;
	}
</script>

<Modal bind:showModal={showImportModal}>
	{#snippet header()}
		{#if awaitingPreview}
			<div class="title-container">
				<Icon name="spinner" width={32} height={32} className="spinner" />
				<div>
					<p>Importing data from {targetFile?.name ?? 'file'}.</p>
					{#if loadProgress.detail}
						<p class="progress-detail">{loadProgress.detail}</p>
					{/if}
				</div>
			</div>
		{:else if awaitingLoad}
			<div class="title-container">
				<Icon name="spinner" width={32} height={32} className="spinner" />
				<div>
					<p>Loading data from {targetFile?.name ?? 'file'}.</p>
					{#if loadProgress.detail}
						<p class="progress-detail">{loadProgress.detail}</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="heading">
				<h2>Import Data</h2>
				<div class="choose-file-container">
					<button class="choose-file-button" onclick={(e) => fileInput.click()}>{buttonText}</button
					>
					<div class="filename">
						<p class="filename-preview">
							Selected:
							{#if targetFile}
								{targetFile.name}
							{/if}
						</p>
					</div>
				</div>
			</div>
			<input
				bind:this={fileInput}
				id="fileInput"
				type="file"
				accept=".csv,.awd,.txt,.xlsx,.xls"
				onchange={onFileChange}
				style="display: none;"
			/>
		{/if}
	{/snippet}

	{#snippet children()}
		{#if !awaitingPreview && !awaitingLoad}
			<div class="import-container">
				<div class="preview-placeholder">
					{#if parsedData && importReady}
						<p>
							Header: <input
								type="checkbox"
								bind:checked={hasHeader}
								onchange={() => doPreview()}
							/>
							Delimiter:
							<select bind:value={delimiter} onchange={() => doPreview()}>
								<option value="">auto</option>
								<option value=",">, (comma)</option>
								<option value=";">; (semicolon)</option>
								<option value="\t">Tab</option>
								<option value="|">| (pipe)</option>
								<option value=" ">(space)</option>
							</select>
						</p>
						<p>
							Skip lines: <NumberWithUnits
								bind:value={skipLines}
								min="0"
								onInput={() => doPreview()}
							/>
						</p>
						<div
							class="preview-table-wrapper"
							style="width: {150 * Object.keys(parsedData).length}px; !important"
						>
							<TableLayout {headers} data={Object.keys(parsedData).map((k) => parsedData[k])} />
						</div>
					{:else if !awaitingPreview && !awaitingLoad}
						<p>Choose file to preview data</p>
					{/if}
				</div>
			</div>
		{/if}
	{/snippet}

	{#snippet button()}
		<div class="dialog-button-container">
			{#if importReady && !awaitingPreview && !awaitingLoad}
				<button id="confirmImport" class="dialog-button" onclick={confirmImport}
					>Confirm Import</button
				>
			{/if}
		</div>
	{/snippet}
</Modal>

<style>
	.title-container {
		display: flex;
		justify-content: left;
		align-items: center;
		gap: 10px;
	}

	.progress-detail {
		font-size: 0.85em;
		color: var(--color-lightness-45, #777);
		margin-top: 2px;
	}
</style>
