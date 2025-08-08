// @ts-nocheck
import { DateTime } from 'luxon';
import { guessFormat } from './guessTimeFormat';
import { min, max } from '$lib/utils/MathsStats';
import { createSequenceArray } from '$lib/utils/MathsStats';

const decimalPlaces = 4;

export function formatDate(dateIN) {
	dateIN = DateTime.fromISO(dateIN);

	const formattedDate = dateIN.toLocaleString(DateTime.DATETIME_MED);
	return formattedDate;
}

function convertFormat(formatIN) {
	if (!formatIN || typeof formatIN == 'number') return formatIN;

	//moment format string to luxon format string (https://moment.github.io/luxon/#/parsing?id=table-of-tokens)
	const map = {
		from: ['A', 'D', 'DD', 'M', 'MM', 'YY', 'YYYY'],
		to: ['a', 'd', 'dd', 'L', 'LL', 'yy', 'yyyy']
	};

	let formatOUT = formatIN;
	if (formatIN == '' || formatIN == null || formatIN == undefined) return '';

	map.from.forEach((from, index) => {
		const to = map.to[index];
		const regex = new RegExp(`\\b${from}\\b`, 'g'); // Using word boundaries to match whole words

		formatOUT = formatOUT.replace(regex, to);
	});

	return formatOUT;
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
		// console.log('initial list', guessedlist);

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
		console.log('ALLGUESSES: ', guessesArray);
		let guessScore = guessesArray.map((guess) => {
			let score = 0;
			for (let i = 0; i < datesToCheck.length; i++) {
				if (DateTime.fromFormat(datesToCheck[i], convertFormat(guess)).invalid == null) {
					score++;
				}
			}
			return score;
		});

		console.log('SCORE:', guessScore);
		console.log('best idx:', guessScore.indexOf(Math.max(...guessScore)));
		console.log('FINAL guess:', guessesArray[guessScore.indexOf(Math.max(...guessScore))]);

		//return that one
		return guessesArray[guessScore.indexOf(Math.max(...guessScore))];
	} catch (error) {
		return -1;
	}
}

export function calculateTimeDifference(start, end, dateFormat) {
	if (start === null || end === null || start === undefined || end === undefined) {
		return null;
	}
	start = DateTime.fromFormat(start, dateFormat);
	end = DateTime.fromFormat(end, dateFormat);

	var diffTime = end.diff(start, 'hours');
	return diffTime.hours.toFixed(decimalPlaces);
}

//get the minimum period and if all the steps are the same
export function getPeriod(timeData, timefmt) {
	let diffs = new Array(timeData.length - 1);
	for (let i = 1; i < timeData.length; i++) {
		diffs[i - 1] = calculateTimeDifference(timeData[i - 1], timeData[i], convertFormat(timefmt));
	}

	return {
		minDiff: min(diffs),
		constant: min(diffs) === max(diffs)
	};
}

// Takes in an inputted value (ISO format) and the first time and format of
//data. Calculates the offset for actograms (and other plots).
export function getstartTimeOffset(inputTime, firstTime, timeFormat) {
	let start = DateTime.fromISO(inputTime);
	let end = DateTime.fromFormat(firstTime, convertFormat(timeFormat));
	return end.diff(start, 'hours').hours.toFixed(decimalPlaces);
}

export function makeTimeProcessedData(rawData) {
	let guessedFormat = guessDateofArray(rawData);
	const dataout = rawData.map((date) => {
		calculateTimeDifference(rawData[0], date, convertFormat(guessedFormat)); //convert for Luxon
	});
	return dataout;
}

export function getGuessedFormat(dataIN) {
	//get the format
	let guessedFormat = guessDateofArray(dataIN);

	return guessedFormat;
}

export function forceFormat(dataIN, formatIN) {
	const dataout = dataIN.map((date) =>
		calculateTimeDifference(dataIN[0], date, convertFormat(formatIN))
	);
	return dataout;
}

export function formatTimeFromISO(timeString) {
	if (timeString) {
		const [datePart, timePart] = timeString.split('T');
		const [year, month, day] = datePart.split('-');
		const [hours, minutes] = timePart.split(':');

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

		return `${day} ${monthText} ${year} ${hours}:${minutes}`;
	} else {
		return '';
	}
}
export function getISODate(stringIN, formatIN) {
	if (!formatIN) return stringIN;
	return DateTime.fromFormat(stringIN, convertFormat(formatIN)).toISO();
}
export function getUNIXDate(stringIN, formatIN) {
	if (!formatIN) return stringIN;
	return DateTime.fromFormat(stringIN, convertFormat(formatIN)).toMillis();
}
export function addTime(start, hoursIN) {
	return formatTimeFromISO(DateTime.fromISO(start).plus({ hours: hoursIN }).toISO());
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
