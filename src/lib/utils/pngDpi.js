// Embed a resolution (DPI) in a PNG.
//
// A canvas PNG carries no pHYs chunk, so every reader falls back to its own default,
// which is 72 dpi in Preview, Photoshop, Word and most journal submission systems. The
// export already draws at the chosen DPI (85 mm at 300 dpi is 1004 px wide), but without
// pHYs that file opens as a 354 mm figure. Writing pHYs makes the pixel count and the
// stated resolution agree, so the figure opens at its intended physical size.
//
// PNG layout (ISO/IEC 15948, sections 5.3 and 11.3.5.3): an 8-byte signature, then chunks of
// [length:u32][type:4][data:length][crc32 over type+data]. pHYs holds pixels per unit on
// each axis (u32 x2) and a unit byte (1 = metre). It must precede the first IDAT; it is
// placed straight after IHDR, and any existing pHYs is replaced rather than duplicated.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const INCHES_PER_METRE = 1 / 0.0254;

/** @type {Uint32Array|null} */
let crcTable = null;
/** @param {Uint8Array} bytes @param {number} start @param {number} end */
function crc32(bytes, start, end) {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	const table = crcTable;
	let c = 0xffffffff;
	for (let i = start; i < end; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * Pixels per metre for a DPI, as PNG stores it (rounded to an integer).
 * @param {number} dpi
 */
export function dpiToPixelsPerMetre(dpi) {
	return Math.round(dpi * INCHES_PER_METRE);
}

/** @param {Uint8Array} bytes */
function isPng(bytes) {
	return bytes && bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * A copy of `bytes` with a pHYs chunk stating `dpi` on both axes.
 *
 * Returns the input unchanged when it is not a PNG or the DPI is not a positive finite
 * number, so a caller never loses the image over its metadata.
 *
 * @param {Uint8Array} bytes a PNG file
 * @param {number} dpi
 * @returns {Uint8Array}
 */
export function setPngDpi(bytes, dpi) {
	if (!isPng(bytes) || !(Number.isFinite(dpi) && dpi > 0)) return bytes;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// Walk the chunks: find the end of IHDR and any existing pHYs.
	let offset = 8;
	let afterIHDR = -1;
	let phys = null; // [start, end) of an existing pHYs chunk
	while (offset + 8 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const end = offset + 12 + length;
		if (end > bytes.length) return bytes; // truncated: leave it alone
		if (type === 'IHDR') afterIHDR = end;
		else if (type === 'pHYs') phys = [offset, end];
		else if (type === 'IDAT' || type === 'IEND') break;
		offset = end;
	}
	if (afterIHDR < 0) return bytes;

	const ppm = dpiToPixelsPerMetre(dpi);
	const chunk = new Uint8Array(21);
	const cv = new DataView(chunk.buffer);
	cv.setUint32(0, 9);
	chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
	cv.setUint32(8, ppm);
	cv.setUint32(12, ppm);
	chunk[16] = 1; // unit: metre
	cv.setUint32(17, crc32(chunk, 4, 17));

	const [cutStart, cutEnd] = phys ?? [afterIHDR, afterIHDR];
	const out = new Uint8Array(bytes.length - (cutEnd - cutStart) + chunk.length);
	out.set(bytes.subarray(0, cutStart), 0);
	out.set(chunk, cutStart);
	out.set(bytes.subarray(cutEnd), cutStart + chunk.length);
	return out;
}

/**
 * The DPI stated in a PNG's pHYs chunk, or null when it has none (or states no unit).
 *
 * @param {Uint8Array} bytes
 * @returns {number|null}
 */
export function readPngDpi(bytes) {
	if (!isPng(bytes)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 8;
	while (offset + 8 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		if (type === 'pHYs' && length === 9) {
			if (bytes[offset + 16] !== 1) return null;
			return view.getUint32(offset + 8) / INCHES_PER_METRE;
		}
		if (type === 'IDAT' || type === 'IEND') return null;
		offset += 12 + length;
	}
	return null;
}

// base64 <-> bytes, in chunks so a large figure does not overflow the call stack.

/** @param {string} b64 */
function base64ToBytes(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
/** @param {Uint8Array} bytes */
function bytesToBase64(bytes) {
	let bin = '';
	const step = 0x8000;
	for (let i = 0; i < bytes.length; i += step) {
		bin += String.fromCharCode(...bytes.subarray(i, i + step));
	}
	return btoa(bin);
}

/**
 * `setPngDpi` for a `data:image/png;base64,` URL (what canvas.toDataURL returns).
 *
 * @param {string} dataUrl
 * @param {number} dpi
 * @returns {string}
 */
export function setPngDataUrlDpi(dataUrl, dpi) {
	const prefix = 'data:image/png;base64,';
	if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) return dataUrl;
	const bytes = base64ToBytes(dataUrl.slice(prefix.length));
	const out = setPngDpi(bytes, dpi);
	return out === bytes ? dataUrl : prefix + bytesToBase64(out);
}
