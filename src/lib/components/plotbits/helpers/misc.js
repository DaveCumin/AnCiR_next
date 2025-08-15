export function isValidStroke(value) {
	console.log('start isvalid with ', value);
	// Handle null, undefined, or empty string
	if (!value || typeof value !== 'string') {
		return false;
	}

	// Trim whitespace
	const trimmed = value.trim();

	// Allow 'solid' as a special case
	if (trimmed.toLowerCase() === 'solid') {
		return true;
	}

	// Check if it matches the stroke-dasharray pattern
	// Pattern: numbers separated by commas and/or spaces
	const strokePattern = /^[\d\s,\.]+$/;

	if (!strokePattern.test(trimmed)) {
		return false;
	}

	// Split by comma and/or whitespace, filter out empty strings
	const values = trimmed.split(/[,\s]+/).filter((val) => val.length > 0);

	// Must have at least one value
	if (values.length === 0) {
		return false;
	}

	console.log('values ', values);
	// Check that all values are valid positive numbers
	for (const val of values) {
		const num = parseFloat(val);
		if (isNaN(num) || num < 0) {
			return false;
		}
	}

	return true;
}
