import { timeParse } from 'd3-time-format';

// Token types and their possible D3/strftime format specifiers
const tokenSpecifiers = {
	year: [
		{ pattern: /^[0-9]{4}$/, default: '%Y', strftime: '%Y' }, // 2025
		{ pattern: /^[0-9]{2}$/, default: '%y', strftime: '%y' }, // 25
		{ pattern: /^[+-][0-9]{6}$/, default: '%Y', strftime: '%Y' } // +202507
	],
	month: [
		{ pattern: /^(0?[1-9]|1[0-2])$/, default: '%m', strftime: '%m' }, // 1, 01, 2, 02, ..., 12
		{
			pattern: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i,
			default: '%b',
			strftime: '%b'
		}, // Jan
		{
			pattern:
				/^(January|February|March|April|May|June|July|August|September|October|November|December)$/i,
			default: '%B',
			strftime: '%B'
		} // January
	],
	dayOfMonth: [
		{ pattern: /^(0?[1-9]|[12][0-9]|3[01])(st|nd|rd|th)?$/, default: '%d', strftime: '%d' } // 1, 01, 31, 5th
	],
	dayOfWeek: [
		{ pattern: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/i, default: '%a', strftime: '%a' }, // Mon
		{
			pattern: /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i,
			default: '%A',
			strftime: '%A'
		} // Monday
	],
	hour: [
		{ pattern: /^(0?[0-9]|1[0-2])$/, default: '%I', strftime: '%I' }, // 12-hour (1-12)
		{ pattern: /^(2[0-3]|[0-1]?[0-9])$/, default: '%H', strftime: '%H' } // 24-hour (0-23)
	],
	minute: [
		{ pattern: /^[0-5][0-9]$/, default: '%M', strftime: '%M' } // 30
	],
	second: [
		{ pattern: /^[0-5][0-9]$/, default: '%S', strftime: '%S' } // 00
	],
	millisecond: [
		{ pattern: /^[0-9]{1,3}$/, default: '%L', strftime: '%L' } // 123
	],
	meridiem: [
		{ pattern: /^(am|pm|AM|PM)$/, default: '%p', strftime: '%p' } // AM
	],
	timezone: [
		{ pattern: /^[+-][0-9]{2}(:?[0-9]{2})?$/, default: '%z', strftime: '%z' }, // +00:00 or +0000
		{ pattern: /^Z$/, default: '%Z', strftime: '%Z' }, // Z
		{ pattern: /^[A-Z]{2,5}$/, default: '%Z', strftime: '%Z' } // NZST, EDT
	],
	dayOfYear: [
		{ pattern: /^(0?[1-9]|[1-9][0-9]|[1-3][0-6][0-6])$/, default: '%j', strftime: '%j' } // 1-366
	],
	isoWeekOfYear: [
		{ pattern: /^[0-5]?[0-9]$/, default: '%U', strftime: '%U' } // 0-53
	],
	isoDayOfWeek: [
		{ pattern: /^[1-7]$/, default: '%u', strftime: '%u' } // 1-7
	],
	escapeText: [
		{ pattern: /^W$/, default: '[W]', strftime: 'W' } // ISO week indicator
	]
};

// Tokenize the input string
function tokenize(date) {
	const tokens = [];
	let current = '';
	let i = 0;

	while (i < date.length) {
		const char = date[i];

		if (/[0-9]/.test(char)) {
			if (current && !/[0-9]/.test(current[current.length - 1])) {
				tokens.push(current);
				current = '';
			}
			current += char;
		} else if (/[A-Za-z]/.test(char)) {
			if (current && !/[A-Za-z]/.test(current[current.length - 1])) {
				tokens.push(current);
				current = '';
			}
			current += char;
		} else {
			if (current) {
				tokens.push(current);
				current = '';
			}
			tokens.push(char);
		}
		i++;
	}
	if (current) tokens.push(current);

	return tokens;
}

// Guess token types based on patterns, allowing multiple types per token
// Guess token types based on patterns, allowing multiple types per token
function guessTokenTypes(tokens) {
	const typedTokens = tokens.map((token, index) => {
		const possibleTypes = [];

		// Check each token against all possible types
		for (const [type, specs] of Object.entries(tokenSpecifiers)) {
			for (const spec of specs) {
				if (spec.pattern.test(token)) {
					// Prioritize millisecond over dayOfYear if token follows a decimal point
					if (type === 'millisecond' && index > 0 && tokens[index - 1] === '.') {
						possibleTypes.unshift({ type, format: spec.default, strftime: spec.strftime });
					} else if (type === 'dayOfYear' && index > 0 && tokens[index - 1] === '.') {
						continue; // Skip dayOfYear after decimal point
					} else {
						possibleTypes.push({ type, format: spec.default, strftime: spec.strftime });
					}
				}
			}
		}

		// Apply contextual heuristics to prioritize types
		if (possibleTypes.length > 1) {
			// Prioritize year for first 4-digit number
			if (index === 0 && token.match(/^[0-9]{4}$/)) {
				return [{ type: 'year', format: '%Y', strftime: '%Y' }];
			}

			// Find the index of the 'T' delimiter
			const tIndex = tokens.indexOf('T');
			// Prioritize time-related types after 'T' delimiter based on position
			if (tIndex !== -1 && index > tIndex) {
				// Expected order after T: hour, :, minute, :, second, ., millisecond
				const relativeIndex = index - tIndex - 1; // Position relative to T
				if (relativeIndex === 0 && token.match(/^(2[0-3]|[0-1]?[0-9])$/)) {
					return [{ type: 'hour', format: '%H', strftime: '%H' }]; // e.g., 08, 09, 10
				}
				if (relativeIndex === 2 && token.match(/^[0-5][0-9]$/)) {
					return [{ type: 'minute', format: '%M', strftime: '%M' }]; // e.g., 45
				}
				if (relativeIndex === 4 && token.match(/^[0-5][0-9]$/)) {
					return [{ type: 'second', format: '%S', strftime: '%S' }]; // e.g., 29
				}
			}

			// Fallback for 1-2 digit numbers before 'T' or without time context
			if (token.match(/^(0?[1-9]|1[0-2])$/)) {
				return [
					{ type: 'month', format: '%m', strftime: '%m' },
					{ type: 'dayOfMonth', format: '%d', strftime: '%d' },
					{ type: 'year', format: '%y', strftime: '%y' }
				];
			}
		}

		// If no specific type is found, treat as delimiter
		if (possibleTypes.length === 0) {
			return [{ type: 'delimiter', format: token, strftime: token }];
		}

		return possibleTypes;
	});

	// Refine hour tokens based on meridiem presence
	const hasMeridiem = typedTokens.some((token) => token.some((t) => t.type === 'meridiem'));
	if (hasMeridiem) {
		typedTokens.forEach((token) => {
			if (token.some((t) => t.type === 'hour')) {
				token.forEach((t) => {
					if (t.type === 'hour') {
						t.format = '%I'; // Force 12-hour format
						t.strftime = '%I';
					}
				});
			}
		});
	}

	return typedTokens;
}

// Generate candidate format strings from combinations of token types
function generateFormats(typedTokens, format = 'default') {
	let formats = [{ str: '', types: new Set() }];

	for (const tokenTypes of typedTokens) {
		const newFormats = [];
		for (const fmt of formats) {
			for (const token of tokenTypes) {
				// Skip if the token's type is already used in this format, unless it's a delimiter
				if (token.type === 'delimiter' || !fmt.types.has(token.type)) {
					const formatSpecifier = format === 'strftime' ? token.strftime : token.format;
					if (formatSpecifier) {
						const newTypes = new Set(fmt.types);
						if (token.type !== 'delimiter') {
							newTypes.add(token.type);
						}
						newFormats.push({ str: fmt.str + formatSpecifier, types: newTypes });
					} else {
						// Fallback: treat as delimiter if format specifier is undefined
						newFormats.push({ str: fmt.str + token.type, types: new Set(fmt.types) });
					}
				}
			}
		}
		if (newFormats.length === 0) {
			// Prevent empty formats by carrying forward the current formats
			formats.forEach((fmt) => newFormats.push(fmt));
		}
		formats = newFormats;
	}

	return formats.length > 0 ? formats.map((f) => f.str) : [];
}
// Test formats with D3 parser, ensuring valid months and days
function testFormats(dates, formats, formatType = 'default') {
	const validFormats = [];
	for (const fmt of formats) {
		const parser = timeParse(fmt);
		let allValid = true;

		for (const date of dates) {
			const parsedDate = parser(date);
			if (!parsedDate) {
				allValid = false;
				break;
			}

			// Validate numeric month (%m) if present in the format
			if (fmt.includes('%m')) {
				// Split format and date to align components
				const formatParts = fmt.split(/(%[a-zA-Z])/).filter((p) => p);
				const dateParts = date.match(/(\d+|[A-Za-z]+|[^A-Za-z0-9]+)/g) || [];
				for (let i = 0; i < formatParts.length && i < dateParts.length; i++) {
					if (formatParts[i] === '%m') {
						const monthValue = parseInt(dateParts[i], 10);
						if (isNaN(monthValue) || monthValue < 1 || monthValue > 12) {
							allValid = false;
							break;
						}
					}
				}
				if (!allValid) break;
			}

			// Validate numeric day (%d) if present in the format
			if (fmt.includes('%d')) {
				// Split format and date to align components
				const formatParts = fmt.split(/(%[a-zA-Z])/).filter((p) => p);
				const dateParts = date.match(/(\d+|[A-Za-z]+|[^A-Za-z0-9]+)/g) || [];
				for (let i = 0; i < formatParts.length && i < dateParts.length; i++) {
					if (formatParts[i] === '%d') {
						const dayValue = parseInt(dateParts[i], 10);
						if (isNaN(dayValue) || dayValue < 1 || dayValue > 31) {
							allValid = false;
							break;
						}
					}
				}
				if (!allValid) break;
			}
		}

		if (allValid) {
			validFormats.push(fmt);
		}
	}
	return validFormats;
}

// Main function to guess the format
export function guessFormatD3(dates, format = 'default') {
	const tokens = tokenize(dates[0]);
	console.log('tokens:', tokens);
	const typedTokens = guessTokenTypes(tokens);
	console.log('typedTokens:', typedTokens);
	const candidateFormats = generateFormats(typedTokens, format);
	console.log('candidateFormats:', candidateFormats);

	// Test formats and return those that parse the date correctly
	const validFormats = testFormats(dates, candidateFormats, format);

	return validFormats;
}
