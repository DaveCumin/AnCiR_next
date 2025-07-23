// @ts-nocheck
import { DateTime } from 'luxon';

import { pushObj } from '$lib/core/core.svelte';
import { Table } from '$lib/core/table.svelte';
import { Column } from '$lib/core/Column.svelte';
import { guessDateofArray, forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';

import Papa from 'papaparse';
import { tick } from 'svelte';

const specialValues = ['NaN', 'NA', 'null'];
const previewTableNrows = 6;

let _tempdata = {};
let _columnOrder = [];
let error = {};
let skipLines = 0;
let flagExtraData = false;
let errorInfile = false;
let specialRecognised = false;

export function getTempData() {
	return _tempdata;
}

// export functions as 'package' importDataUtils
export const utils = {
	openFileChoose,
	parseFile,
	loadData,
	makeTempTable
};

/*
helper functions: import data
*/
async function openFileChoose(hasHeader = true) {
	//reset the values
	_tempdata = {};
	_columnOrder = [];
	error = {};
	hasHeader = true;
	flagExtraData = false;
	errorInfile = false;
	specialRecognised = false;

	//wait for input to be loaded
	await tick();

	//click it
	const fileInput = document.getElementById('fileInput');
	fileInput.click();
}

function parseFile(targetFile, previewIN = 0, hasHeader = false, delimiter = ',') {
	if (!targetFile) {
		errorInfile = true;
		return;
	}

	errorInfile = false; //reset the errors
	return new Promise((resolve) => {
		console.log('doing papa previewIN= ' + previewIN + ', hasHeader= ' + hasHeader);

		//Do the business
		Papa.parse(targetFile, {
			preview: previewIN,
			header: hasHeader,
			dynamicTyping: true,
			skipEmptyLines: 'greedy',
			delimiter: delimiter,
			error: function (err, file, inputElem, reason) {
				console.log('Error: ' + err + ' | ' + reason);
				_tempdata = {};
				_columnOrder = [];
				error = { err, reason };
				resolve(); // Resolve the Promise even in case of an error
			},
			//Remove the first skipLines lines of the file before parsing
			beforeFirstChunk: (chunk) => {
				const lines = chunk.split(/\r\n|\r|\n/); // Split the content into lines

				const firstLines = skipLines
					? lines.splice(0, skipLines) // Remove the first N lines if there are skiplines
					: lines[0].split(/[,;\t]/); //else take a sample of the first line to check for filetype (Actiware, etc)

				//check for Actiware data - and remove appropriate lines, if so
				if (firstLines[0]?.includes('Actiware Export File') && !specialRecognised) {
					console.log('ACTIWARE');
					specialRecognised = 'actiware';
					skipLines = 148; /// the number of lines for an Actiware file before the data starts
					parseFile(skipLines + previewIN + 1);
				}

				return lines.join('\n'); // Join the remaining lines back into a single string
			},
			complete: function (results, file) {
				console.log('Parsing complete:', results, file);

				// Store the column order from the file
				if (hasHeader && results.meta.fields) {
					_columnOrder = results.meta.fields; // PapaParse provides the field order
				} else if (results.data.length > 0) {
					_columnOrder = Object.keys(results.data[0]); // Fallback to first row keys
				}

				//Deal with awd data
				if (file.name.toLowerCase().endsWith('.awd')) {
					results.errors = [];
					//get more data to preview before continuing
					if (previewIN == skipLines + previewTableNrows + hasHeader) {
						parseFile(14);
					} else {
						results.data = awdTocsv(results.data);
					}
				}
				console.log('RESULTS', results);
				//for non awd files, continue
				if (results.errors.length > 0) {
					errorInfile = true;
				}
				dealWithData(results.data);

				resolve(); // Resolve the Promise when parsing is complete
			}
		});
	});
}

//deal with the data - actiware, clocklab, etc
function dealWithData(dataIN) {
	//convert the data into an object of arrays
	_tempdata = convertArrayToObject(dataIN);

	if (specialRecognised === 'actiware') {
		_tempdata['DateTime'] = [];
		for (let i = 0; i < _tempdata['Date'].length; i++) {
			_tempdata['DateTime'].push(
				_tempdata['Date'][i] +
					' ' +
					_tempdata['Time'][i].replace(
						/\b([ap])\.m\./gi,
						(match, group) => group.toUpperCase() + 'M'
					)
			); // the replace convers the a.m. or p.m. to AM or PM so it can be a time;
		}
		// Ensure DateTime is added to _columnOrder in the correct position
		if (!_columnOrder.includes('DateTime')) {
			const dateIndex = _columnOrder.indexOf('Date');
			if (dateIndex !== -1) {
				_columnOrder.splice(dateIndex + 1, 0, 'DateTime');
			} else {
				_columnOrder.push('DateTime');
			}
		}
	}
}

//Converts the array into an object - more like AnCir uses
function convertArrayToObject(inputArray) {
	try {
		let resultObject = {};

		if (_columnOrder.length > 0) {
			_columnOrder.forEach((key) => {
				resultObject[key] = [];
			});
		}

		// Loop through each object in the array
		inputArray.forEach((item) => {
			// Use _columnOrder if available, otherwise use item keys
			const keys = _columnOrder.length > 0 ? _columnOrder : Object.keys(item);
			keys.forEach((key) => {
				if (!resultObject[key]) {
					resultObject[key] = [];
				}
				resultObject[key].push(item[key]);
			});
		});

		//change the keys to the first values if hasHeader and extra
		if (flagExtraData && hasHeader) {
			resultObject = changeObjectKeys(resultObject, inputArray[0]);
		}

		return resultObject;
	} catch (error) {
		console.error('Error converting array to object:', error);
		return {};
	}
}

//change the keys to a new array
function changeObjectKeys(object, newKeys) {
	const newObject = {};

	const orderedKeys = _columnOrder.length > 0 ? _columnOrder : Object.keys(object);

	orderedKeys.forEach((originalKey, i) => {
		const newKey = newKeys[i] || originalKey;
		if (object[originalKey]) {
			object[originalKey].splice(0, 1); // Remove the first value (header)
			newObject[newKey] = object[originalKey];
		}
	});

	// Update _columnOrder with new keys
	_columnOrder = Object.keys(newObject);

	return newObject;
}

//Load the data once all operations have been completed
async function loadData(targetFile, hasHeader) {
	console.log('loading...');
	await parseFile(targetFile, 0, hasHeader); //load all the data

	//TODO_high: perorm the required manipulations
	doBasicFileImport(_tempdata, targetFile.name); //LOAD THE DATA
}

// put the data into the tool store
// TODO_med: check the logic here, as the Sampling freq isn't updating properly for times.
function doBasicFileImport(result, fname) {
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
		console.log(f, datum, guessedFormat);
		if (guessedFormat != -1 && guessedFormat.length > 0) {
			const df = new Column();
			df.type = 'time';
			df.name = f;
			df.data = result[f];
			df.timeFormat = guessedFormat;
			newDataEntry.addColumn(df);
		} else if (!isNaN(datum)) {
			const df = new Column();
			df.type = 'value';
			df.name = f;
			df.data = result[f];
			newDataEntry.addColumn(df);
		} else {
			const df = new Column();
			df.type = 'category';
			df.name = f;
			df.data = result[f];
			newDataEntry.addColumn(df);
		}
	});
	console.log(newDataEntry instanceof Table);
	pushObj(newDataEntry);
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

//make a table from the data
function makeTempTable(tempdata) {
	//If there is no data, report an error
	if (Object.keys(tempdata).length === 0) {
		return 'There was an error reading the file ';
	}
	console.log('raw: ', JSON.stringify(tempdata));
	console.log('keys: ', Object.keys(tempdata));
	let table = '<table><thead><tr>';
	const keys = _columnOrder.length > 0 ? _columnOrder : Object.keys(tempdata);
	keys.forEach((heading) => (table += `<th>${heading}</th>`));
	table += '</tr></thead><tbody>';
	for (let r = 0; r < previewTableNrows; r++) {
		table += '<tr>';
		for (let c = 0; c < keys.length; c++) {
			table += `<td>${tempdata[keys[c]][r]}</td>`;
		}
		table += '</tr>';
	}
	table += '</tbody></table>';
	return table;
}
