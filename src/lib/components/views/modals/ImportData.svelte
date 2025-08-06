<script module>
	// @ts-nocheck
	import Papa from 'papaparse';
	import { DateTime } from 'luxon';

	import { appConsts, pushObj } from '$lib/core/core.svelte';
	import { Table } from '$lib/core/table.svelte';
	import { Column } from '$lib/core/Column.svelte';
	import { guessDateofArray, forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
	import { numToString } from '$lib/utils/GeneralUtils';

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
		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms)); // short wait to make sure the spinner will show
		await parseFile();
		awaitingPreview = false;
		importReady = true; // Set only after parseFile fully resolves
	}

	async function confirmImport() {
		awaitingLoad = true;
		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms)); // short wait to make sure the spinner will show
		await loadData();
		awaitingLoad = false;
		resetValues();
		showImportModal = false;
	}

	async function parseFile() {
		return new Promise((resolve, reject) => {
			if (!targetFile) {
				errorInfile = true;
				resolve();
				return;
			}

			errorInfile = false;
			let parseAttempts = 0;
			const maxAttempts = 2; // Prevent infinite recursion

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

						//TODO: test with actiware data
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
							//TODO: test this and adjust as necessary
							if (previewIN === skipLines) {
								previewIN = 14;
								if (parseAttempts < maxAttempts) {
									parseAttempts++;
									tryParse(); // Recursive call
									return;
								}
							} else {
								results.data = awdTocsv(results.data);
							}
						}

						if (results.errors.length > 0) {
							errorInfile = true;
						}

						// Check if we need to reparse due to special file types
						if (
							(specialRecognised === 'actiware' || specialRecognised === 'MW8') &&
							parseAttempts === 0
						) {
							parseAttempts++;
							tryParse(); // Recursive call
							return;
						}

						// Final processing
						// await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate delay
						dealWithData(results.meta.fields, results.data);
						resolve();
					}
				});
			}

			tryParse();
		});
	}

	function dealWithData(headersIN, dataIN) {
		//convert the data into an object of arrays

		if (hasHeader) {
			headers = headersIN;
		} else {
			headers = Array(dataIN[0].length)
				.fill(1)
				.map((_, i) => numToString(i));
		}

		parsedData = convertArrayToObject(dataIN);

		//TODO: If there is a separate date and time, combine them
	}

	//Converts the array into an object - more like AnCir uses
	function convertArrayToObject(inputArray) {
		try {
			let resultObject = {};
			// Initialize resultObject with empty arrays for each key
			headers.forEach((key) => {
				resultObject[key] = [];
			});

			// Loop through each object in the array
			inputArray.forEach((row) => {
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

	//Load the data once all operations have been completed
	async function loadData() {
		previewIN = 0; // This means we want to read in all the data
		await parseFile(); //load all the data

		doBasicFileImport(parsedData, targetFile.name); //LOAD THE DATA
	}

	// put the data into the tool store
	// TODO_med: check the logic here, as the Sampling freq isn't updating properly for times.
	async function doBasicFileImport(result, fname) {
		// create Table object with constructor(Id, importedFrom, displayName, dataLength)
		const newDataEntry = new Table();
		// importedFrom = fname;
		// dataLength = result[Object.keys(result)[0]].length;
		newDataEntry.setName(`data_${newDataEntry.id}`);

		//insert a data element for each header
		Object.keys(result).forEach((f, i) => {
			//find the data type based on the first non-NaN element
			const datum = getFirstValid(result[f], 5);
			const guessedFormat = guessDateofArray(result[f]);

			//If it's a time
			if (guessedFormat != -1 && guessedFormat.length > 0) {
				const df = new Column({});
				df.type = 'time';
				df.name = f;
				df.data = result[f];
				df.timeFormat = guessedFormat;
				newDataEntry.addColumn(df);
			} else if (!isNaN(datum)) {
				//if it's a number
				const df = new Column({});
				df.type = 'number';
				df.name = f;
				df.data = result[f];
				newDataEntry.addColumn(df);
			} else {
				//otherwise it's a category
				const df = new Column({});
				df.type = 'category';
				df.name = f;
				df.data = result[f];
				newDataEntry.addColumn(df);
			}
		});
		// console.log(newDataEntry instanceof Table);
		pushObj(newDataEntry);

		//to allow the animation to occur
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms || 10));
	}

	// get the first valid data point in the result, given key
	function getFirstValid(data) {
		for (const value of data) {
			if (value !== null && value !== '' && !specialValues.includes(value)) {
				return value;
			}
		}
		// Return a default value if no valid value is found
		return null;
	}
</script>

<Modal bind:showModal={showImportModal}>
	{#snippet header()}
		{#if awaitingPreview}
			<div class="title-container">
				<Icon name="spinner" width={32} height={32} className="spinner" />
				<p>Importing data from {targetFile?.name ?? 'file'}.</p>
			</div>
		{:else if awaitingLoad}
			<div class="title-container">
				<Icon name="spinner" width={32} height={32} className="spinner" />
				<p>Loading data from {targetFile?.name ?? 'file'}.</p>
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
				accept=".csv,.awd,.txt"
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
							Skip lines: <input
								type="number"
								bind:value={skipLines}
								min="0"
								oninput={() => doPreview()}
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
				<button class="dialog-button" onclick={confirmImport}>Confirm Import</button>
			{/if}
		</div>
	{/snippet}
</Modal>

<style>
	.title-container {
		display: flex;
		justify-content: left; /* Left horizontally */
		align-items: center; /* Center vertically */
		gap: 10px; /* Space between logo and text */
	}
</style>
