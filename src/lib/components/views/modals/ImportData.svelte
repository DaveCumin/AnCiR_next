<script module>
	// @ts-nocheck
	import Papa from 'papaparse';
	import * as XLSX from '$lib/utils/xlsxLite';
	import { DateTime } from 'luxon';

	import { appConsts, core, pushObj, appState } from '$lib/core/core.svelte';
	import { Table } from '$lib/core/Table.svelte';
	import { Column } from '$lib/core/Column.svelte';
	import { guessDateofArray, forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
	import { numToString } from '$lib/utils/GeneralUtils';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import Modal from '$lib/components/reusables/Modal.svelte';
	import TableLayout from '$lib/components/plotbits/Table.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { importJson } from '$lib/components/iconActions/Setting.svelte';
	import { tick } from 'svelte';
	import { stackOrderInsideOut } from 'd3-shape';
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';

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
	let awdMeta = $state(null); // { startMs, stepMs, count } for AWD time compression

	// Binning for large files
	const ROW_THRESHOLD = 15000;
	let totalRowCount = $state(0);
	let binningEnabled = $state(false);
	let binIntervalMin = $state(15); // default 15 minutes
	let dataIntervalMin = $derived(awdMeta ? awdMeta.stepMs / 60_000 : 1);
	let estimatedBinnedRows = $derived(Math.ceil((totalRowCount * dataIntervalMin) / binIntervalMin));

	// Progress feedback
	let loadProgress = $state({ stage: '', detail: '' });

	let showImportModal = $state(false);
	let fileInput = $state();

	let buttonText = $derived(targetFile ? 'Change file' : 'Choose File');

	let selectedColumns = $state(new Set());

	// Multi-file concatenation support
	let targetFiles = $state([]); // All selected files
	let extraFileErrors = $state([]); // [{ filename, error }] for header mismatches
	let checkingHeaders = $state(false); // True while validating additional file headers

	function resetValues() {
		parsedData = null;
		importReady = false;
		hasHeader = true;
		delimiter = '';
		targetFile = null;
		targetFiles = [];
		previewIN = 6;
		skipLines = 0;
		errorInfile = false;
		error = {};
		specialRecognised = false;
		loadProgress = { stage: '', detail: '' };
		awdMeta = null;
		totalRowCount = 0;
		binningEnabled = false;
		binIntervalMin = 15;
		selectedColumns.clear();
		extraFileErrors = [];
		checkingHeaders = false;
	}

	export async function openImportModal() {
		resetValues();
		showImportModal = true;
		await tick();
		fileInput?.click();
	}

	async function onFileChange(e) {
		const files = [...e.target.files];
		targetFiles = files;
		targetFile = files[0] ?? null;

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

		if (headers.length > 0 && selectedColumns.size === 0) {
			// Pre-select everything **only if nothing is selected yet**
			// (protects against re-preview with changed skip/delimiter)
			selectedColumns.clear();
			headers.forEach((col) => selectedColumns.add(col));
		}

		// Count total rows to decide whether to suggest binning
		await countRows();
		if (totalRowCount > ROW_THRESHOLD) {
			binningEnabled = true;
		}

		loadProgress = { stage: '', detail: '' };
		awaitingPreview = false;

		// Re-validate additional file headers whenever preview settings change
		if (targetFiles.length > 1) {
			await checkAdditionalHeaders(targetFiles.slice(1));
		}

		importReady = true;
	}

	async function countRows() {
		if (!targetFile) return;

		const isExcel = targetFile.name.toLowerCase().match(/\.(xlsx|xls)$/);
		const isAWD = targetFile.name.toLowerCase().endsWith('.awd');

		if (isExcel) {
			// For Excel, read the full workbook and count rows
			return new Promise((resolve) => {
				const reader = new FileReader();
				reader.onload = (e) => {
					try {
						const data = new Uint8Array(e.target.result);
						const workbook = XLSX.read(data, { type: 'array' });
						const sheet = workbook.Sheets[workbook.SheetNames[0]];
						const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
						totalRowCount = range.e.r - range.s.r; // rows minus header
					} catch {
						totalRowCount = 0;
					}
					resolve();
				};
				reader.onerror = () => {
					totalRowCount = 0;
					resolve();
				};
				reader.readAsArrayBuffer(targetFile);
			});
		}

		// For CSV/text/AWD: count newlines in file text
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				const text = e.target.result;
				const lineCount = text.split(/\r\n|\r|\n/).length;
				// Subtract header + skipLines
				totalRowCount = Math.max(0, lineCount - (hasHeader ? 1 : 0) - skipLines);
				if (isAWD) {
					totalRowCount = Math.max(0, lineCount - 7); // AWD has 7-line header
				}
				resolve();
			};
			reader.onerror = () => {
				totalRowCount = 0;
				resolve();
			};
			reader.readAsText(targetFile);
		});
	}

	async function confirmImport() {
		awaitingLoad = true;
		loadProgress = { stage: 'Loading data', detail: 'Reading full file…' };
		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms));
		await loadData();
		console.log('Import complete');
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
					//console.log('Converted CSV: ', csv);

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
							if (parseAttempts === 0) {
								// Re-parse: no header (AWD has its own 7-line header),
								// no row limit, no skip
								hasHeader = false;
								previewIN = 0;
								skipLines = 0;
								parseAttempts++;
								tryParse();
								return;
							} else {
								results.data = awdTocsv(results.data);
								results.meta.fields = headers;
								// Limit preview to first 6 rows (like CSV)
								if (awaitingPreview && results.data.length > 6) {
									results.data = results.data.slice(0, 6);
								}
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

	function getFilteredData() {
		if (selectedColumns.size === headers.length) {
			// all selected → return original
			return parsedData;
		}

		const result = {};
		for (const col of selectedColumns) {
			if (parsedData[col]) {
				result[col] = [...parsedData[col]]; // copy
			}
		}
		return result;
	}

	// ─── Multi-file helpers ────────────────────────────────────────────────────

	/** Parse just enough of a file to get its column headers. */
	async function getFileHeaders(file) {
		const isExcel = file.name.toLowerCase().match(/\.(xlsx|xls)$/);
		const isAWD = file.name.toLowerCase().endsWith('.awd');

		if (isAWD) {
			throw new Error('AWD format files cannot be combined with other files.');
		}

		if (isExcel) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = (e) => {
					try {
						const data = new Uint8Array(e.target.result);
						const workbook = XLSX.read(data, { type: 'array' });
						const sheet = workbook.Sheets[workbook.SheetNames[0]];
						const csv = XLSX.utils.sheet_to_csv(sheet, { skipHidden: true, blankrows: false });
						Papa.parse(csv, {
							preview: 1,
							header: hasHeader,
							dynamicTyping: false,
							skipEmptyLines: true,
							complete: (results) => {
								resolve(
									hasHeader
										? (results.meta.fields ?? [])
										: (results.data[0]?.map((_, i) => numToString(i)) ?? [])
								);
							},
							error: reject
						});
					} catch (err) {
						reject(err);
					}
				};
				reader.onerror = () => reject(reader.error);
				reader.readAsArrayBuffer(file);
			});
		}

		// CSV / text
		return new Promise((resolve, reject) => {
			Papa.parse(file, {
				preview: skipLines + (hasHeader ? 1 : 2),
				header: hasHeader,
				dynamicTyping: false,
				skipEmptyLines: true,
				skipFirstNLines: skipLines,
				delimiter: delimiter,
				complete: (results) => {
					if (hasHeader) {
						resolve(results.meta.fields ?? []);
					} else {
						resolve(results.data[0]?.map((_, i) => numToString(i)) ?? []);
					}
				},
				error: reject
			});
		});
	}

	/** Check that each additional file's headers match the reference (first) file. */
	async function checkAdditionalHeaders(additionalFiles) {
		checkingHeaders = true;
		extraFileErrors = [];

		// AWD primary file: multi-file not supported
		if (targetFile?.name.toLowerCase().endsWith('.awd')) {
			extraFileErrors = additionalFiles.map((f) => ({
				filename: f.name,
				error: 'Multi-file concatenation is not supported for AWD files.'
			}));
			checkingHeaders = false;
			return;
		}

		const refHeaders = [...headers];

		for (const file of additionalFiles) {
			try {
				const fileHdrs = await getFileHeaders(file);
				const match =
					fileHdrs.length === refHeaders.length && fileHdrs.every((h, i) => h === refHeaders[i]);
				if (!match) {
					extraFileErrors = [
						...extraFileErrors,
						{
							filename: file.name,
							error: `Headers don't match. Expected [${refHeaders.join(', ')}], got [${fileHdrs.join(', ')}]`
						}
					];
				}
			} catch (err) {
				extraFileErrors = [
					...extraFileErrors,
					{ filename: file.name, error: err.message ?? String(err) }
				];
			}
		}

		checkingHeaders = false;
	}

	/** Fully parse an additional file and return column-oriented data. */
	async function parseAdditionalFileData(file) {
		const isExcel = file.name.toLowerCase().match(/\.(xlsx|xls)$/);

		if (isExcel) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = (e) => {
					try {
						const data = new Uint8Array(e.target.result);
						const workbook = XLSX.read(data, { type: 'array' });
						const sheet = workbook.Sheets[workbook.SheetNames[0]];
						const csv = XLSX.utils.sheet_to_csv(sheet, { skipHidden: true, blankrows: false });
						Papa.parse(csv, {
							header: hasHeader,
							dynamicTyping: true,
							skipEmptyLines: 'greedy',
							complete: (results) => resolve(convertArrayToObject(results.data)),
							error: reject
						});
					} catch (err) {
						reject(err);
					}
				};
				reader.onerror = () => reject(reader.error);
				reader.readAsArrayBuffer(file);
			});
		}

		// CSV / text
		return new Promise((resolve, reject) => {
			Papa.parse(file, {
				header: hasHeader,
				dynamicTyping: true,
				skipEmptyLines: 'greedy',
				skipFirstNLines: skipLines,
				delimiter: delimiter,
				complete: (results) => resolve(convertArrayToObject(results.data)),
				error: reject
			});
		});
	}

	// ──────────────────────────────────────────────────────────────────────────

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
		awaitingLoad = true;

		loadProgress = { stage: 'Loading data', detail: 'Parsing full file…' };
		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms || 50));

		const isAWD = targetFile.name.toLowerCase().endsWith('.awd');

		if (isAWD) {
			// For AWD: force clean full parse (double-pass) and ensure awdMeta is set
			//console.log('[AWD FULL] Starting dedicated full AWD parse');
			await parseFullAWD();
			//console.log('[AWD FULL] Parse complete, awdMeta now:', $state.snapshot(awdMeta));
		} else {
			// Normal files: re-use existing parseFile logic
			await parseFile();
		}

		// Apply binning if enabled
		if (binningEnabled && parsedData) {
			loadProgress = {
				stage: 'Loading data',
				detail: `Binning to ${binIntervalMin} min intervals…`
			};
			await tick();
			await new Promise((resolve) => setTimeout(resolve, 10));
			parsedData = binParsedData(parsedData);
			// Clear awdMeta since binned data no longer matches compressed time
			if (awdMeta) awdMeta = null;
		}

		// ─────────────── Filter to selected columns ─────────────────
		loadProgress = { stage: 'Loading data', detail: 'Filtering selected columns…' };
		await tick();

		parsedData = getFilteredData();
		console.log(selectedColumns);

		// ─────────────── Concatenate additional files (multi-file mode) ──────────
		if (targetFiles.length > 1) {
			for (let i = 1; i < targetFiles.length; i++) {
				const extraFile = targetFiles[i];
				loadProgress = {
					stage: 'Loading data',
					detail: `Concatenating file ${i + 1} of ${targetFiles.length}: ${extraFile.name}`
				};
				await tick();
				await new Promise((r) => setTimeout(r, 10));

				const extraData = await parseAdditionalFileData(extraFile);

				// Append each selected column's values from the extra file
				for (const col of selectedColumns) {
					if (parsedData[col] && extraData[col]) {
						parsedData[col] = [...parsedData[col], ...extraData[col]];
					}
				}
			}
		}

		loadProgress = { stage: 'Loading data', detail: 'Building columns…' };
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 10));

		const importName =
			targetFiles.length > 1
				? `${targetFile.name} (+${targetFiles.length - 1} more)`
				: targetFile.name;

		await doBasicFileImport(parsedData, importName);

		awaitingLoad = false;
	}

	export async function loadFromURL(url) {
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error('Network response was not ok');
			}
			const apiResults = await response.json();
			console.log('Fetched JSON from URL:', apiResults);

			awaitingLoad = true;
			appState.loadingState.isLoading = true;
			appState.loadingState.loadingMsg = `Loading data from ${url}…`;
			await tick();

			await importJson(apiResults, (detail) => {
				appState.loadingState.loadingMsg = detail;
			});

			appState.loadingState.isLoading = false;
			appState.loadingState.loadingMsg = '';
			awaitingLoad = false;
		} catch (error) {
			appState.loadingState.isLoading = false;
			appState.loadingState.loadingMsg = '';
			awaitingLoad = false;
			const msg = error?.message ?? String(error);
			alert(`Failed to load session from URL.\n\n${msg}`);
			console.error('loadFromURL error:', error);
		}
	}

	async function doBasicFileImport(result, fname) {
		const newDataEntry = new Table();
		newDataEntry.setName(`data_${newDataEntry.id}`);

		const keys = Object.keys(result);
		const totalColumns = keys.length;

		for (let i = 0; i < totalColumns; i++) {
			const f = keys[i];

			loadProgress = {
				stage: 'Loading data',
				detail: `Processing column ${i + 1} of ${totalColumns}: "${f}"`
			};
			if (i % 5 === 0) {
				await tick();
				await new Promise((r) => setTimeout(r, 0));
			}

			const df = new Column({});

			if (awdMeta && f === 'DateTime') {
				// Special handling: compressed time column
				df.type = 'time';
				df.compression = 'awd';
				df.name = 'DateTime'; // or 'Time since start (h)', etc. — you can rename later
				core.rawData.set(df.id, {
					start: awdMeta.startMs,
					step: awdMeta.stepMs,
					length: awdMeta.count // note: length = number of epochs
				});
				df.data = df.id;
			} else {
				// Normal columns
				const datum = getFirstValid(result[f], 5);
				const guessedFormat = guessDateofArray(result[f]);

				if (guessedFormat !== -1 && guessedFormat.length > 0) {
					df.type = 'time';
					df.timeFormat = guessedFormat;
				} else if (typeof datum === 'number' && !isNaN(datum)) {
					df.type = 'number';
				} else {
					df.type = 'category';
				}

				df.name = f;
				core.rawData.set(df.id, result[f]);
				df.data = df.id;
			}

			newDataEntry.addColumn(df);
		}

		loadProgress = { stage: 'Loading data', detail: 'Finalising…' };
		await tick();

		pushObj(newDataEntry);

		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms || 10));
	}

	function awdTocsv(data) {
		// AWD format: fixed 7-line header, then comma-separated data rows.
		// Line 0: NAME (ignored)
		// Line 1: START DATE (dd-MMM-yyyy, e.g. "10-Nov-1996")
		// Line 2: START TIME (HH:mm, e.g. "16:22")
		// Line 3: INTERVAL (sample interval in minutes × 4, so 4 → 1 min)
		// Line 4: AGE (ignored)
		// Line 5: ID (ignored)
		// Line 6: SEX (ignored)
		// Line 7+: Activity , Marker  (comma-separated data)
		if (data.length < 8) return data;

		// --- Header parsing ---
		const dateStr = String(data[1]?.[0] ?? '').trim();
		const timeStr = String(data[2]?.[0] ?? '').trim();
		const intervalRaw = Number(data[3]?.[0]) || 4; // usually 4 = 1 minute

		// intervalRaw × 15 = seconds per epoch
		const epochSeconds = intervalRaw * 15;

		// Parse start date — try full year first, then 2-digit
		let startDate = DateTime.fromFormat(dateStr, 'dd-MMM-yyyy', { locale: 'en' });
		if (!startDate.isValid) {
			startDate = DateTime.fromFormat(dateStr, 'dd-MMM-yy', { locale: 'en' });
		}
		if (!startDate.isValid) {
			console.warn('Invalid AWD start date:', dateStr);
			startDate = DateTime.now().startOf('day');
		}

		// Add start time
		let startDT = startDate;
		const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
		if (timeMatch) {
			startDT = startDate.set({
				hour: Number(timeMatch[1]),
				minute: Number(timeMatch[2]),
				second: 0,
				millisecond: 0
			});
		} else {
			console.warn('Invalid AWD start time:', timeStr);
		}

		const dataRows = data.slice(7);
		if (dataRows.length === 0) return data;

		// Detect number of data columns
		const sampleCols = dataRows[0]?.length ?? 1;
		const colNames = ['DateTime', 'Activity'];
		if (sampleCols >= 2) colNames.push('Marker');
		for (let c = 2; c < sampleCols; c++) {
			colNames.push(`Extra${c}`);
		}

		// Metadata for time compression (used only for non-DateTime columns if you want later)
		awdMeta = {
			startMs: startDT.toMillis(),
			stepMs: epochSeconds * 1000,
			count: dataRows.length
		};

		// Build preview/full rows
		const output = dataRows.map((row, i) => {
			const obj = {};

			// Always generate proper ISO-like datetime for DateTime column (needed for type guessing)
			const dt = startDT.plus({ seconds: i * epochSeconds });
			obj.DateTime = dt.toFormat('yyyy-MM-dd HH:mm:ss');

			// Other columns: numbers
			obj.Activity = row[0] != null ? Number(row[0]) : 0;
			for (let c = 1; c < row.length; c++) {
				const val = row[c];
				obj[colNames[c + 1]] = val != null && !isNaN(val) ? Number(val) : val;
			}

			return obj;
		});

		headers = colNames;
		hasHeader = true;

		return output;
	}
	async function parseFullAWD() {
		return new Promise((resolve, reject) => {
			let attempts = 0;

			function innerParse() {
				Papa.parse(targetFile, {
					preview: 0,
					header: false,
					dynamicTyping: true,
					skipEmptyLines: 'greedy',
					delimiter: ',',
					complete: (results) => {
						if (attempts === 0) {
							attempts++;
							innerParse();
							return;
						}

						// Second pass — this is the full one
						results.data = awdTocsv(results.data);
						results.meta.fields = headers;

						dealWithData(results.meta.fields, results.data);
						resolve();
					},
					error: (err) => reject(err)
				});
			}

			innerParse();
		});
	}

	function binParsedData(data) {
		// data is { colName: [values...], ... } — column-oriented
		const keys = Object.keys(data);
		if (keys.length === 0) return data;

		const rowCount = data[keys[0]].length;
		if (rowCount === 0) return data;

		// Find the time column
		let timeKey = null;
		let timeFormat = null;
		for (const k of keys) {
			const sample = data[k].slice(0, 5);
			const fmt = guessDateofArray(sample);
			if (fmt !== -1 && fmt.length > 0) {
				timeKey = k;
				timeFormat = Array.isArray(fmt) ? fmt[0] : fmt;
				break;
			}
		}

		if (!timeKey) {
			console.warn('Binning: no time column found, skipping');
			return data;
		}

		// Convert time to hours (numeric) for binData compatibility
		let timeHours;
		let firstDt;

		if (awdMeta && timeKey === 'DateTime') {
			// AWD: compute hours directly from metadata — no string parsing needed
			const stepHours = awdMeta.stepMs / 3_600_000;
			firstDt = DateTime.fromMillis(awdMeta.startMs);
			timeHours = new Array(rowCount);
			for (let i = 0; i < rowCount; i++) {
				timeHours[i] = i * stepHours;
			}
		} else {
			// General case: parse time strings
			const timeStrings = data[timeKey];

			// Try multiple Luxon parsers to find one that works
			function parseDt(s) {
				if (s == null) return null;
				const str = String(s);
				let dt = DateTime.fromFormat(str, timeFormat);
				if (dt.isValid) return dt;
				dt = DateTime.fromSQL(str);
				if (dt.isValid) return dt;
				dt = DateTime.fromISO(str);
				if (dt.isValid) return dt;
				return null;
			}

			firstDt = parseDt(timeStrings[0]);
			if (!firstDt) {
				console.warn('Binning: could not parse first time value, skipping');
				return data;
			}

			timeHours = timeStrings.map((t) => {
				const dt = parseDt(t);
				return dt ? dt.diff(firstDt, 'hours').hours : NaN;
			});
		}

		// Guard: check we have valid time data
		const validCount = timeHours.filter((h) => !isNaN(h)).length;
		if (validCount === 0) {
			console.warn('Binning: all time values are NaN, skipping');
			return data;
		}

		const binSizeHours = binIntervalMin / 60;

		// Classify columns
		const colTypes = {};
		for (const k of keys) {
			if (k === timeKey) {
				colTypes[k] = 'time';
				continue;
			}
			const sample = getFirstValid(data[k]);
			colTypes[k] = typeof sample === 'number' && !isNaN(sample) ? 'number' : 'other';
		}

		// Use binData for the first numeric column to get the bin positions
		const firstNumKey = keys.find((k) => colTypes[k] === 'number');
		if (!firstNumKey) {
			console.warn('Binning: no numeric columns found, skipping');
			return data;
		}

		const refResult = binData(timeHours, data[firstNumKey], binSizeHours, 0, binSizeHours, 'mean');
		const binPositions = refResult.bins; // bin start positions in hours
		const numBins = binPositions.length;

		// Build result: for time column, reconstruct datetime strings from bin positions
		const result = {};
		result[timeKey] = binPositions.map((h) => {
			const dt = firstDt.plus({ hours: h });
			return dt.toFormat('yyyy-MM-dd HH:mm:ss');
		});

		// For each other column, bin using binData or map category by index
		for (const k of keys) {
			if (k === timeKey) continue;

			if (colTypes[k] === 'number') {
				if (k === firstNumKey) {
					result[k] = refResult.y_out;
				} else {
					const binned = binData(timeHours, data[k], binSizeHours, 0, binSizeHours, 'mean');
					result[k] = binned.y_out;
				}
			} else {
				// Category: take first value per bin using the bin positions
				result[k] = new Array(numBins);
				let ptr = 0;
				for (let b = 0; b < numBins; b++) {
					const binStart = binPositions[b];
					const binEnd = binStart + binSizeHours;
					// Advance pointer to first row in this bin
					while (ptr < rowCount && (isNaN(timeHours[ptr]) || timeHours[ptr] < binStart)) ptr++;
					result[k][b] = ptr < rowCount && timeHours[ptr] < binEnd ? data[k][ptr] : null;
				}
			}
		}

		return result;
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
			<LoadingSpinner
				message={targetFiles.length > 1
					? `Previewing ${targetFiles.length} files.`
					: `Importing data from ${targetFile?.name ?? 'file'}.`}
				detail={loadProgress.detail}
			/>
		{:else if awaitingLoad}
			<LoadingSpinner
				message={targetFiles.length > 1
					? `Importing ${targetFiles.length} files.`
					: `Loading data from ${targetFile?.name ?? 'file'}.`}
				detail={loadProgress.detail}
			/>
		{:else}
			<div class="heading">
				<h2>Import Data</h2>
				<div class="choose-file-container">
					<button class="choose-file-button" onclick={(e) => fileInput.click()}>{buttonText}</button
					>
					<div class="filename">
						<p class="filename-preview">
							Selected:
							{#if targetFiles.length > 1}
								{targetFiles.length} files
							{:else if targetFile}
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
				multiple
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

						{#if totalRowCount > ROW_THRESHOLD}
							<div class="binning-panel">
								<p class="binning-warning">
									This file has ~{totalRowCount.toLocaleString()} rows. Consider binning to reduce data
									size.
								</p>
								<p>
									<label>
										<input type="checkbox" bind:checked={binningEnabled} />
										Bin data to
									</label>
									<NumberWithUnits bind:value={binIntervalMin} min={1} step={1} /> mins intervals
									{#if binningEnabled}
										<span class="binning-estimate">
											(~{estimatedBinnedRows.toLocaleString()} rows after binning, {dataIntervalMin} min
											intervals detected)
										</span>
									{/if}
								</p>
							</div>
						{/if}
						<div class="preview-table-wrapper" style="overflow-x: auto; max-width: 100%;">
							<table class="preview-table">
								<thead>
									<tr>
										{#each headers as col}
											<th
												class:selected={selectedColumns.has(col)}
												class:unselected={!selectedColumns.has(col)}
											>
												<label class="header-checkbox">
													<input
														type="checkbox"
														checked={selectedColumns.has(col)}
														onchange={(e) => {
															if (e.currentTarget.checked) {
																selectedColumns.add(col);
															} else {
																selectedColumns.delete(col);
															}
															console.log('selectedColumns:', selectedColumns);
														}}
													/>
													<span class="col-name">{col}</span>
												</label>
											</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each Array(Math.min(previewIN, parsedData[headers[0]]?.length || 0)) as _, rowIdx}
										<tr>
											{#each headers as col}
												<td
													class:selected={selectedColumns.has(col)}
													class:unselected={!selectedColumns.has(col)}
												>
													{parsedData[col]?.[rowIdx] ?? '—'}
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>

						{#if targetFiles.length > 1}
							<div class="multi-file-list">
								<p class="multi-file-title">Files to concatenate ({targetFiles.length}):</p>
								<ul>
									{#each targetFiles as file, i}
										<li class="file-item">
											<span class="file-item-name">{file.name}</span>
											{#if i === 0}
												<span class="badge badge-reference">reference</span>
											{:else if checkingHeaders}
												<span class="badge badge-checking">checking…</span>
											{:else}
												{@const err = extraFileErrors.find((e) => e.filename === file.name)}
												{#if err}
													<span class="badge badge-error" title={err.error}>✗ mismatch</span>
												{:else}
													<span class="badge badge-ok">✓ ok</span>
												{/if}
											{/if}
										</li>
									{/each}
								</ul>
								{#if extraFileErrors.length > 0}
									<div class="mismatch-warning">
										<p class="mismatch-warning-title">Header mismatches prevent concatenation:</p>
										{#each extraFileErrors as err}
											<p class="mismatch-detail">
												<strong>{err.filename}:</strong>
												{err.error}
											</p>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					{:else if !awaitingPreview && !awaitingLoad}
						<p>Choose file to preview data</p>
					{/if}
				</div>
			</div>
		{/if}
	{/snippet}

	{#snippet button()}
		<div class="dialog-button-container">
			{#if importReady && !awaitingPreview && !awaitingLoad && !checkingHeaders && extraFileErrors.length === 0}
				<button id="confirmImport" class="dialog-button" onclick={confirmImport}
					>Confirm Import</button
				>
			{/if}
		</div>
	{/snippet}
</Modal>

<style>
	/* ── Multi-file concatenation UI ─────────────────────────────────────────── */
	.multi-file-list {
		margin-top: 0.75em;
		padding: 0.5em 0.75em;
		border: 1px solid var(--color-border, #ccc);
		border-radius: 4px;
		background: var(--color-surface-alt, #f8f8f8);
	}
	.multi-file-title {
		font-weight: 600;
		margin: 0 0 0.4em 0;
		font-size: 0.9em;
	}
	.multi-file-list ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25em;
	}
	.file-item {
		display: flex;
		align-items: center;
		gap: 0.5em;
		font-size: 0.85em;
	}
	.file-item-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		flex-shrink: 0;
		padding: 0.1em 0.45em;
		border-radius: 3px;
		font-size: 0.8em;
		font-weight: 600;
	}
	.badge-reference {
		background: var(--color-neutral, #ddd);
		color: #555;
	}
	.badge-checking {
		background: #e8f0fe;
		color: #1a73e8;
	}
	.badge-ok {
		background: #e6f4ea;
		color: #137333;
	}
	.badge-error {
		background: #fce8e6;
		color: #c5221f;
		cursor: help;
	}
	.mismatch-warning {
		margin-top: 0.5em;
		padding: 0.4em 0.6em;
		border: 1px solid #f5c6cb;
		border-radius: 3px;
		background: #fce8e6;
		color: #c5221f;
		font-size: 0.82em;
	}
	.mismatch-warning-title {
		font-weight: 600;
		margin: 0 0 0.25em 0;
	}
	.mismatch-detail {
		margin: 0.2em 0 0 0;
		word-break: break-all;
	}
	/* ─────────────────────────────────────────────────────────────────────────── */

	.binning-panel {
		margin: 0.5em 0;
		padding: 0.5em 0.75em;
		border: 1px solid var(--color-warning, #e6a817);
		border-radius: 4px;
		background: var(--color-warning-bg, #fef9e7);
	}
	.binning-warning {
		font-weight: 600;
		margin: 0 0 0.25em 0;
	}
	.binning-estimate {
		opacity: 0.7;
		font-size: 0.9em;
	}
</style>
