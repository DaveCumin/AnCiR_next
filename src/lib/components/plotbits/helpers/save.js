export function convertToImage(svgId, filetype = 'png') {
	if ((filetype = 'svg')) {
		exportSVG(svgId);
		return;
	}
	// Get the SVG element
	const svg = document.getElementById(svgId);

	// Serialize the SVG to a string
	const serializer = new XMLSerializer();
	const svgString = serializer.serializeToString(svg);

	// Create an image to hold the SVG
	const img = new Image();
	const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(svgBlob);
	img.src = url;

	// Wait for the image to load
	img.onload = function () {
		// Create a canvas
		const canvas = document.createElement('canvas');
		canvas.width = svg.getAttribute('width');
		canvas.height = svg.getAttribute('height');
		const context = canvas.getContext('2d');

		// Draw the SVG image onto the canvas
		context.drawImage(img, 0, 0);

		// Convert canvas to PNG (or JPEG)
		let DataUrl;
		if (filetype == 'png') {
			DataUrl = canvas.toDataURL('image/png'); // For PNG
		} else if (filetype == 'jpeg') {
			DataUrl = canvas.toDataURL('image/jpeg', 0.9); // For JPEG, quality 0-1
		}

		// Create a download link
		const link = document.createElement('a');
		link.href = DataUrl;
		link.download = svgId + '.' + filetype; // File name
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		// Clean up
		URL.revokeObjectURL(url);
	};
}

function exportSVG(svgId) {
	const svgString = document.getElementById(svgId).outerHTML;
	const svgBlob = new Blob([svgString], {
		type: 'image/svg+xml;charset=utf-8'
	});
	const svgUrl = URL.createObjectURL(svgBlob);

	const link = document.createElement('a');
	link.href = svgUrl;
	link.download = svgId + '.svg';
	document.body.appendChild(link);
	link.click();

	URL.revokeObjectURL(svgUrl);
}
