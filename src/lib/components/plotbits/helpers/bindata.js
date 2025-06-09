export function binData(x, y, B, Bstart = 0) {
	// Initialize output arrays
	const bins = [];
	const y_out = [];

	// Calculate bin edges starting from Bstart
	let start = Bstart;
	let end = start + B;

	// Iterate through x and y to bin values
	while (start < Math.max(...x)) {
		// Find indices of x values that fall within the current bin
		let indices = x.map((val, i) => (val >= start && val < end ? i : -1)).filter((i) => i !== -1);

		// If there are values in this bin
		if (indices.length > 0) {
			// Calculate bin center
			bins.push(start + B / 2);

			// Calculate average of y values for this bin
			let ySum = indices.reduce((sum, i) => sum + y[i], 0);
			y_out.push(ySum / indices.length);
		}

		// Move to next bin
		start += B;
		end += B;
	}

	return { bins, y_out };
}
