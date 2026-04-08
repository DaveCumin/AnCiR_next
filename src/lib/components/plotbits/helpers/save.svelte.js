import { appState } from '$lib/core/core.svelte.js';
import { core } from '$lib/core/core.svelte';
import { tick } from 'svelte';
import { showError } from '$lib/core/notifications.svelte.js';

/**
 * Convert headers and rows to a CSV string and trigger a download.
 * @param {number} plotId - The plot index in core.plots
 */
export function saveDataAsCSV(plotId) {
	const plot = core.plots[plotId];
	if (!plot || !plot.plot) return;

	const plotData = plot.plot;
	if (typeof plotData.getDownloadData !== 'function') return;

	const { headers, rows } = plotData.getDownloadData();
	if (!headers || !rows || rows.length === 0) return;

	const csvContent = [
		headers.map(escapeCSV).join(','),
		...rows.map((row) => row.map(escapeCSV).join(','))
	].join('\n');

	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = (plot.name || 'plot_data').replace(/[/\\:*?"<>|]/g, '_') + '.csv';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

function escapeCSV(value) {
	if (value == null) return '';
	const str = String(value);
	if (str.includes(',') || str.includes('"') || str.includes('\n')) {
		return '"' + str.replace(/"/g, '""') + '"';
	}
	return str;
}

export async function convertToImage(svgId, filetype = 'png') {
	//RESET THE ZOOM
	const Zoom = appState.canvasScale;
	appState.canvasScale = 1;
	// await tick();
	await tick();

	const plotName = core.plots[Number(svgId.replace('plot', ''))]?.name ?? svgId;

	if (filetype == 'svg') {
		exportSVG(svgId, plotName);
		//reset the zoom
		appState.canvasScale = Zoom;
		return;
	}
	// Get the SVG element
	const svg = document.getElementById(svgId);

	// Get SVG dimensions - handle both explicit attributes and viewBox
	let svgWidth = parseFloat(svg.getAttribute('width'));
	let svgHeight = parseFloat(svg.getAttribute('height'));

	// Check for viewBox if width/height not set
	if (!svgWidth || !svgHeight) {
		const viewBox = svg.getAttribute('viewBox');
		if (viewBox) {
			const parts = viewBox.split(/[\s,]+/);
			svgWidth = parseFloat(parts[2]);
			svgHeight = parseFloat(parts[3]);
		}
	}

	// Fallback to bounding box if still not found
	if (!svgWidth || !svgHeight) {
		try {
			const bbox = svg.getBBox();
			svgWidth = bbox.width;
			svgHeight = bbox.height;
		} catch (e) {
			console.error('Could not determine SVG dimensions:', e);
			showError('Error: Could not determine plot dimensions');
			return;
		}
	}

	// Serialize the SVG to a string
	const serializer = new XMLSerializer();
	const svgString = serializer.serializeToString(svg);

	// Create an image to hold the SVG
	const img = new Image();
	const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
	const url = `data:image/svg+xml;base64,${svgBase64}`;
	img.src = url;

	// Wait for the image to load
	img.onload = function () {
		// Create a canvas with proper sizing
		const canvas = document.createElement('canvas');
		const scaledWidth = svgWidth;
		const scaledHeight = svgHeight;

		canvas.width = Math.round(scaledWidth);
		canvas.height = Math.round(scaledHeight);

		const context = canvas.getContext('2d');
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';

		// Draw the SVG image onto the canvas
		context.drawImage(img, 0, 0, canvas.width, canvas.height);

		// Convert canvas to PNG
		let DataUrl;
		if (filetype == 'png') {
			DataUrl = canvas.toDataURL('image/png'); // For PNG
		}

		// Create a download link
		const link = document.createElement('a');
		link.href = DataUrl;

		link.download = plotName + '.' + filetype; // File name
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		// Clean up
		URL.revokeObjectURL(url);
	};

	//reset the zoom
	appState.canvasScale = Zoom;
}

function exportSVG(svgId, plotName) {
	const svgString = document.getElementById(svgId).outerHTML;
	const svgBlob = new Blob([svgString], {
		type: 'image/svg+xml;charset=utf-8'
	});
	const svgUrl = URL.createObjectURL(svgBlob);

	const link = document.createElement('a');
	link.href = svgUrl;
	link.download = plotName + '.svg';
	document.body.appendChild(link);
	link.click();

	URL.revokeObjectURL(svgUrl);
}

export function saveMultipleAsIndividuals(svgIds, filetype = 'png') {
	for (const svgId of svgIds) {
		if (document.getElementById('plot' + svgId)) {
			convertToImage('plot' + svgId, filetype);
		}
	}
}
export async function saveMultipleAsImage(svgIds, filetype = 'png') {
	//RESET THE ZOOM
	const Zoom = appState.canvasScale;
	appState.canvasScale = 1;
	// await tick();
	await tick();

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
		const x = rect.left;
		const y = rect.top;
		positions.push({
			x,
			y,
			width: rect.width,
			height: rect.height
		});
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
	await convertToImage(newSvg.id, filetype);
	document.body.removeChild(newSvg);

	//reset the zoom
	appState.canvasScale = Zoom;
}
