// @ts-nocheck
import dayjs from './dayjsSetup.js';
import { guessFormat } from './guessTimeFormat';
import { getDisplayZone } from './displayTime.js';
import { min, max } from '$lib/utils/MathsStats';
import { createSequenceArray } from '$lib/utils/MathsStats';

const decimalPlaces = 4;

export function formatDate(dateIN) {
	const dt = dayjs(dateIN);
	if (!dt.isValid()) return '';
	// Mirrors Luxon's DATETIME_MED ("Oct 14, 1983, 1:30 PM") via Intl, so the
	// output stays locale-aware without dragging in a localizedFormat plugin.
	return dt.toDate().toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
}

function guessDateFormat(dateString) {
	const theGuess = guessFormat(dateString);
	if (typeof theGuess === 'string') {
		return [theGuess]; //force the output to be an array
	}
	return theGuess;
}

// return a format string that's the best guess for the daata
export function guessDateofArray(dates) {
	try {
		// get the guess of the first date
		let guessedlist = guessDateFormat(dates[0]);
		//If there is no guess, then return empty array
		if (guessedlist.length === 0) return guessedlist;
		//console.log('initial list', guessedlist, 'for ', dates[0]);

		//set up the dates to check - subsample if a large dataset
		let datesToCheck = dates;
		//subsample if there are more than 100k points, subsample to 5k
		if (dates.length > 100_000) {
			const idx = createSequenceArray(0, dates.length - 1, parseInt((dates.length - 1) / 5_000));
			datesToCheck = idx.map((i) => dates[i]);
		}

		// console.log('all N: ', dates.length, ' checking ', datesToCheck.length);

		//set up the Set of all possibleguesses
		let allGuesses = new Set();
		//fill it in
		for (let i = 0; i < datesToCheck.length; i++) {
			//make guess
			const guesses = guessDateFormat(datesToCheck[i]);
			//add the guess to Map or incresae counter
			for (let j = 0; j < guesses.length; j++) {
				allGuesses.add(guesses[j]);
			}
		}

		//Now get the best one (where there are most matches)
		const guessesArray = Array.from(allGuesses);
		//console.log('ALLGUESSES: ', guessesArray);
		let guessScore = guessesArray.map((guess) => {
			let score = 0;
			for (let i = 0; i < datesToCheck.length; i++) {
				// Strict parse so a token-mismatch counts as a miss for scoring.
				if (dayjs(datesToCheck[i], guess, true).isValid()) {
					score++;
				}
			}
			return score;
		});

		// console.log('SCORE:', guessScore);
		// console.log('best idx:', guessScore.indexOf(Math.max(...guessScore)));
		// console.log('FINAL guess:', guessesArray[guessScore.indexOf(Math.max(...guessScore))]);

		//return that one
		return guessesArray[guessScore.indexOf(Math.max(...guessScore))];
	} catch (error) {
		return -1;
	}
}

// `dateFormat` is a moment-style token string (e.g. 'YYYY-MM-DD HH:mm:ss')
// — the same vocabulary saved sessions store, since `convertFormat` (which
// previously translated to Luxon tokens) has been removed.
export function calculateTimeDifference(start, end, dateFormat) {
	if (start === null || end === null || start === undefined || end === undefined) {
		return null;
	}
	const startDt = dayjs(start, dateFormat, true);
	const endDt = dayjs(end, dateFormat, true);
	// dayjs.diff returns a number; pass `true` for fractional hours.
	return endDt.diff(startDt, 'hour', true).toFixed(decimalPlaces);
}

//get the minimum period and if all the steps are the same
export function getPeriod(timeData, timefmt) {
	let diffs = new Array(timeData.length - 1);
	for (let i = 1; i < timeData.length; i++) {
		diffs[i - 1] = calculateTimeDifference(timeData[i - 1], timeData[i], timefmt);
	}

	return {
		minDiff: min(diffs),
		constant: min(diffs) === max(diffs)
	};
}

// Takes in an inputted value (ISO format) and the first time and format of
//data. Calculates the offset for actograms (and other plots).
export function getstartTimeOffset(inputTime, firstTime, timeFormat) {
	const start = dayjs(inputTime);
	const end = dayjs(firstTime, timeFormat, true);
	return end.diff(start, 'hour', true).toFixed(decimalPlaces);
}

export function makeTimeProcessedData(rawData) {
	let guessedFormat = guessDateofArray(rawData);
	const dataout = rawData.map((date) => {
		calculateTimeDifference(rawData[0], date, guessedFormat);
	});
	return dataout;
}

export function getGuessedFormat(dataIN) {
	//get the format
	let guessedFormat = guessDateofArray(dataIN);

	return guessedFormat;
}

export function forceFormat(dataIN, formatIN) {
	const dataout = dataIN.map((date) => calculateTimeDifference(dataIN[0], date, formatIN));
	return dataout;
}

export function formatTimeFromUNIX(timeUNIX) {
	const zone = getDisplayZone();
	const dt = zone === 'utc' ? dayjs.utc(timeUNIX) : dayjs(timeUNIX).tz(zone);
	// Hand off to formatTimeFromISO so any external consumers of the wire
	// format ("DD MMM YYYY HH:mm:ss") see exactly the same string.
	return formatTimeFromISO(dt.format('YYYY-MM-DDTHH:mm:ss.SSS'));
}

export function formatTimeFromISO(timeString) {
	if (timeString) {
		const [datePart, timePart] = timeString.split('T');
		const [year, month, day] = datePart.split('-');
		const timeParts = timePart.split(':');
		const hours = timeParts[0];
		const minutes = timeParts[1];
		const seconds = timeParts[2] ? timeParts[2].split('.')[0] : '00';

		const monthLookup = [
			'Jan',
			'Feb',
			'Mar',
			'Apr',
			'May',
			'Jun',
			'Jul',
			'Aug',
			'Sep',
			'Oct',
			'Nov',
			'Dec'
		];
		const monthText = monthLookup[+month - 1];

		return `${day} ${monthText} ${year} ${hours}:${minutes}:${seconds}`;
	} else {
		return '';
	}
}
export function getISODate(stringIN, formatIN) {
	if (!formatIN) return stringIN;
	return dayjs.utc(stringIN, formatIN, true).toISOString();
}
export function getUNIXDate(stringIN, formatIN) {
	if (!formatIN) return stringIN;
	return dayjs.utc(stringIN, formatIN, true).valueOf();
}
export function addTime(start, hoursIN) {
	return formatTimeFromISO(dayjs(start).add(hoursIN, 'hour').toISOString());
}

/*
///----------------
console.log(DateTime.fromFormatExplain("2023-10-2T11:35", "yyyy-LL-ddTHH:mm"));
console.log(DateTime.fromFormatExplain("2023-10-2T11:35", "yyyy-LL-ddTHH:mm"));
console.log(DateTime.fromFormat("2023-10-2T11:35", "yyyy-L-dTHH:mm"));
console.log(DateTime.fromFormat("2023-10-2 11:35", "yyyy-LL-dd HH:mm").invalid);
console.log(DateTime.fromFormat("2023-10-2 11:35", "yyyy-LL-d HH:mm").invalid);
console.log(
  DateTime.fromFormat("2023-10-2 11:35", "yyyy-LL-d HH:mm").invalid === null
);

console.log(guessDateofArray(["something else"]));


const testRawData = [
  "10/11/2023, 10:35:00 AM",
  "10/11/2023, 15:35:00 AM",
  "10/12/2023, 10:40:00 AM",
  "10/12/2023, 11:35:00 AM",
  "10/13/2023, 10:45:00 AM",
  "10/13/2023, 12:55:00 AM",
];
console.log(makeTimeProcessedData(testRawData));

const testRawData2 = [
  "11/12/2023 10:35:00",
  "10/12/2023 11:35:00",
  "10/12/2023 12:35:00",
  "10/12/2023 13:35:00",
  "10/12/2023 14:35:00",
  "10/12/2023 15:35:00",
];
console.log(makeTimeProcessedData(testRawData2));

console.log(guessDateFormat("2023-06-14T10:00"));
console.log(guessDateFormat("1/1/2024, 11:10:00 AM"));

console.log(convertFormat(guessDateFormat("2023-06-14T10:00")[0]));

const testGen = [
  "1/1/2024, 11:10:00 AM",
  "1/1/2024, 11:25:00 AM",
  "1/1/2024, 11:40:00 AM",
  "1/1/2024, 11:55:00 AM",
  "1/1/2024, 12:10:00 PM",
  "1/1/2024, 12:25:00 PM",
  "1/10/2024, 12:40:00 PM",
  "1/11/2024, 3:40:00 PM",
];
console.log(makeTimeProcessedData(testGen));

/*
let now = DateTime.now();

console.log(now.toString());
console.log(now.toMillis());

var end = DateTime.fromISO("2017-03-13");
var start = DateTime.fromISO("2017-02-13");

var diffInMonths = end.diff(start, "hours");
console.log(diffInMonths.toObject());

start = DateTime.fromISO("2023-05-25T11:34:13");
end = DateTime.fromISO("2023-05-25T12:35:14");
diffInMonths = end.diff(start, "minutes");
console.log(diffInMonths.toObject());

//-------------------
// GUESS //npm install moment-guess
let dateString = "31/12/2020";

// Guess the date format
let guessedFormat = guessFormat(dateString);

console.log("Guessed Format:", guessedFormat);

dateString = "12/31/2020";
console.log("Guessed Format:", guessFormat(dateString));

dateString = "10/11/2020";
console.log("Guessed Format:", guessFormat(dateString));

dateString = "12/11/2020 11:31:12";
console.log("Guessed Format:", guessFormat(dateString));

dateString = "12/11/2020 11:31:12";
console.log("Guessed Format:", guessFormat(dateString));
*/
