/**
 * Guard test for the classroom lesson tours: each tour module is importable,
 * exports a well-formed `tour`, loads its lesson in step 0, and points at a real
 * session file under static/sessions/classroom/. Importing the modules also
 * exercises the loadLesson → importJson import chain, so a broken import fails here.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { tour as hiddenRhythm } from './learnHiddenRhythm.js';
import { tour as nightOwl } from './learnNightOwl.js';
import { tour as differenceReal } from './learnDifferenceReal.js';
import { tour as sineWaves } from './learnSineWaves.js';

const TOURS = [hiddenRhythm, nightOwl, differenceReal, sineWaves];
const DIR = join(process.cwd(), 'static', 'sessions', 'classroom');

describe('classroom lesson tours', () => {
	it('every tour is well-formed and loads its lesson first', () => {
		for (const t of TOURS) {
			expect(t.id).toMatch(/^learn-/);
			expect(typeof t.name).toBe('string');
			expect(Array.isArray(t.steps) && t.steps.length > 0).toBe(true);
			expect(typeof t.order).toBe('number');
			// Step 0 loads the lesson via beforeShow.
			expect(typeof t.steps[0].beforeShow).toBe('function');
			// Every step can advance.
			for (const s of t.steps) expect(s.advance).toBeTruthy();
		}
	});

	it('tour ids and orders are unique and sit after the shipped onboarding tours', () => {
		const ids = TOURS.map((t) => t.id);
		const orders = TOURS.map((t) => t.order);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(orders).size).toBe(orders.length);
		// gettingStarted=1, actigraphyQuickstart=2 ship first.
		expect(Math.min(...orders)).toBeGreaterThan(2);
	});

	it('each tour id maps to an existing lesson session file', () => {
		for (const t of TOURS) {
			expect(existsSync(join(DIR, `${t.id}.json`)), `${t.id}.json exists`).toBe(true);
		}
	});
});
