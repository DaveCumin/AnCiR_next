
// @ts-nocheck
import { DateTime } from 'luxon';

import { pushObj } from '$lib/core/theCore.svelte';
import { DataItem } from '$lib/models/data/dataItem.svelte';
import { DataField } from '$lib/models/data/dataField.svelte';
import {
    guessDateofArray,
    forceFormat,
    getPeriod,
} from '$lib/utils/time/TimeUtils';

import Papa from 'papaparse';
import { tick } from 'svelte';

const specialValues = ["NaN", "NA", "null"];
const previewTableNrows = 6;

let _filesToImport;
let _tempdata = {};
let error = {};
let skipLines = 0;
let useHeaders = true;
let flagExtraData = false;
let errorInfile = false;
let specialRecognised = false;

// getter and setter
export function setFilesToImport(f) {
	_filesToImport = f;
}
export function getTempData() {
	return _tempdata;
}

// export functions as 'package' importDataUtils
export const importDataUtils = {
    openFileChoose,
    parseFile,
    loadData,
    makeTempTable,
}


/*
helper functions: import data
*/
async function openFileChoose() {
    //reset the values
    _tempdata = {};
    error = {};
    useHeaders = true;
    flagExtraData = false;
    errorInfile = false;
    specialRecognised = false;

    //wait for input to be loaded
    await tick();

    //click it
    const fileInput = document.getElementById("fileInput");
    fileInput.click();
}

function parseFile(previewIN = 0) {
    errorInfile = false; //reset the errors
    return new Promise((resolve) => {
        console.log(
            "doing papa previewIN= " + previewIN + ", useHeaders= " + useHeaders
        );

        //Do the business
        Papa.parse(_filesToImport[0], {
            preview: previewIN,
            header: useHeaders,
            dynamicTyping: true,
            skipEmptyLines: "greedy",
            error: function (err, file, inputElem, reason) {
                console.log("Error: " + err + " | " + reason);
                _tempdata = {};
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
            if (
                firstLines[0]?.includes("Actiware Export File") &&
                !specialRecognised
            ) {
                console.log("ACTIWARE");
                specialRecognised = "actiware";
                skipLines = 148; /// the number of lines for an Actiware file before the data starts
                parseFile(skipLines + previewIN + 1);
            }

            return lines.join("\n"); // Join the remaining lines back into a single string
            },
            complete: function (results, file) {
                console.log("Parsing complete:", results, file);

                //Deal with awd data
                if (file.name.toLowerCase().endsWith(".awd")) {
                    results.errors = [];
                    //get more data to preview before continuing
                    if (previewIN == skipLines + previewTableNrows + useHeaders) {
                    parseFile(14);
                    } else {
                    results.data = awdTocsv(results.data);
                    }
                }
                console.log("RESULTS", results);
                //for non awd files, continue
                if (results.errors.length > 0) {
                    errorInfile = true;
                }
                dealWithData(results.data);

                resolve(); // Resolve the Promise when parsing is complete
            },
        });
    });
}

//deal with the data - actiware, clocklab, etc
function dealWithData(dataIN) {
    //convert the data into an object of arrays
    _tempdata = convertArrayToObject(dataIN);

    if (specialRecognised === "actiware") {
        _tempdata["DateTime"] = [];
        for (let i = 0; i < _tempdata["Date"].length; i++) {
            _tempdata["DateTime"].push(
            _tempdata["Date"][i] +
                " " +
                _tempdata["Time"][i].replace(
                /\b([ap])\.m\./gi,
                (match, group) => group.toUpperCase() + "M"
                )
            ); // the replace convers the a.m. or p.m. to AM or PM so it can be a time;
        }
    }
}

//Converts the array into an object - more like AnCir uses
function convertArrayToObject(inputArray) {
    try {
        let resultObject = {};

        // Loop through each object in the array
        inputArray.forEach((item) => {
            // Loop through each key in the object
            Object.keys(item).forEach((key) => {
            // Initialize the array for the key if it doesn't exist
            if (!resultObject[key]) {
                resultObject[key] = [];
            }

            // Push the value to the corresponding array
            resultObject[key].push(item[key]);
            });
        });

        //change the keys to the first values if useHeader and extra
        if (flagExtraData && useHeaders) {
            resultObject = changeObjectKeys(resultObject, inputArray[0]);
        }

        return resultObject;

    } catch (error) {
        console.error("Error converting array to object:", error);
        return {};
    }
}

//change the keys to a new array
function changeObjectKeys(object, newKeys) {
    console.log(object);
    const newObject = {};

    // Loop through the keys of the original object
    Object.keys(object).forEach((originalKey, i) => {
        // Create the new key
        const newKey = newKeys[i] || originalKey;
        
        // Assign the values to the new key in the new object
        object[originalKey].splice(0, 1); // remove the first value, as it's the header
        newObject[newKey] = object[originalKey];
    });

    return newObject;
}

//Load the data once all operations have been completed
async function loadData() {
    console.log("loading...");
    await parseFile(0); //load all the data

    //TODO_high: perorm the required manipulations
    doBasicFileImport(_tempdata, _filesToImport[0].name); //LOAD THE DATA

    // $menuModalType = ''; //close the dialog
}

// put the data into the tool store
// TODO_med: check the logic here, as the Sampling freq isn't updating properly for times.
function doBasicFileImport(result, fname) {

    // create dataItem object with constructor(ID, importedFrom, displayName, dataLength)
    const newDataEntry = new DataItem(
        '',
        fname,
        result[Object.keys(result)[0]].length
    )
    newDataEntry.setName(`data_${newDataEntry.id}`);

    //insert a data element for each header
    Object.keys(result).forEach((f, i) => {

        //find the data type based on the first non-NaN element
        const datum = getFirstValid(result[f], 5);
        const guessedFormat = guessDateofArray(result[f]);

        if (guessedFormat != -1) {
            const timefmt = guessedFormat;
            const df = new DataField(newDataEntry.id, 'time')
            df.name = f;
            df.dataArr = forceFormat(result[f], timefmt);
            // this.properties = {
            //     timeFormat: timefmt,
            //     recordPeriod: getPeriod(result[f], timefmt),
            // };
            newDataEntry.dataFields.push(df);
        } else if (!isNaN(datum)) {
            const df = new DataField(newDataEntry.id, 'value')
            df.name = f;
            df.dataArr = result[f];
            newDataEntry.dataFields.push(df);
        } else {
            const df = new DataField(i, 'category')
            df.name = f;
            df.dataArr = result[f];
            newDataEntry.dataFields.push(df);
        }   
    });
    
    pushObj(newDataEntry);
}

// get the first valid data point in the result, given key
function getFirstValid(data) {
    for (const value of data) {
        if (value !== null && value !== "" && !specialValues.includes(value)) {
            return value;
        }
    }
    // Return a default value if no valid value is found
    return null;
}

//make a table from the data
function makeTempTable(_tempdata) {
    //If there is no data, report an error
    if (Object.keys(_tempdata).length === 0) {
        return "There was an error reading the file " + _filesToImport[0].name;
    }

    let table = "<table><thead><tr>";
    Object.keys(_tempdata).forEach(
        (heading) => (table += `<th>${heading}</th>`)
    );
    table += "</tr></thead><tbody>";
    for (let r = 0; r < previewTableNrows; r++) {
        table += "<tr>";
        for (let c = 0; c < Object.keys(_tempdata).length; c++) {
            table += `<td>${_tempdata[Object.keys(_tempdata)[c]][r]}</td>`;
        }
        table += "</tr>";
    }
    table += "</tbody></table>";
    return table;
}
