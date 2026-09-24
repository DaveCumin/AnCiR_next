import { describe, it, expect } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { setPngDpi, readPngDpi, setPngDataUrlDpi, dpiToPixelsPerMetre } from './pngDpi.js';

/** A real 1x1 RGBA PNG, built chunk by chunk, optionally with a pHYs already present. */
function tinyPng({ phys = null } = {}) {
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(1, 0);
	ihdr.writeUInt32BE(1, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
	if (phys) {
		const p = Buffer.alloc(9);
		p.writeUInt32BE(phys, 0);
		p.writeUInt32BE(phys, 4);
		p[8] = 1;
		parts.push(chunk('pHYs', p));
	}
	parts.push(chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))));
	parts.push(chunk('IEND', Buffer.alloc(0)));
	return new Uint8Array(Buffer.concat(parts));
}

/** Every chunk's type, in order, with its CRC checked. */
function chunks(bytes) {
	const buf = Buffer.from(bytes);
	const out = [];
	let o = 8;
	while (o < buf.length) {
		const len = buf.readUInt32BE(o);
		const type = buf.toString('ascii', o + 4, o + 8);
		const crcOk = buf.readUInt32BE(o + 8 + len) === crc32(buf.subarray(o + 4, o + 8 + len));
		out.push({ type, crcOk });
		o += 12 + len;
	}
	return out;
}

describe('setPngDpi', () => {
	it('a canvas-style PNG (no pHYs) reads as having no DPI: the 72 dpi defect', () => {
		expect(readPngDpi(tinyPng())).toBeNull();
	});

	it('writes a valid pHYs chunk straight after IHDR, before IDAT', () => {
		const out = setPngDpi(tinyPng(), 300);
		const list = chunks(out);
		expect(list.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
		expect(list.every((c) => c.crcOk)).toBe(true);
		expect(readPngDpi(out)).toBeCloseTo(300, 1);
	});

	it('stores pixels per metre, as the spec requires (300 dpi = 11811 px/m)', () => {
		expect(dpiToPixelsPerMetre(300)).toBe(11811);
		expect(dpiToPixelsPerMetre(600)).toBe(23622);
	});

	it('replaces an existing pHYs rather than adding a second one', () => {
		const out = setPngDpi(tinyPng({ phys: 2835 }), 600);
		expect(chunks(out).filter((c) => c.type === 'pHYs')).toHaveLength(1);
		expect(readPngDpi(out)).toBeCloseTo(600, 1);
	});

	it('leaves non-PNG input and a nonsense DPI untouched', () => {
		const junk = new Uint8Array([1, 2, 3]);
		expect(setPngDpi(junk, 300)).toBe(junk);
		const png = tinyPng();
		expect(setPngDpi(png, 0)).toBe(png);
		expect(setPngDpi(png, NaN)).toBe(png);
	});

	it('works on a data URL, as canvas.toDataURL returns it', () => {
		const url = 'data:image/png;base64,' + Buffer.from(tinyPng()).toString('base64');
		const out = setPngDataUrlDpi(url, 300);
		expect(out.startsWith('data:image/png;base64,')).toBe(true);
		const bytes = new Uint8Array(Buffer.from(out.split(',')[1], 'base64'));
		expect(readPngDpi(bytes)).toBeCloseTo(300, 1);
		expect(setPngDataUrlDpi('data:image/svg+xml;base64,AAAA', 300)).toBe(
			'data:image/svg+xml;base64,AAAA'
		);
	});
});
