<script module>
	// @ts-nocheck
	import Papa from 'papaparse';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import * as XLSX from '$lib/utils/xlsxLite';
	import dayjs from '$lib/utils/time/dayjsSetup.js';

	import {
		appConsts,
		core,
		pushObj,
		appState,
		createGroup,
		absorbColumnIntoGroup
	} from '$lib/core/core.svelte';
	import { Column, getColumnById } from '$lib/core/Column.svelte';
	import {
		guessDateofArray,
		forceFormat,
		getPeriod,
		normalizeTimeFormat
	} from '$lib/utils/time/TimeUtils';
	import { numToString } from '$lib/utils/GeneralUtils';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	import Modal from '$lib/components/reusables/Modal.svelte';
	import TableLayout from '$lib/components/plotbits/Table.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { importJson } from '$lib/components/iconActions/Setting.svelte';
	import { tick } from 'svelte';

	/** Yield to the browser so it can repaint (keeps spinner alive). */
	function yieldToUI() {
		return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
	}
	import { stackOrderInsideOut } from 'd3-shape';
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';

	const specialValues = ['NaN', 'NA', 'null'];

	let importReady = $state(false);
	let hasHeader = $state(true);
	let headers = $state([]);
	let delimiter = $state('');
	let targetFile = $state();
	let previewIN = $state(50);
	let previewDisplayStart = $state(1);
	let previewRowCount = $derived(parsedData ? parsedData[headers[0]]?.length || 0 : 0);
	let enspirePlateInfoRows = $derived(enspireMultiplatePayload?.plateInfoRows ?? 0);
	let enspireBinnedRows = $derived(enspireMultiplatePayload?.binnedRows ?? 0);
	let skipLines = $state(0);
	let sortBy = $state('__time__'); // sentinel: '__none__' | '__time__' | <column name>
	let error = $state({});
	let parsedData = $state(null);
	let errorInfile = $state(false);
	let specialRecognised = $state(false);
	let awaitingPreview = $state(false);
	let awaitingLoad = $state(false);
	let awdMeta = $state(null); // { startMs, stepMs, count } for AWD time compression
	let enspireMultiplatePayload = $state(null);
	let dataUrl = $state('');
	let isUrlMode = $state(false);

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

	// Date+Time column combination
	let dateTimePairs = $state([]); // [{ dateCol, timeCol, dateFormat, timeFormat }]
	let combinePairs = $state(new Set()); // indices into dateTimePairs that the user wants to merge

	function normalizeMeridiemText(value) {
		if (value == null) return value;
		if (typeof value !== 'string') return value;
		return value.replace(/(^|[^A-Za-z])([aApP])\.?m\.?([^A-Za-z]|$)/g, (_, pre, ap, post) => {
			const isUpper = ap === ap.toUpperCase();
			const meridiem = ap.toLowerCase() === 'a' ? (isUpper ? 'AM' : 'am') : isUpper ? 'PM' : 'pm';
			return `${pre}${meridiem}${post}`;
		});
	}

	function parseUTCStrict(value, fmt) {
		const text = normalizeMeridiemText(String(value ?? '').trim());
		if (!text) return null;
		const normalized = normalizeTimeFormat(fmt);
		if (normalized) {
			const strict = dayjs.utc(text, normalized, true);
			if (strict.isValid()) return strict;
		}
		const fallback = dayjs.utc(text);
		return fallback.isValid() ? fallback : null;
	}

	function classifyFormatKind(fmt) {
		if (!fmt || fmt === -1) return 'none';
		const normalized = normalizeTimeFormat(String(fmt));
		const tokenString = normalized.replace(/\[[^\]]*\]/g, '');
		const hasDateTokens = /Y|M|D|Q|Do|DDD|DDDD/.test(tokenString);
		const hasTimeTokens = /H|h|m|s|S|A|a|k/.test(tokenString);
		if (hasDateTokens && hasTimeTokens) return 'datetime';
		if (hasDateTokens) return 'date';
		if (hasTimeTokens) return 'time';
		return 'none';
	}

	/**
	 * Scan preview columns for date-only / time-only pairs that could be combined.
	 * A "date-only" format contains day/month/year tokens but no hour/minute.
	 * A "time-only" format contains hour/minute tokens but no day/month/year.
	 */
	function detectDateTimePairs() {
		dateTimePairs = [];
		combinePairs = new Set();
		if (!parsedData || headers.length < 2) return;

		const dateCols = [];
		const timeCols = [];

		for (const col of headers) {
			const sample = parsedData[col] ?? [];
			const nonEmpty = sample.filter((v) => String(v ?? '').trim() !== '').slice(0, 25);
			if (nonEmpty.length < 3) continue;

			const fmt = guessDateofArray(nonEmpty);
			if (fmt === -1 || !fmt || fmt.length === 0) continue;
			const fmtStr = String(fmt);
			const kind = classifyFormatKind(fmtStr);

			if (kind === 'date') {
				const valid = nonEmpty.filter((v) => parseUTCStrict(v, fmtStr)?.isValid()).length;
				if (valid >= Math.ceil(nonEmpty.length * 0.8)) {
					dateCols.push({ col, fmt: fmtStr });
				}
			} else if (kind === 'time') {
				const valid = nonEmpty.filter((v) => parseUTCStrict(v, fmtStr)?.isValid()).length;
				if (valid >= Math.ceil(nonEmpty.length * 0.8)) {
					timeCols.push({ col, fmt: fmtStr });
				}
			}
		}

		// Pair them up: for now, match in order (first date col with first time col, etc.)
		const pairCount = Math.min(dateCols.length, timeCols.length);
		for (let i = 0; i < pairCount; i++) {
			dateTimePairs.push({
				dateCol: dateCols[i].col,
				timeCol: timeCols[i].col,
				dateFormat: dateCols[i].fmt,
				timeFormat: timeCols[i].fmt
			});
			// Enable combination by default
			combinePairs.add(i);
		}
	}

	// Update a pair's date/time column choice. Re-guesses the format string so
	// downstream metadata stays in sync with the user's manual selection.
	function updatePair(idx, field, value) {
		if (idx < 0 || idx >= dateTimePairs.length) return;
		const pair = { ...dateTimePairs[idx], [field]: value };
		const fmtField = field === 'dateCol' ? 'dateFormat' : 'timeFormat';
		const sample = parsedData?.[value];
		if (sample && sample.length) {
			const fmt = guessDateofArray(sample);
			pair[fmtField] = fmt && fmt !== -1 ? String(fmt) : '';
		} else {
			pair[fmtField] = '';
		}
		dateTimePairs[idx] = pair;
	}

	// Append a fresh pair, picking sensible defaults from unused headers.
	function addPair() {
		const used = new Set();
		for (const p of dateTimePairs) {
			if (p.dateCol) used.add(p.dateCol);
			if (p.timeCol) used.add(p.timeCol);
		}
		const free = headers.filter((h) => !used.has(h));
		const dateCol = free[0] ?? headers[0] ?? '';
		const timeCol = free[1] ?? headers[1] ?? headers[0] ?? '';
		const newIdx = dateTimePairs.length;
		dateTimePairs = [...dateTimePairs, { dateCol, timeCol, dateFormat: '', timeFormat: '' }];
		// Re-guess formats based on actual sample data.
		updatePair(newIdx, 'dateCol', dateCol);
		updatePair(newIdx, 'timeCol', timeCol);
		// Enabled by default — adding a pair implies the user wants to merge it.
		combinePairs = new Set([...combinePairs, newIdx]);
	}

	// Remove a pair and shift any larger indices in the combine-set.
	function removePair(idx) {
		dateTimePairs = dateTimePairs.filter((_, i) => i !== idx);
		const next = new Set();
		for (const i of combinePairs) {
			if (i < idx) next.add(i);
			else if (i > idx) next.add(i - 1);
		}
		combinePairs = next;
	}

	/**
	 * Merge date+time column pairs in the given data object.
	 * Returns a new data object with combined columns replacing the originals.
	 */
	function applyDateTimeCombination(data) {
		if (combinePairs.size === 0) return data;

		const result = { ...data };
		for (const idx of combinePairs) {
			const pair = dateTimePairs[idx];
			if (!result[pair.dateCol] || !result[pair.timeCol]) continue;

			const combinedName = `${pair.dateCol} ${pair.timeCol}`;
			const combinedValues = result[pair.dateCol].map((d, i) => {
				const dateStr = String(d ?? '').trim();
				const timeStr = String(result[pair.timeCol]?.[i] ?? '').trim();
				if (!dateStr || !timeStr) return dateStr || timeStr || '';
				return `${dateStr} ${timeStr}`;
			});

			// Insert combined column at the position of the date column, remove both originals
			const newResult = {};
			for (const key of Object.keys(result)) {
				if (key === pair.dateCol) {
					newResult[combinedName] = combinedValues;
				} else if (key === pair.timeCol) {
					// skip - merged into combined
				} else {
					newResult[key] = result[key];
				}
			}
			// Update result for next iteration
			Object.keys(result).forEach((k) => delete result[k]);
			Object.assign(result, newResult);
		}
		return result;
	}

	// Replace existing columns mode
	let replaceMode = $state(false);
	let columnMappings = $state({}); // { importColName: existingColId | null }

	/**
	 * Build the list of existing columns for the replace dropdown.
	 * Labels prefer the owning Group's name when the column was absorbed; otherwise
	 * bare column name. Returns [{ label, id, name }].
	 */
	function getExistingColumnOptions() {
		const out = [];
		const colToGroupName = new Map();
		for (const g of core.groups ?? []) {
			for (const cid of g.sourceColumnIds ?? []) {
				colToGroupName.set(cid, g.name);
			}
		}
		for (const col of core.data ?? []) {
			const groupName = colToGroupName.get(col.id);
			out.push({
				label: groupName ? `${groupName} : ${col.name}` : col.name,
				id: col.id,
				name: col.name
			});
		}
		return out;
	}

	/**
	 * Get the effective column names for mapping, considering date+time combine.
	 * Returns an array of { name, isOriginal } where combined columns use the merged name.
	 */
	function getEffectiveImportColumns() {
		const combinedDateCols = new Set();
		const combinedTimeCols = new Set();
		for (const idx of combinePairs) {
			const pair = dateTimePairs[idx];
			combinedDateCols.add(pair.dateCol);
			combinedTimeCols.add(pair.timeCol);
		}

		const result = [];
		for (const col of headers) {
			if (!selectedColumns.has(col)) continue;
			if (combinedTimeCols.has(col)) continue; // skip; merged into date col
			if (combinedDateCols.has(col)) {
				// Find the pair and use combined name
				const pairIdx = [...combinePairs].find((i) => dateTimePairs[i].dateCol === col);
				if (pairIdx !== undefined) {
					const pair = dateTimePairs[pairIdx];
					result.push(`${pair.dateCol} ${pair.timeCol}`);
				} else {
					result.push(col);
				}
			} else {
				result.push(col);
			}
		}
		return result;
	}

	/**
	 * Auto-suggest mappings: match import column names to existing column names (case-insensitive).
	 */
	function autoSuggestMappings() {
		const existing = getExistingColumnOptions();
		const effectiveCols = getEffectiveImportColumns();
		const newMappings = {};
		for (const colName of effectiveCols) {
			const match = existing.find((e) => e.name.toLowerCase() === colName.toLowerCase());
			newMappings[colName] = match ? match.id : null;
		}
		columnMappings = newMappings;
	}

	// Derived sets for combined columns (used in preview table)
	let combinedTimeCols = $derived(new Set([...combinePairs].map((i) => dateTimePairs[i]?.timeCol)));
	let combinedDateCols = $derived(new Set([...combinePairs].map((i) => dateTimePairs[i]?.dateCol)));
	let existingColumnOptions = $derived(replaceMode ? getExistingColumnOptions() : []);

	// Multi-file concatenation support
	let targetFiles = $state([]); // All selected files
	let extraFileErrors = $state([]); // Fatal errors only (AWD mix, parse failure, no common cols)
	let checkingHeaders = $state(false); // True while validating additional file headers
	let commonColumns = $state([]); // Columns present in ALL files (intersection)
	let mismatchedColumns = $state([]); // [{ column, missingFrom: [filenames] }]

	function resetValues() {
		parsedData = null;
		importReady = false;
		hasHeader = true;
		delimiter = '';
		targetFile = null;
		targetFiles = [];
		previewIN = 50;
		previewDisplayStart = 1;
		skipLines = 0;
		sortBy = '__time__';
		errorInfile = false;
		error = {};
		specialRecognised = false;
		loadProgress = { stage: '', detail: '' };
		awdMeta = null;
		enspireMultiplatePayload = null;
		totalRowCount = 0;
		binningEnabled = false;
		binIntervalMin = 15;
		selectedColumns.clear();
		dateTimePairs = [];
		combinePairs = new Set();
		replaceMode = false;
		columnMappings = {};
		extraFileErrors = [];
		checkingHeaders = false;
		commonColumns = [];
		mismatchedColumns = [];
		dataUrl = '';
		isUrlMode = false;
	}

	function stripCsvValue(v) {
		return String(v ?? '')
			.trim()
			.replace(/^="?/, '')
			.replace(/"?$/, '');
	}

	function parseMaybeNumber(v) {
		const s = stripCsvValue(v);
		if (!s) return null;
		const n = Number(s);
		return Number.isFinite(n) ? n : null;
	}

	function parseEnspireDateTimeMs(v) {
		const s = normalizeMeridiemText(stripCsvValue(v));
		if (!s) return null;
		const formats = [
			'D/M/YYYY h:mm:ss A',
			'DD/MM/YYYY h:mm:ss A',
			'D/M/YYYY H:mm:ss',
			'DD/MM/YYYY H:mm:ss',
			'M/D/YYYY h:mm:ss A',
			'MM/DD/YYYY h:mm:ss A',
			'M/D/YYYY H:mm:ss',
			'YYYY-MM-DD H:mm:ss',
			'YYYY-MM-DD h:mm:ss A',
			'YYYY-MM-DDTHH:mm:ss'
		];
		for (const f of formats) {
			const dt = dayjs.utc(s, f, true);
			if (dt.isValid()) return dt.valueOf();
		}
		const fallback = dayjs.utc(s);
		return fallback.isValid() ? fallback.valueOf() : null;
	}

	function median(nums) {
		if (!nums || nums.length === 0) return null;
		const sorted = [...nums].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		if (sorted.length % 2 === 0) {
			return (sorted[mid - 1] + sorted[mid]) / 2;
		}
		return sorted[mid];
	}

	function parseEnspireMultiplateRows(rows) {
		const cell = (r, i) => String(r?.[i] ?? '').trim();
		const isBlankRow = (r) => !r || r.every((c) => String(c ?? '').trim() === '');

		// Find the plate info header row; locate "Measurement date" column dynamically
		const plateHeaderIdx = rows.findIndex(
			(r) =>
				cell(r, 0) === 'Plate' &&
				cell(r, 1) === 'Repeat' &&
				r.some((c) =>
					String(c ?? '')
						.toLowerCase()
						.includes('measurement date')
				)
		);
		if (plateHeaderIdx < 0) return null;

		const plateHeaderRow = rows[plateHeaderIdx];
		const measurementDateColIdx = plateHeaderRow.findIndex((c) =>
			String(c ?? '')
				.toLowerCase()
				.includes('measurement date')
		);

		// Temperature columns follow the date column
		const insideStartIdx = measurementDateColIdx + 1;
		const insideEndIdx = measurementDateColIdx + 2;
		const ambientStartIdx = measurementDateColIdx + 3;
		const ambientEndIdx = measurementDateColIdx + 4;

		const plateRows = [];
		for (let i = plateHeaderIdx + 1; i < rows.length; i++) {
			const r = rows[i];
			if (isBlankRow(r)) break;
			const plate = Number(cell(r, 0));
			const repeat = Number(cell(r, 1));
			if (!Number.isFinite(plate) || !Number.isFinite(repeat)) break;

			plateRows.push({
				plate,
				repeat,
				time: stripCsvValue(cell(r, measurementDateColIdx)),
				insideStart: parseMaybeNumber(cell(r, insideStartIdx)),
				insideEnd: parseMaybeNumber(cell(r, insideEndIdx)),
				ambientStart: parseMaybeNumber(cell(r, ambientStartIdx)),
				ambientEnd: parseMaybeNumber(cell(r, ambientEndIdx))
			});
		}
		if (plateRows.length === 0) return null;

		const wellHeaderIndices = [];
		for (let i = 0; i < rows.length; i++) {
			if (cell(rows[i], 0) === 'Well' && cell(rows[i], 1) === 'Repeat') {
				wellHeaderIndices.push(i);
			}
		}
		if (wellHeaderIndices.length === 0) return null;

		const firstWellHeader = rows[wellHeaderIndices[0]];
		const repeatLabels = firstWellHeader
			.slice(2)
			.map((x) => Number(String(x ?? '').trim()))
			.filter((x) => Number.isFinite(x));
		if (repeatLabels.length === 0) return null;

		const plateSet = new Set(plateRows.map((r) => r.plate));
		const plateOrder = [...plateSet].sort((a, b) => a - b);

		// Auto-detect the date/time format from the plate info time strings
		const timeStrings = plateRows.map((r) => r.time).filter((s) => s && s.length > 0);
		const detectedTimeFmt = timeStrings.length > 0 ? guessDateofArray(timeStrings) : null;

		/** Parse a single time string → ms. Uses detected format first, then hardcoded fallbacks. */
		function parsePlateTimeMs(v) {
			const s = normalizeMeridiemText(stripCsvValue(v));

			if (!s) return null;
			if (detectedTimeFmt && detectedTimeFmt !== -1 && detectedTimeFmt.length > 0) {
				const normalized = normalizeTimeFormat(detectedTimeFmt);
				if (normalized) {
					const dt = dayjs.utc(s, normalized, true);
					if (dt.isValid()) return dt.valueOf();
				}
				// Non-strict attempt with detected format
				const dt2 = dayjs.utc(s, normalizeTimeFormat(detectedTimeFmt));
				if (dt2.isValid()) return dt2.valueOf();
			}
			// Fall through to parseEnspireDateTimeMs hardcoded formats
			return parseEnspireDateTimeMs(v);
		}

		const repeatWindows = new Map();
		for (const r of plateRows) {
			const ms = parsePlateTimeMs(r.time);
			if (!Number.isFinite(ms)) continue;
			const existing = repeatWindows.get(r.repeat);
			if (!existing) {
				repeatWindows.set(r.repeat, { min: ms, max: ms });
			} else {
				existing.min = Math.min(existing.min, ms);
				existing.max = Math.max(existing.max, ms);
			}
		}

		const timeStartsMs = [];
		const widths = [];
		for (const rep of repeatLabels) {
			const w = repeatWindows.get(rep);
			if (!w) {
				timeStartsMs.push(null);
				continue;
			}
			timeStartsMs.push(w.min);
			if (Number.isFinite(w.min) && Number.isFinite(w.max) && w.max > w.min) {
				widths.push(w.max - w.min);
			}
		}
		const timeBinWidthMs = median(widths) ?? 60 * 60 * 1000;
		const validStarts = timeStartsMs.filter((x) => Number.isFinite(x));
		const timeOriginMs = validStarts.length > 0 ? Math.min(...validStarts) : null;
		const timeStartsHours = timeStartsMs.map((x) =>
			Number.isFinite(x) && Number.isFinite(timeOriginMs) ? (x - timeOriginMs) / 3600000 : null
		);

		const wellValueColumns = {};
		for (let chunkIdx = 0; chunkIdx < wellHeaderIndices.length; chunkIdx++) {
			const start = wellHeaderIndices[chunkIdx] + 1;
			const end =
				chunkIdx < wellHeaderIndices.length - 1 ? wellHeaderIndices[chunkIdx + 1] : rows.length;
			const plateId = plateOrder[chunkIdx] ?? chunkIdx + 1;

			for (let i = start; i < end; i++) {
				const r = rows[i];
				if (isBlankRow(r)) continue;
				const well = cell(r, 0).toUpperCase();
				const metric = cell(r, 1);
				if (!/^[A-H]\d{2}$/.test(well)) continue;
				if (!/result/i.test(metric)) continue;

				const colName = `P${plateId}_${well}`;
				const values = new Array(repeatLabels.length).fill(null);
				for (let j = 0; j < repeatLabels.length; j++) {
					values[j] = parseMaybeNumber(r[j + 2]);
				}
				wellValueColumns[colName] = values;
			}
		}

		if (Object.keys(wellValueColumns).length === 0) return null;

		const plateInfoData = {
			Plate: plateRows.map((r) => r.plate),
			Repeat: plateRows.map((r) => r.repeat),
			Time: plateRows.map((r) => r.time),
			InsideTempStart: plateRows.map((r) => r.insideStart),
			InsideTempEnd: plateRows.map((r) => r.insideEnd),
			AmbientTempStart: plateRows.map((r) => r.ambientStart),
			AmbientTempEnd: plateRows.map((r) => r.ambientEnd)
		};

		const binnedWideData = {
			Time: timeStartsHours,
			...wellValueColumns
		};

		return {
			plateInfoData,
			binnedWideData,
			detectedTimeFmt,
			timeOriginMs,
			timeBinWidthMs,
			timeBinWidthHours: timeBinWidthMs / 3600000,
			repeatsCount: repeatLabels.length,
			wellsCount: Object.keys(wellValueColumns).length,
			plateInfoRows: plateRows.length,
			binnedRows: repeatLabels.length
		};
	}

	async function tryParseEnspireMultiplate(file) {
		if (!file || !file.name.toLowerCase().match(/\.(csv|txt)$/)) return null;

		const text = await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => resolve(String(e.target.result ?? ''));
			reader.onerror = () => reject(reader.error);
			reader.readAsText(file);
		});

		if (!text.includes('Plate information') || !text.includes('Well,Repeat')) {
			return null;
		}

		const parsed = Papa.parse(text, {
			delimiter: ',',
			skipEmptyLines: false,
			dynamicTyping: false
		});
		if (!parsed?.data?.length) return null;

		return parseEnspireMultiplateRows(parsed.data);
	}

	async function importColumnObjectAsTable(dataObj, tableName, schema = {}) {
		const keys = Object.keys(dataObj);
		if (keys.length === 0) return;

		const groupId = createGroup({ name: tableName });

		for (const key of keys) {
			const col = new Column({});
			col.name = key;
			const values = dataObj[key] ?? [];
			const spec = schema[key] ?? null;

			if (spec?.type === 'time') {
				col.type = 'time';
				col.timeFormat = spec.timeFormat ?? 'D/M/YYYY h:mm:ss A';
			} else if (spec?.type === 'bin') {
				col.type = 'bin';
				col.binWidth = spec.binWidth ?? 1;
				if (spec.binStep != null) col.binStep = spec.binStep;
				if (spec.originTime_ms != null) col.originTime_ms = spec.originTime_ms;
			} else if (spec?.type === 'number') {
				col.type = 'number';
			} else {
				const guessedFormat = guessDateofArray(values);
				if (guessedFormat !== -1 && guessedFormat.length > 0) {
					col.type = 'time';
					col.timeFormat = guessedFormat;
				} else {
					const datum = getFirstValid(values);
					col.type = typeof datum === 'number' && !isNaN(datum) ? 'number' : 'category';
				}
			}

			core.rawData.set(col.id, values);
			col.data = col.id;
			pushObj(col);
			absorbColumnIntoGroup(col.id, groupId);
		}
	}

	async function importEnspireMultiplatePayload(payload) {
		const baseName = targetFile?.name?.replace(/\.[^.]+$/, '') ?? 'multiplate-import';

		loadProgress = { stage: 'Loading data', detail: 'Building plate info table…' };
		await tick();
		await yieldToUI();
		const plateTimeFormat =
			payload.detectedTimeFmt &&
			payload.detectedTimeFmt !== -1 &&
			payload.detectedTimeFmt.length > 0
				? payload.detectedTimeFmt
				: 'DD/MM/YYYY h:mm:ss A';
		await importColumnObjectAsTable(payload.plateInfoData, `${baseName} - plate info`, {
			Plate: { type: 'number' },
			Repeat: { type: 'number' },
			Time: { type: 'time', timeFormat: plateTimeFormat },
			InsideTempStart: { type: 'number' },
			InsideTempEnd: { type: 'number' },
			AmbientTempStart: { type: 'number' },
			AmbientTempEnd: { type: 'number' }
		});

		loadProgress = { stage: 'Loading data', detail: 'Building binned well table…' };
		await tick();
		await yieldToUI();
		const wellSchema = {
			Time: {
				type: 'bin',
				binWidth: payload.timeBinWidthHours,
				binStep: payload.timeBinWidthHours,
				originTime_ms: payload.timeOriginMs
			}
		};
		for (const key of Object.keys(payload.binnedWideData)) {
			if (key !== 'Time') wellSchema[key] = { type: 'number' };
		}
		await importColumnObjectAsTable(
			payload.binnedWideData,
			`${baseName} - binned wells`,
			wellSchema
		);
	}

	export async function openImportModal() {
		resetValues();
		showImportModal = true;
		await tick();
		fileInput?.click();
	}

	export async function openImportModalWithUrl(url) {
		resetValues();
		dataUrl = url;
		showImportModal = true;
		await tick();
		await doPreviewFromURL();
	}

	// Open the import modal pre-seeded with already-chosen File objects (e.g.
	// dropped onto the canvas), going straight to the preview without the OS file
	// picker.
	export async function openImportModalWithFiles(fileList) {
		resetValues();
		showImportModal = true;
		await tick();
		const files = [...(fileList ?? [])];
		targetFiles = files;
		targetFile = files[0] ?? null;
		if (targetFile) {
			await doPreview();
		}
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
		previewDisplayStart = 1;
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

		if (enspireMultiplatePayload) {
			totalRowCount = parsedData ? (parsedData[headers[0]]?.length ?? 0) : 0;
			binningEnabled = false;
			dateTimePairs = [];
			combinePairs = new Set();
			if (targetFiles.length > 1) {
				extraFileErrors = [
					{
						filename: 'all files',
						error:
							'Multi-file concatenation is not supported for this EnSpire multi-plate format. Select one file at a time.'
					}
				];
			}
		} else {
			// Count total rows to decide whether to suggest binning
			await countRows();
			if (totalRowCount > ROW_THRESHOLD) {
				binningEnabled = true;
			}

			// Detect date-only + time-only column pairs
			detectDateTimePairs();
		}

		loadProgress = { stage: '', detail: '' };
		awaitingPreview = false;

		// Re-validate additional file headers whenever preview settings change
		if (targetFiles.length > 1 && !enspireMultiplatePayload) {
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

	async function doPreviewFromURL() {
		if (!dataUrl.trim()) return;
		// Reset relevant state without touching dataUrl
		parsedData = null;
		importReady = false;
		targetFile = null;
		targetFiles = [];
		isUrlMode = true;
		errorInfile = false;
		error = {};
		specialRecognised = false;
		selectedColumns.clear();

		awaitingPreview = true;
		previewDisplayStart = 1;
		loadProgress = { stage: 'Fetching', detail: dataUrl };
		await tick();
		await new Promise((r) => setTimeout(r, appConsts.timeoutRefresh_ms));

		await new Promise((resolve) => {
			Papa.parse(dataUrl.trim(), {
				download: true,
				preview: previewIN,
				header: hasHeader,
				dynamicTyping: true,
				skipEmptyLines: 'greedy',
				skipFirstNLines: skipLines,
				delimiter: delimiter,
				complete: (results) => {
					if (results.errors.length > 0) errorInfile = true;
					dealWithData(results.meta.fields, results.data);
					resolve();
				},
				error: (err) => {
					error = { err, reason: 'Failed to fetch URL' };
					errorInfile = true;
					addNotification(`Failed to fetch data from URL.\n\n${err.message ?? err}`);
					resolve();
				}
			});
		});

		if (headers.length > 0 && selectedColumns.size === 0) {
			headers.forEach((col) => selectedColumns.add(col));
		}
		totalRowCount = parsedData ? (parsedData[headers[0]]?.length ?? 0) : 0;

		// Detect date-only + time-only column pairs
		detectDateTimePairs();

		loadProgress = { stage: '', detail: '' };
		awaitingPreview = false;
		if (!errorInfile) importReady = true;
	}

	async function loadDataFromURL() {
		await new Promise((resolve, reject) => {
			Papa.parse(dataUrl.trim(), {
				download: true,
				header: hasHeader,
				dynamicTyping: true,
				skipEmptyLines: 'greedy',
				skipFirstNLines: skipLines,
				delimiter: delimiter,
				complete: async (results) => {
					const allData = convertArrayToObject(results.data);
					let filteredData =
						selectedColumns.size < headers.length
							? Object.fromEntries(
									[...selectedColumns].filter((c) => allData[c]).map((c) => [c, allData[c]])
								)
							: allData;
					// Combine date+time column pairs if requested
					if (combinePairs.size > 0) {
						filteredData = applyDateTimeCombination(filteredData);
					}
					filteredData = sortDataByTimestamp(filteredData);
					const urlName = dataUrl.split('/').pop() || 'url-data';
					await doBasicFileImport(filteredData, urlName);
					resolve();
				},
				error: (err) => {
					error = { err, reason: 'Failed to fetch data from URL' };
					errorInfile = true;
					reject(err);
				}
			});
		});
	}

	function reParse() {
		if (isUrlMode) doPreviewFromURL();
		else doPreview();
	}

	async function confirmImport() {
		awaitingLoad = true;
		loadProgress = {
			stage: 'Loading data',
			detail: isUrlMode ? 'Fetching full data…' : 'Reading full file…'
		};
		await tick();
		await new Promise((resolve) => setTimeout(resolve, appConsts.timeoutRefresh_ms));
		if (isUrlMode) {
			await loadDataFromURL();
		} else {
			await loadData();
		}
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
		enspireMultiplatePayload = null;

		const isExcel = targetFile.name.toLowerCase().match(/\.(xlsx|xls)$/);

		if (isExcel) {
			return await parseXLSX(targetFile);
		}

		const enspirePayload = await tryParseEnspireMultiplate(targetFile);
		if (enspirePayload) {
			specialRecognised = 'enspire-multiplate';
			hasHeader = true;
			skipLines = 0;
			delimiter = ',';
			enspireMultiplatePayload = enspirePayload;
			headers = Object.keys(enspirePayload.plateInfoData);
			parsedData = enspirePayload.plateInfoData;
			return;
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
								// Limit preview rows (like CSV)
								if (awaitingPreview && results.data.length > previewIN) {
									results.data = results.data.slice(0, previewIN);
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

	/**
	 * Compute the column intersection across the reference (first) file and all
	 * additional files. Mismatched columns are reported as a soft warning so
	 * the intersection can still be imported. Fatal conditions (AWD mix, parse
	 * failure, no common columns) are recorded in extraFileErrors to block import.
	 */
	async function checkAdditionalHeaders(additionalFiles) {
		checkingHeaders = true;
		extraFileErrors = [];
		mismatchedColumns = [];
		commonColumns = [];

		if (targetFile?.name.toLowerCase().endsWith('.awd')) {
			extraFileErrors = additionalFiles.map((f) => ({
				filename: f.name,
				error: 'Multi-file concatenation is not supported for AWD files.'
			}));
			checkingHeaders = false;
			return;
		}

		const refHeaders = [...headers];
		const fileHeadersMap = new Map();
		fileHeadersMap.set(targetFile.name, refHeaders);

		for (const file of additionalFiles) {
			try {
				const fileHdrs = await getFileHeaders(file);
				fileHeadersMap.set(file.name, fileHdrs);
			} catch (err) {
				extraFileErrors = [
					...extraFileErrors,
					{ filename: file.name, error: err.message ?? String(err) }
				];
			}
		}

		const parsedHeaderLists = [...fileHeadersMap.values()];
		commonColumns = refHeaders.filter((h) => parsedHeaderLists.every((hdrs) => hdrs.includes(h)));
		const commonSet = new Set(commonColumns);

		const unionSet = new Set();
		for (const hdrs of parsedHeaderLists) hdrs.forEach((h) => unionSet.add(h));
		const mismatched = [];
		for (const col of unionSet) {
			if (commonSet.has(col)) continue;
			const missingFrom = [];
			for (const [fname, hdrs] of fileHeadersMap) {
				if (!hdrs.includes(col)) missingFrom.push(fname);
			}
			mismatched.push({ column: col, missingFrom });
		}
		mismatchedColumns = mismatched;

		if (commonColumns.length === 0 && extraFileErrors.length === 0) {
			extraFileErrors = [
				{
					filename: 'all files',
					error: 'No columns are common across all selected files.'
				}
			];
		}

		// Restrict selection and date+time pairs to the common columns so the
		// preview and import stay coherent.
		if (commonColumns.length > 0) {
			selectedColumns = new Set([...selectedColumns].filter((c) => commonSet.has(c)));

			const newPairs = [];
			const newCombine = new Set();
			dateTimePairs.forEach((pair, oldIdx) => {
				if (commonSet.has(pair.dateCol) && commonSet.has(pair.timeCol)) {
					const newIdx = newPairs.length;
					newPairs.push(pair);
					if (combinePairs.has(oldIdx)) newCombine.add(newIdx);
				}
			});
			dateTimePairs = newPairs;
			combinePairs = newCombine;
		}

		checkingHeaders = false;
	}

	/**
	 * Convert Papa results.data into a column-oriented object keyed by each
	 * file's OWN headers. Works for hasHeader=true (rows are objects) and
	 * hasHeader=false (rows are arrays — mapped positionally to numToString keys
	 * to match the reference file's auto-generated headers).
	 */
	function rowsToOwnColumnObject(rows) {
		const result = {};
		if (!rows || rows.length === 0) return result;

		if (hasHeader) {
			const keys = Object.keys(rows[0]);
			for (const k of keys) result[k] = [];
			for (const row of rows) {
				for (const k of keys) result[k].push(row[k]);
			}
		} else {
			const colCount = rows[0].length;
			const keys = Array.from({ length: colCount }, (_, i) => numToString(i));
			for (const k of keys) result[k] = [];
			for (const row of rows) {
				for (let i = 0; i < colCount; i++) {
					result[keys[i]].push(row[i]);
				}
			}
		}
		return result;
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
							complete: (results) => resolve(rowsToOwnColumnObject(results.data)),
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
				complete: (results) => resolve(rowsToOwnColumnObject(results.data)),
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
		if (enspireMultiplatePayload) {
			await importEnspireMultiplatePayload(enspireMultiplatePayload);
			awaitingLoad = false;
			return;
		}

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
		// Must happen BEFORE applyDateTimeCombination so that the raw date/time
		// columns (which are in selectedColumns) can be matched in extraData.
		// After combination the combined key (e.g. "Date Time") would not be
		// present in selectedColumns, causing the time column to remain at file-1
		// length and sortDataByTimestamp to truncate all other columns to match.
		if (targetFiles.length > 1) {
			// Only columns present in every file are safe to concatenate. Drop
			// anything outside that set from parsedData so row counts stay aligned.
			const commonSet = new Set(commonColumns);
			for (const col of Object.keys(parsedData)) {
				if (!commonSet.has(col)) delete parsedData[col];
			}
			selectedColumns = new Set([...selectedColumns].filter((c) => commonSet.has(c)));

			for (let i = 1; i < targetFiles.length; i++) {
				const extraFile = targetFiles[i];
				loadProgress = {
					stage: 'Loading data',
					detail: `Concatenating file ${i + 1} of ${targetFiles.length}: ${extraFile.name}`
				};
				await tick();
				await yieldToUI();

				const extraData = await parseAdditionalFileData(extraFile);

				for (const col of selectedColumns) {
					if (parsedData[col] && extraData[col]) {
						parsedData[col] = [...parsedData[col], ...extraData[col]];
					}
				}
			}
		}

		// Combine date+time column pairs if requested (after concat so the full
		// date and time arrays from all files are combined together)
		if (combinePairs.size > 0) {
			parsedData = applyDateTimeCombination(parsedData);
		}

		if (sortBy !== '__none__') {
			const sortLabel = sortBy === '__time__' ? 'timestamp' : sortBy;
			loadProgress = { stage: 'Loading data', detail: `Sorting by ${sortLabel}…` };
			await tick();
			parsedData =
				sortBy === '__time__'
					? sortDataByTimestamp(parsedData)
					: sortDataByColumn(parsedData, sortBy);
		}

		loadProgress = { stage: 'Loading data', detail: 'Building columns…' };
		await tick();
		await yieldToUI();

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
			addNotification(`Failed to load session from URL.\n\n${msg}`);
			console.error('loadFromURL error:', error);
		}
	}

	/**
	 * Sort all columns in a column-oriented data object by the first time column found.
	 * Rows are kept together across all columns.
	 */
	function sortDataByTimestamp(data) {
		const cols = Object.keys(data);
		if (cols.length === 0) return data;

		// Find the first column that looks like timestamps
		let timeCol = null;
		let timeFmt = null;
		for (const col of cols) {
			const fmt = guessDateofArray(data[col]);
			if (fmt !== -1 && fmt !== null && fmt !== undefined && fmt !== '' && fmt.length > 0) {
				timeCol = col;
				timeFmt = fmt;
				break;
			}
		}

		if (!timeCol) return data; // No time column found — leave unsorted

		const timeValues = data[timeCol];
		const n = timeValues.length;

		// Build array of [index, parsedMs] and sort by ms
		const indices = Array.from({ length: n }, (_, i) => {
			const parsed = parseUTCStrict(timeValues[i], timeFmt);
			const ms = parsed ? parsed.valueOf() : NaN;
			return { i, ms };
		});
		indices.sort((a, b) => a.ms - b.ms);

		// Reorder every column using the sorted indices
		const sorted = {};
		for (const col of cols) {
			sorted[col] = indices.map(({ i }) => data[col][i]);
		}
		return sorted;
	}

	/**
	 * Sort all columns by the given column name. Time-formatted columns parse via
	 * guessDateofArray + parseUTCStrict; numeric columns sort numerically; otherwise
	 * lexicographically. Missing values (null / undefined / NaN / unparseable) go LAST.
	 */
	function sortDataByColumn(data, sortColName) {
		if (!sortColName) return data;
		const cols = Object.keys(data);
		if (!cols.includes(sortColName)) return data;
		const values = data[sortColName];
		const n = values.length;

		const fmt = guessDateofArray(values);
		const isTime = fmt !== -1 && fmt !== null && fmt !== undefined && fmt !== '' && fmt.length > 0;

		const indices = Array.from({ length: n }, (_, i) => {
			const raw = values[i];
			if (raw == null) return { i, key: Infinity, missing: true };
			if (isTime) {
				const parsed = parseUTCStrict(raw, fmt);
				const ms = parsed ? parsed.valueOf() : NaN;
				return { i, key: isNaN(ms) ? Infinity : ms, missing: isNaN(ms) };
			}
			const num = Number(raw);
			if (!isNaN(num)) return { i, key: num, missing: false };
			return { i, key: String(raw), missing: false };
		});
		indices.sort((a, b) => {
			if (a.missing && !b.missing) return 1;
			if (!a.missing && b.missing) return -1;
			if (typeof a.key === 'string' || typeof b.key === 'string') {
				return String(a.key).localeCompare(String(b.key));
			}
			return a.key - b.key;
		});
		const sorted = {};
		for (const col of cols) sorted[col] = indices.map(({ i }) => data[col][i]);
		return sorted;
	}

	async function doBasicFileImport(result, fname) {
		const keys = Object.keys(result);
		const totalColumns = keys.length;

		// Separate columns into "replace existing" and "import as new"
		const replaceEntries = []; // [{ colName, targetId }]
		const newEntries = []; // [colName]
		for (const f of keys) {
			const targetId = replaceMode ? columnMappings[f] : null;
			if (targetId != null) {
				replaceEntries.push({ colName: f, targetId });
			} else {
				newEntries.push(f);
			}
		}

		// Handle replacements: overwrite existing column data
		for (let i = 0; i < replaceEntries.length; i++) {
			const { colName, targetId } = replaceEntries[i];

			loadProgress = {
				stage: 'Loading data',
				detail: `Replacing column ${i + 1} of ${replaceEntries.length}: "${colName}"`
			};
			if (i % 5 === 0) {
				await tick();
				await yieldToUI();
			}

			const existingCol = getColumnById(targetId);
			if (!existingCol) continue;

			// Update data
			core.rawData.set(targetId, result[colName]);
			existingCol.data = targetId;

			// Update type/format
			const guessedFormat = guessDateofArray(result[colName]);
			if (guessedFormat !== -1 && guessedFormat.length > 0) {
				existingCol.type = 'time';
				existingCol.timeFormat = guessedFormat;
			} else {
				const datum = getFirstValid(result[colName], 5);
				if (typeof datum === 'number' && !isNaN(datum)) {
					existingCol.type = 'number';
				} else {
					existingCol.type = 'category';
				}
			}

			// Trigger reactivity by bumping rawDataVersion (tableProcessGUId must stay '' for raw columns)
			existingCol.rawDataVersion++;
		}

		// Handle new columns: create a Group node + free-standing columns.
		let newGroupId = null;
		if (newEntries.length > 0) {
			const baseName = fname ? fname.replace(/\.[^.]+$/, '') : 'imported';
			newGroupId = createGroup({ name: baseName });

			for (let i = 0; i < newEntries.length; i++) {
				const f = newEntries[i];

				loadProgress = {
					stage: 'Loading data',
					detail: `Processing column ${i + 1} of ${newEntries.length}: "${f}"`
				};
				if (i % 5 === 0) {
					await tick();
					await yieldToUI();
				}

				const df = new Column({});

				if (awdMeta && f === 'DateTime') {
					df.type = 'time';
					df.compression = 'awd';
					df.name = 'DateTime';
					core.rawData.set(df.id, {
						start: awdMeta.startMs,
						step: awdMeta.stepMs,
						length: awdMeta.count
					});
					df.data = df.id;
				} else {
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

				pushObj(df);
				if (newGroupId != null) absorbColumnIntoGroup(df.id, newGroupId);
			}

			loadProgress = { stage: 'Loading data', detail: 'Finalising…' };
			await tick();
		} else {
			loadProgress = { stage: 'Loading data', detail: 'Finalising…' };
			await tick();
		}

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

		// Parse start date — try full year first, then 2-digit. AWD files emit
		// dates like "12-Mar-2024" or "12-Mar-24", always English month names.
		let startDate = dayjs(dateStr, 'DD-MMM-YYYY', 'en', true);
		if (!startDate.isValid()) {
			startDate = dayjs(dateStr, 'DD-MMM-YY', 'en', true);
		}
		if (!startDate.isValid()) {
			console.warn('Invalid AWD start date:', dateStr);
			startDate = dayjs().startOf('day');
		}

		// Add start time
		let startDT = startDate;
		const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
		if (timeMatch) {
			startDT = startDate
				.hour(Number(timeMatch[1]))
				.minute(Number(timeMatch[2]))
				.second(0)
				.millisecond(0);
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
			startMs: startDT.valueOf(),
			stepMs: epochSeconds * 1000,
			count: dataRows.length
		};

		// Build preview/full rows
		const output = dataRows.map((row, i) => {
			const obj = {};

			// Always generate proper ISO-like datetime for DateTime column (needed for type guessing)
			const dt = startDT.add(i * epochSeconds, 'second');
			obj.DateTime = dt.format('YYYY-MM-DD HH:mm:ss');

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
			firstDt = dayjs(awdMeta.startMs);
			timeHours = new Array(rowCount);
			for (let i = 0; i < rowCount; i++) {
				timeHours[i] = i * stepHours;
			}
		} else {
			// General case: parse time strings. Try the guessed format first
			// (strict), then fall back to dayjs's permissive ISO parser which
			// also covers SQL-ish "YYYY-MM-DD HH:mm:ss".
			const timeStrings = data[timeKey];

			function parseDt(s) {
				return parseUTCStrict(s, timeFormat);
			}

			firstDt = parseDt(timeStrings[0]);
			if (!firstDt) {
				console.warn('Binning: could not parse first time value, skipping');
				return data;
			}

			timeHours = timeStrings.map((t) => {
				const dt = parseDt(t);
				return dt ? dt.diff(firstDt, 'hour', true) : NaN;
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
				message={isUrlMode
					? `Fetching data from URL…`
					: targetFiles.length > 1
						? `Previewing ${targetFiles.length} files.`
						: `Importing data from ${targetFile?.name ?? 'file'}.`}
				detail={loadProgress.detail}
			/>
		{:else if awaitingLoad}
			<LoadingSpinner
				message={isUrlMode
					? `Loading data from URL…`
					: targetFiles.length > 1
						? `Importing ${targetFiles.length} files.`
						: `Loading data from ${targetFile?.name ?? 'file'}.`}
				detail={loadProgress.detail}
			/>
		{:else}
			<div class="heading">
				<h2>Import Data</h2>
				<div class="control-input-horizontal" style="align-items: center; margin-top: var(--space-4);">
					<button class="dialog-button" style="margin-top:0;" onclick={(e) => fileInput.click()}
						>{buttonText}</button
					>
					<p class="filename-preview">
						{#if targetFiles.length > 1}
							{targetFiles.length} files selected
						{:else if targetFile}
							{targetFile.name}
						{:else}
							No file selected
						{/if}
					</p>
				</div>
				<!-- <div class="url-input-container">
					<input
						class="url-input"
						type="text"
						bind:value={dataUrl}
						placeholder="…or enter a URL to a CSV/text file"
						onkeydown={(e) => {
							if (e.key === 'Enter') doPreviewFromURL();
						}}
					/>
					<button
						class="choose-file-button"
						onclick={doPreviewFromURL}
						disabled={!dataUrl.trim() || awaitingPreview}
					>
						Load from URL
					</button>
				</div> -->
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
						{#if enspireMultiplatePayload}
							<div class="section-row enspire-summary-panel">
								<p class="enspire-summary-title">EnSpire multi-plate format detected</p>
								<p class="enspire-summary-detail">
									This import will create two tables. No preview is shown for this format.
								</p>
								<p class="enspire-summary-detail">
									Plate info table rows: <strong>{enspirePlateInfoRows.toLocaleString()}</strong>
								</p>
								<p class="enspire-summary-detail">
									Binned wells table rows: <strong>{enspireBinnedRows.toLocaleString()}</strong>
								</p>
								<p class="enspire-summary-detail">
									Time axis will be imported as time bins with per-repeat windows.
								</p>
								<p class="enspire-summary-proceed">Proceed with import?</p>
							</div>
						{:else}
							<div class="section-row">
								<div class="control-input-horizontal">
									<div class="control-input-checkbox">
										<input type="checkbox" bind:checked={hasHeader} onchange={() => reParse()} />
										<p>Has header row</p>
									</div>
									<div class="control-input">
										<p>Delimiter</p>
										<select bind:value={delimiter} onchange={() => reParse()}>
											<option value="">auto</option>
											<option value=",">, (comma)</option>
											<option value=";">; (semicolon)</option>
											<option value="\t">Tab</option>
											<option value="|">| (pipe)</option>
											<option value=" ">(space)</option>
										</select>
									</div>
									<div class="control-input">
										<p>Skip lines</p>
										<NumberWithUnits bind:value={skipLines} min="0" onInput={() => reParse()} />
									</div>
									<div class="control-input">
										<p>Sort by</p>
										<select bind:value={sortBy} disabled={awaitingLoad}>
											<option value="__none__">None (keep file order)</option>
											<option value="__time__">Time (auto-detect)</option>
											{#each headers as h}
												<option value={h}>{h}</option>
											{/each}
										</select>
									</div>
								</div>
							</div>

							{#if totalRowCount > ROW_THRESHOLD}
								<div class="section-row binning-panel">
									<p class="binning-warning">
										This file has ~{totalRowCount.toLocaleString()} rows. Consider binning to reduce data
										size.
									</p>
									<div class="control-input-horizontal">
										<div class="control-input-checkbox">
											<input type="checkbox" bind:checked={binningEnabled} />
											<p>Bin data to</p>
										</div>
										<div class="control-input">
											<p>Interval (mins)</p>
											<NumberWithUnits bind:value={binIntervalMin} min={1} step={1} />
										</div>
									</div>
									{#if binningEnabled}
										<p class="binning-estimate">
											~{estimatedBinnedRows.toLocaleString()} rows after binning, {dataIntervalMin} min
											intervals detected
										</p>
									{/if}
								</div>
							{/if}

							<div class="section-row combine-panel">
								<p class="combine-title">
									Combine separate Date and Time columns into a single DateTime column:
								</p>
								{#if dateTimePairs.length === 0}
									<p class="combine-empty">
										No date/time pairs detected. Click "Add pair" to choose two columns to merge.
									</p>
								{/if}
								{#each dateTimePairs as pair, idx (idx)}
									<div class="combine-row">
										<input
											type="checkbox"
											title="Merge this pair on import"
											checked={combinePairs.has(idx)}
											onchange={(e) => {
												const checked = e.currentTarget.checked;
												combinePairs = checked
													? new Set([...combinePairs, idx])
													: new Set([...combinePairs].filter((i) => i !== idx));
											}}
										/>
										<select
											class="combine-select"
											value={pair.dateCol}
											onchange={(e) => updatePair(idx, 'dateCol', e.currentTarget.value)}
										>
											{#each headers as h (h)}
												<option value={h}>{h}</option>
											{/each}
										</select>
										<span class="combine-plus">+</span>
										<select
											class="combine-select"
											value={pair.timeCol}
											onchange={(e) => updatePair(idx, 'timeCol', e.currentTarget.value)}
										>
											{#each headers as h (h)}
												<option value={h}>{h}</option>
											{/each}
										</select>
										<button
											type="button"
											class="combine-remove"
											title="Remove this pair"
											onclick={() => removePair(idx)}
										>
											×
										</button>
									</div>
								{/each}
								{#if headers.length >= 2}
									<button type="button" class="combine-add" onclick={addPair}> + Add pair </button>
								{/if}
							</div>

							{#if (core.data ?? []).length > 0}
								<div class="section-row">
									<div class="control-input-checkbox">
										<input
											type="checkbox"
											bind:checked={replaceMode}
											onchange={() => {
												if (replaceMode) autoSuggestMappings();
												else columnMappings = {};
											}}
										/>
										<p>Replace existing columns</p>
									</div>
								</div>
							{/if}

							<div class="section-row">
								<div class="col-select-actions">
									<button
										class="dialog-button"
										style="margin-top:0;"
										onclick={() => {
											selectedColumns = new Set(headers);
										}}>All</button
									>
									<button
										class="dialog-button"
										style="margin-top:0;"
										onclick={() => {
											selectedColumns = new Set();
										}}>None</button
									>
								</div>
							</div>

							<div class="preview-table-wrapper" style="overflow-x: auto; max-width: 100%;">
								<table class="preview-table">
									<thead>
										<tr>
											{#each headers as col, i (`${i}-${selectedColumns.has(col)}-${combinedTimeCols.has(col)}`)}
												{#if combinedTimeCols.has(col)}
													<!-- skip: merged into date col -->
												{:else}
													{@const isCombinedDate = combinedDateCols.has(col)}
													{@const combinedName = isCombinedDate
														? (() => {
																const pIdx = [...combinePairs].find(
																	(j) => dateTimePairs[j].dateCol === col
																);
																return pIdx !== undefined
																	? `${col} ${dateTimePairs[pIdx].timeCol}`
																	: col;
															})()
														: col}
													<th
														class:selected={selectedColumns.has(col)}
														class:unselected={!selectedColumns.has(col)}
													>
														<label class="header-checkbox">
															<input
																type="checkbox"
																checked={selectedColumns.has(col)}
																onchange={(e) => {
																	const checked = e.currentTarget.checked;
																	if (isCombinedDate) {
																		const pIdx = [...combinePairs].find(
																			(j) => dateTimePairs[j].dateCol === col
																		);
																		const timeCol =
																			pIdx !== undefined ? dateTimePairs[pIdx].timeCol : null;
																		if (checked) {
																			selectedColumns = new Set([
																				...selectedColumns,
																				col,
																				...(timeCol ? [timeCol] : [])
																			]);
																		} else {
																			selectedColumns = new Set(
																				[...selectedColumns].filter(
																					(c) => c !== col && c !== timeCol
																				)
																			);
																		}
																	} else {
																		selectedColumns = checked
																			? new Set([...selectedColumns, col])
																			: new Set([...selectedColumns].filter((c) => c !== col));
																	}
																}}
															/>
															<span class="col-name">{combinedName}</span>
														</label>
														{#if replaceMode && selectedColumns.has(col)}
															<select
																class="mapping-select"
																value={columnMappings[combinedName] ?? ''}
																onchange={(e) => {
																	const val = e.currentTarget.value;
																	columnMappings[combinedName] = val === '' ? null : Number(val);
																	columnMappings = { ...columnMappings };
																}}
															>
																<option value="">New column</option>
																{#each existingColumnOptions as opt (opt.id)}
																	<option value={opt.id}>{opt.label}</option>
																{/each}
															</select>
														{/if}
													</th>
												{/if}
											{/each}
										</tr>
									</thead>
									<tbody>
										{#each Array(Math.min(6, Math.max(0, previewRowCount - (previewDisplayStart - 1)))) as _, i}
											{@const rowIdx = previewDisplayStart - 1 + i}
											<tr>
												{#each headers as col}
													{#if combinedTimeCols.has(col)}
														<!-- skip: merged -->
													{:else if combinedDateCols.has(col)}
														{@const pIdx = [...combinePairs].find(
															(j) => dateTimePairs[j].dateCol === col
														)}
														{@const timeColName =
															pIdx !== undefined ? dateTimePairs[pIdx].timeCol : null}
														<td
															class:selected={selectedColumns.has(col)}
															class:unselected={!selectedColumns.has(col)}
														>
															{parsedData[col]?.[rowIdx] ?? ''}
															{timeColName ? (parsedData[timeColName]?.[rowIdx] ?? '') : ''}
														</td>
													{:else}
														<td
															class:selected={selectedColumns.has(col)}
															class:unselected={!selectedColumns.has(col)}
														>
															{parsedData[col]?.[rowIdx] ?? '—'}
														</td>
													{/if}
												{/each}
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							<div
								class="control-input"
								style="flex-direction: row; align-items: center; gap: var(--space-2); flex-wrap: wrap;"
							>
								<p style="margin:0;">Row</p>
								<NumberWithUnits
									min={1}
									max={Math.max(1, previewRowCount - 5)}
									step={1}
									bind:value={previewDisplayStart}
								/>
								<p style="margin:0;">
									to {Math.min(previewDisplayStart + 5, previewRowCount)} of {previewRowCount} (preview)
								</p>
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
													{@const fatal = extraFileErrors.find((e) => e.filename === file.name)}
													{@const partial = mismatchedColumns.some((m) =>
														m.missingFrom.includes(file.name)
													)}
													{#if fatal}
														<span class="badge badge-error" title={fatal.error}>✗ error</span>
													{:else if partial}
														<span class="badge badge-warn">⚠ partial</span>
													{:else}
														<span class="badge badge-ok">✓ ok</span>
													{/if}
												{/if}
											</li>
										{/each}
									</ul>
									{#if extraFileErrors.length > 0}
										<div class="mismatch-warning">
											<p class="mismatch-warning-title">Cannot import these files:</p>
											{#each extraFileErrors as err}
												<p class="mismatch-detail">
													<strong>{err.filename}:</strong>
													{err.error}
												</p>
											{/each}
										</div>
									{:else if mismatchedColumns.length > 0}
										<div class="mismatch-warning-soft">
											<p class="mismatch-warning-title">
												Some columns are not present in every file. Only the {commonColumns.length}
												common column{commonColumns.length === 1 ? '' : 's'} will be imported.
											</p>
											{#each mismatchedColumns as m}
												<p class="mismatch-detail">
													<strong>{m.column}</strong> — missing from: {m.missingFrom.join(', ')}
												</p>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
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
					>{enspireMultiplatePayload ? 'Proceed Import' : 'Confirm Import'}</button
				>
			{/if}
		</div>
	{/snippet}
</Modal>

<style>
	.heading {
		margin-bottom: var(--space-4);
	}

	.filename-preview {
		font-size: var(--font-sm);
		color: var(--color-lightness-50);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.enspire-summary-panel {
		margin: var(--space-4) 0;
		padding: var(--space-5) 0.9rem;
		border: 1px solid var(--color-info);
		border-radius: var(--radius-sm);
		background: var(--color-info-bg);
	}

	.enspire-summary-title {
		margin: 0 0 0.35rem 0;
		font-weight: 700;
	}

	.enspire-summary-detail {
		margin: 0.2rem 0;
		font-size: 0.9em;
	}

	.enspire-summary-proceed {
		margin: 0.55rem 0 0 0;
		font-weight: 600;
	}

	.col-select-actions {
		display: flex;
		flex-direction: row;
		gap: var(--space-4);
	}

	/* ── Preview table ───────────────────────────────────────────────────────── */
	.preview-table-wrapper {
		margin-top: var(--space-4);
	}

	.preview-table {
		border-collapse: collapse;
		font-size: var(--font-sm);
	}

	.preview-table th,
	.preview-table td {
		padding: 0.2rem var(--space-4);
		border: 1px solid var(--color-lightness-90);
		white-space: nowrap;
	}

	.preview-table th.selected,
	.preview-table td.selected {
		background-color: var(--color-lightness-97);
	}

	.preview-table th.unselected,
	.preview-table td.unselected {
		opacity: 0.35;
		background-color: var(--color-lightness-95);
	}

	.header-checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		font-size: var(--font-sm);
		color: var(--color-lightness-35);
	}

	/* ── Multi-file concatenation UI ─────────────────────────────────────────── */
	.multi-file-list {
		margin-top: 0.75em;
		padding: 0.5em 0.75em;
		border: 1px solid var(--color-border, #ccc);
		border-radius: var(--radius-sm);
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
		background: var(--color-info-bg);
		color: var(--color-info-text);
	}
	.badge-ok {
		background: var(--color-success-bg);
		color: var(--color-success);
	}
	.badge-error {
		background: var(--color-error-bg);
		color: var(--color-error);
		cursor: help;
	}
	.badge-warn {
		background: var(--color-warning-bg);
		color: var(--color-warning);
	}
	.mismatch-warning-soft {
		margin-top: 0.5em;
		padding: 0.4em 0.6em;
		border: 1px solid var(--color-warning);
		border-radius: 3px;
		background: var(--color-warning-bg);
		color: var(--color-warning);
		font-size: 0.82em;
	}
	.mismatch-warning {
		margin-top: 0.5em;
		padding: 0.4em 0.6em;
		border: 1px solid var(--color-error-border);
		border-radius: 3px;
		background: var(--color-error-bg);
		color: var(--color-error);
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
		border: 1px solid var(--color-warning);
		border-radius: var(--radius-sm);
		background: var(--color-warning-bg);
	}
	.binning-warning {
		font-weight: 600;
		margin: 0 0 0.25em 0;
	}
	.binning-estimate {
		opacity: 0.7;
		font-size: 0.9em;
	}

	/* ── Date+Time combine panel ────────────────────────────────────────────── */
	.combine-panel {
		margin: 0.5em 0;
		padding: 0.5em 0.75em;
		border: 1px solid var(--color-info);
		border-radius: var(--radius-sm);
		background: var(--color-info-bg);
	}
	.combine-title {
		font-weight: 600;
		margin: 0 0 0.25em 0;
		font-size: 0.9em;
	}
	.combine-empty {
		margin: 0.25em 0;
		font-size: 0.85em;
		color: var(--color-lightness-50);
		font-style: italic;
	}
	.combine-row {
		display: flex;
		align-items: center;
		gap: 0.4em;
		font-size: 0.85em;
		margin: 0.25em 0;
	}
	.combine-select {
		flex: 1 1 auto;
		min-width: 6ch;
		font: inherit;
		padding: 0.15rem 0.3rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
		background: var(--color-lightness-97);
	}
	.combine-plus {
		font-weight: 700;
		color: var(--color-lightness-50);
	}
	.combine-remove {
		font: inherit;
		font-size: 1.1em;
		line-height: 1;
		padding: 0 0.4em;
		border: 1px solid transparent;
		border-radius: 2px;
		background: transparent;
		color: var(--color-lightness-50);
		cursor: pointer;
	}
	.combine-remove:hover {
		color: var(--color-error, #c5221f);
		border-color: currentColor;
	}
	.combine-add {
		font: inherit;
		font-size: 0.85em;
		margin-top: 0.4em;
		padding: 0.2em 0.6em;
		border: 1px dashed var(--color-info);
		border-radius: 2px;
		background: transparent;
		color: var(--color-info-text, #1a73e8);
		cursor: pointer;
	}
	.combine-add:hover {
		background: var(--color-info-bg);
	}

	/* ── Mapping dropdown in replace mode ───────────────────────────────────── */
	.mapping-select {
		display: block;
		width: 100%;
		margin-top: 0.25em;
		font-size: var(--font-xs);
		padding: 0.15rem 0.2rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
		background-color: var(--color-lightness-97);
	}
	.mapping-select:hover {
		border-color: var(--color-lightness-35);
	}
</style>
