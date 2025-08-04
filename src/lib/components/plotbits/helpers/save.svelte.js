//TODO: scale issue when saving
//TODO: jpeg background is black ~ ?
export function convertToImage(svgId, filetype = 'png') {
	if (filetype == 'svg') {
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
		}
		// } else if (filetype == 'jpeg') {
		// 	DataUrl = canvas.toDataURL('image/jpeg', 0.9); // For JPEG, quality 0-1
		// }

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

export function saveMultipleAsImage(svgIds, filetype = 'png') {
	//get each of the plots to convert
	let toConvert = [];
	for (const svgId of svgIds) {
		if (document.getElementById('plot' + svgId)) {
			//check that there is a plot (not a table or erroneous value)
			toConvert.push(document.getElementById('plot' + svgId));
		}
	}

	//calculate the total width and height of the new SVG
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	const positions = [];

	toConvert.forEach((svg) => {
		const rect = svg.getBoundingClientRect();
		const x = rect.left + window.scrollX;
		const y = rect.top + window.scrollY;
		positions.push({ x, y, width: rect.width, height: rect.height });
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + rect.width);
		maxY = Math.max(maxY, y + rect.height);
	});

	//make a new svg object for them
	const totalWidth = maxX - minX;
	const totalHeight = maxY - minY;
	const newSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	newSvg.setAttribute('width', totalWidth);
	newSvg.setAttribute('height', totalHeight);
	newSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	newSvg.setAttribute('id', crypto.randomUUID());

	//create a defs element for any styles or definitions
	const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
	newSvg.appendChild(defs);

	//copy the contents
	toConvert.forEach((svg, index) => {
		// Adjust position relative to the top-left corner of the combined bounding box
		const { x, y } = positions[index];
		const translateX = x - minX;
		const translateY = y - minY;
		// Clone SVG content
		const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		group.setAttribute('transform', `translate(${translateX}, ${translateY})`);
		Array.from(svg.children).forEach((child) => {
			if (child.tagName.toLowerCase() === 'defs') {
				// Merge <defs> content (handle ID conflicts if needed)
				Array.from(child.children).forEach((def) => {
					const newId = `${def.id}-svg${index}`;
					def.setAttribute('id', newId);
					defs.appendChild(def.cloneNode(true));
					// Update references to this ID in the SVG
					svg.querySelectorAll(`[fill*="url(#${def.id}"]`).forEach((el) => {
						el.setAttribute('fill', el.getAttribute('fill').replace(`#${def.id}`, `#${newId}`));
					});
				});
			} else {
				group.appendChild(child.cloneNode(true));
			}
		});
		newSvg.appendChild(group);
	});

	document.body.appendChild(newSvg);
	convertToImage(newSvg.id, filetype);
	document.body.removeChild(newSvg);
}
