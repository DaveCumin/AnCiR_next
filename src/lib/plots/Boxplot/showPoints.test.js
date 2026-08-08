// The boxplot's raw-points overlay (showPoints + pointJitter) must round-trip
// through toJSON/fromJSON, and an old session that predates the fields must load
// with the defaults (off, 0.35) rather than undefined.
import { describe, it, expect } from 'vitest';
import { Boxplotclass } from './Boxplot.svelte';

describe('Boxplot showPoints / pointJitter persistence', () => {
	it('defaults: off, jitter 0.35', () => {
		const b = new Boxplotclass(null, null);
		expect(b.showPoints).toBe(false);
		expect(b.pointJitter).toBe(0.35);
	});

	it('round-trips through toJSON/fromJSON', () => {
		const b = new Boxplotclass(null, null);
		b.showPoints = true;
		b.pointJitter = 0.6;
		const json = JSON.parse(JSON.stringify(b.toJSON()));
		const back = Boxplotclass.fromJSON(null, json);
		expect(back.showPoints).toBe(true);
		expect(back.pointJitter).toBe(0.6);
	});

	it('a pointJitter of 0 survives the round-trip (?? not ||)', () => {
		const b = new Boxplotclass(null, null);
		b.showPoints = true;
		b.pointJitter = 0;
		const back = Boxplotclass.fromJSON(null, b.toJSON());
		expect(back.pointJitter).toBe(0);
	});

	it('an old session without the fields loads with the defaults', () => {
		const old = new Boxplotclass(null, null).toJSON();
		delete old.showPoints;
		delete old.pointJitter;
		const back = Boxplotclass.fromJSON(null, old);
		expect(back.showPoints).toBe(false);
		expect(back.pointJitter).toBe(0.35);
	});
});

describe('Boxplot pointSize / pointOpacity persistence', () => {
	it('defaults: radius 2.5, opacity 0.6', () => {
		const b = new Boxplotclass(null, null);
		expect(b.pointSize).toBe(2.5);
		expect(b.pointOpacity).toBe(0.6);
	});

	it('round-trips through toJSON/fromJSON', () => {
		const b = new Boxplotclass(null, null);
		b.pointSize = 4;
		b.pointOpacity = 0.25;
		const back = Boxplotclass.fromJSON(null, JSON.parse(JSON.stringify(b.toJSON())));
		expect(back.pointSize).toBe(4);
		expect(back.pointOpacity).toBe(0.25);
	});

	it('a 0 survives the round-trip (?? not ||)', () => {
		const b = new Boxplotclass(null, null);
		b.pointSize = 0;
		b.pointOpacity = 0;
		const back = Boxplotclass.fromJSON(null, b.toJSON());
		expect(back.pointSize).toBe(0);
		expect(back.pointOpacity).toBe(0);
	});

	it('an old session without the fields loads with the defaults', () => {
		const old = new Boxplotclass(null, null).toJSON();
		delete old.pointSize;
		delete old.pointOpacity;
		const back = Boxplotclass.fromJSON(null, old);
		expect(back.pointSize).toBe(2.5);
		expect(back.pointOpacity).toBe(0.6);
	});
});

describe('Boxplot pointColour persistence', () => {
	it('defaults to null (auto: points follow each box colour)', () => {
		expect(new Boxplotclass(null, null).pointColour).toBe(null);
	});

	it('an explicit colour round-trips', () => {
		const b = new Boxplotclass(null, null);
		b.pointColour = '#123456';
		const back = Boxplotclass.fromJSON(null, JSON.parse(JSON.stringify(b.toJSON())));
		expect(back.pointColour).toBe('#123456');
	});

	it('auto (null) survives the round-trip and old sessions load as auto', () => {
		const b = new Boxplotclass(null, null);
		const back = Boxplotclass.fromJSON(null, JSON.parse(JSON.stringify(b.toJSON())));
		expect(back.pointColour).toBe(null);
		const old = b.toJSON();
		delete old.pointColour;
		expect(Boxplotclass.fromJSON(null, old).pointColour).toBe(null);
	});
});
