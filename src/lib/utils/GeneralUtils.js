// get a string instead of a number (A, B, C, ... AA, AB ... )
export function numToString(n) {
	if (n < 0) return;
	let result = '';
	while (true) {
		const remainder = n % 26;
		result = String.fromCharCode(65 + remainder) + result;
		n = Math.floor(n / 26) - 1;
		if (n < 0) break;
	}
	return result;
}
