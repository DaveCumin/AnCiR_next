/**
 * Classroom-session generator (NOT a normal test).
 *
 * Mints the high-school "classroom" lesson sessions using the real
 * Column/Plot/TableProcess classes and the same serialization the app uses
 * (outputCoreAsJson), then writes them to static/sessions/classroom/ with an
 * index.json manifest. Each lesson = simulated data with a KNOWN ground truth +
 * the analysis graph for the concept + a "For teachers" Note carrying the
 * curriculum mapping. The paired guided tours (src/lib/tours/learn-*.js) load
 * these files at runtime.
 *
 * Run it explicitly (gated so it never runs in the normal suite):
 *   GEN_CLASSROOM=1 npx vitest run src/lib/_classroom/generateClassroom.svelte.test.js
 *
 * Design: see docs/superpowers/specs/2026-06-16-ancir-classroom-sessions-design.md
 * and docs/classroom/curriculum-plan.md (verified curriculum references).
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj, outputCoreAsJson } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { TableProcess } from '$lib/core/TableProcess.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

const OUT_DIR = join(process.cwd(), 'static', 'sessions', 'classroom');

// --- deterministic synthetic data (no Math.random; reproducible files) --------
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function normal(rng, mean = 0, sd = 1) {
	const u = Math.max(rng(), 1e-12);
	const v = rng();
	return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// Showcase palette: raw data in navy, fitted curve in terracotta.
const RAW_COLOUR = '#234154';
const FIT_COLOUR = '#BE796B';

function resetCore() {
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.notes = [];
	core.nodeNotes = {};
	core.orphanProcesses = [];
	core.storedValues = {};
	core.rawData = new Map();
}

// Column auto-ids share the global Column counter, so columns created here never
// collide with output columns the TableProcess constructor allocates.
function mkCol(type, values, name) {
	const c = new Column({ type, data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	if (type === 'time') c.timeFormat = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
	core.data.push(c);
	return c.id;
}

function addPlot(type, name, inputs) {
	const p = new Plot({ name, type });
	const data = {};
	for (const [k, colId] of Object.entries(inputs)) data[k] = { refId: colId };
	p.plot.addData(data);
	pushObj(p);
	return p;
}

// Scatterplot from explicit series; each: { x, y, label, kind:'points'|'line', colour }.
function addScatter(name, series) {
	const p = new Plot({ name, type: 'scatterplot' });
	for (const s of series) {
		const isLine = s.kind === 'line';
		p.plot.addData({
			x: { refId: s.x },
			y: { refId: s.y },
			label: s.label,
			line: { colour: s.colour, draw: isLine, strokeWidth: isLine ? 2.5 : 2, stroke: 'solid' },
			points: { colour: s.colour, draw: !isLine, radius: 3, shape: 'circle' }
		});
	}
	pushObj(p);
	return p;
}

let noteSeq = 0;
function teacherNote(text, { x = 40, y = 40, width = 380, height = 240 } = {}) {
	core.notes.push({ id: `note_${++noteSeq}`, text, x, y, width, height });
}

// Same DEV-only guard sidestep the demo generator uses: pre-set customName on the
// plot-wrapper columns so the `name` $derived short-circuits during serialization.
function prewarmWrapperNames() {
	for (const plot of core.plots) {
		for (const series of plot.plot?.data ?? []) {
			for (const field of ['x', 'y', 'column', 'time', 'values']) {
				const w = series?.[field];
				if (w && typeof w === 'object' && 'refId' in w && w.customName == null) {
					const real = core.data.find((c) => c.id === w.refId);
					w.customName = real ? `${real.name}` : 'col';
				}
			}
		}
	}
}

// Shared footer for every teacher note. NZ-focused in-app; the full international
// mapping (AP / A-level / IB) lives in the handbook + curriculum plan.
const NCEA_TRANSITION =
	'NCEA is transitional: L1 removed from 2028; NZCE (Yr12) 2029; NZACE (Yr13) 2030. ' +
	'Standards below remain valid through the change.';
const HANDBOOK_REF = 'Full mapping + worked walkthrough: classroom-handbook.html';

// --- the four lessons ---------------------------------------------------------
const LESSONS = [
	{
		id: 'learn-hidden-rhythm',
		name: 'Find the hidden rhythm',
		yearLevel: 'NZ Yr 11–13',
		description:
			'A noisy ~24 h signal (7 days, hourly). Use the periodogram to recover the hidden period.',
		curriculum: [
			{
				framework: 'NZC',
				code: 'M7-2 / M8-7',
				title: 'Graphs & modelling of periodic functions',
				confidence: 'snippet-verified'
			},
			{
				framework: 'NZC',
				code: 'S8-1',
				title: 'Statistical enquiry cycle (time series)',
				confidence: 'snippet-verified'
			},
			{
				framework: 'NCEA',
				code: 'AS91575',
				title: 'Apply trigonometric methods (L3, 4cr, Internal)',
				confidence: 'verified'
			},
			{
				framework: 'NCEA',
				code: 'AS91580',
				title: 'Investigate time series data (L3, 4cr, Internal)',
				confidence: 'verified'
			}
		],
		async build() {
			const PERIOD = 24;
			const NOISE = 20;
			// Use a Simulate-data node as the source so the student can open it and
			// turn the Noise slider up (the lesson's "try this"). The node writes a
			// time column + a values column we plot and analyse.
			const sim = new TableProcess(
				{
					name: 'SimulatedData',
					args: {
						startTime: new Date(Date.UTC(2024, 0, 1)).toISOString(),
						sections: [
							{
								duration_hours: 24 * 7,
								rhythmPeriod_hours: PERIOD,
								rhythmPhase_hours: 0,
								rhythmAmplitude: 40,
								noiseEnabled: true,
								noiseMode: 'add',
								noiseAmplitude: NOISE
							}
						],
						samplingPeriod_hours: 1,
						out: { time: -1, values: -1 }
					}
				},
				null
			);
			pushObj(sim);
			await sim.doProcess();
			const t = sim.args.out.time;
			const v = sim.args.out.values;
			const sc = addScatter('Raw signal', [
				{ x: t, y: v, label: 'Activity', kind: 'points', colour: RAW_COLOUR }
			]);
			sc.x = 760;
			sc.y = 60;
			const pg = addPlot('periodogram', 'Activity periodogram', { time: t, values: v });
			pg.x = 760;
			pg.y = 440;
			teacherNote(
				`FIND THE HIDDEN RHYTHM — ${this.yearLevel}\n\n` +
					`Hidden truth: the Simulate-data node builds a ${PERIOD} h rhythm (active half ` +
					`the cycle at amplitude 40, low otherwise) with random noise up to ${NOISE}. The ` +
					`raw scatter looks messy, but the periodogram peak should sit at ${PERIOD} h.\n\n` +
					`Try it live: open the Simulate-data node and raise the Noise slider — the scatter ` +
					`gets messier and the periodogram peak shrinks and broadens.\n\n` +
					`Curriculum (NZ): NZC M7-2 / M8-7 (periodic functions), S8-1 (time series); ` +
					`NCEA AS91575 (trig methods), AS91580 (time series). Physics: waves.\n${NCEA_TRANSITION}\n\n${HANDBOOK_REF}`
			);
		}
	},
	{
		id: 'learn-night-owl',
		name: 'Am I a night owl?',
		yearLevel: 'NZ Yr 9–13',
		description:
			'A week of activity for one "person". Read the actogram and decide: morning lark or evening owl?',
		curriculum: [
			{
				framework: 'NZC',
				code: 'Living World — Life processes (L7/8)',
				title: 'How animals carry out life processes',
				confidence: 'snippet-verified'
			},
			{
				framework: 'NCEA',
				code: 'AS91604',
				title: 'How an animal maintains a stable internal environment (L3, 3cr, Internal)',
				confidence: 'verified'
			}
		],
		build() {
			const rng = mulberry32(202);
			const PEAK_HOUR = 22; // evening type (owl): activity peaks ~22:00
			const hours = seq(24 * 7, (i) => i);
			// peak at PEAK_HOUR: sin peaks 6 h after its phase ref → shift by PEAK_HOUR-6
			const activity = hours.map((h) =>
				Math.max(
					0,
					8 + 55 * Math.sin((2 * Math.PI * (h - (PEAK_HOUR - 6))) / 24) + normal(rng, 10, 8)
				)
			);
			const t = mkCol('number', hours, 'hour');
			const v = mkCol('number', activity, 'activity');
			addPlot('actogram', 'Activity actogram', { time: t, values: v });
			teacherNote(
				`AM I A NIGHT OWL? — ${this.yearLevel}\n\n` +
					`Hidden truth: this is an EVENING type (owl) — activity peaks at about ` +
					`${PEAK_HOUR}:00 and rest is in the early hours. Frame the biology around ` +
					`homeostasis/feedback, with the body clock (circadian rhythm) as the worked example.\n\n` +
					`Curriculum (NZ): NZC Living World — Life processes (L7/8); NCEA AS91604 (homeostasis). ` +
					`Intl: AP Bio 8.1, IB Bio D3.3.\n${NCEA_TRANSITION}\n\n${HANDBOOK_REF}`
			);
		}
	},
	{
		id: 'learn-difference-real',
		name: 'Is the difference real?',
		yearLevel: 'NZ Yr 11–13',
		description:
			'Weekday vs weekend activity. Compare the groups and decide whether the difference is real or chance.',
		curriculum: [
			{
				framework: 'NZC',
				code: 'S7-1 / S8-1',
				title: 'Statistical enquiry cycle & inference',
				confidence: 'snippet-verified'
			},
			{
				framework: 'NCEA',
				code: 'AS91264',
				title: 'Use statistical methods to make an inference (L2, 4cr, Internal)',
				confidence: 'verified'
			},
			{
				framework: 'NCEA',
				code: 'AS91582',
				title: 'Use statistical methods to make a formal inference (L3, 4cr, Internal)',
				confidence: 'verified'
			}
		],
		build() {
			const rng = mulberry32(303);
			const PER_GROUP = 60;
			const WEEKDAY_MEAN = 50;
			const WEEKEND_MEAN = 62; // a real built-in difference of 12 units
			const SD = 12;
			const group = [];
			const value = [];
			for (let i = 0; i < PER_GROUP; i++) {
				group.push('Weekday');
				value.push(normal(rng, WEEKDAY_MEAN, SD));
			}
			for (let i = 0; i < PER_GROUP; i++) {
				group.push('Weekend');
				value.push(normal(rng, WEEKEND_MEAN, SD));
			}
			const g = mkCol('category', group, 'day type');
			const y = mkCol('number', value, 'activity');
			addPlot('boxplot', 'Activity by day type', { x: g, y });
			const tp = new TableProcess(
				{
					name: 'GroupComparison',
					args: { xIN: g, yIN: [y], method: 'auto', alpha: 0.05, postHocEnabled: true, out: {} }
				},
				null
			);
			pushObj(tp);
			teacherNote(
				`IS THE DIFFERENCE REAL? — ${this.yearLevel}\n\n` +
					`Hidden truth: a real difference IS built in — weekend mean (${WEEKEND_MEAN}) is ` +
					`${WEEKEND_MEAN - WEEKDAY_MEAN} units above weekday (${WEEKDAY_MEAN}), sd ${SD}, ` +
					`n=${PER_GROUP}/group. Teaching point: a visible gap is not automatically a real one; ` +
					`shrink n and the test can stop being significant.\n\n` +
					`Curriculum (NZ): NZC S7-1 / S8-1 (enquiry cycle, inference); NCEA AS91264 (L2 inference), ` +
					`AS91582 (L3 formal inference).\n${NCEA_TRANSITION}\n\n${HANDBOOK_REF}`
			);
		}
	},
	{
		id: 'learn-sine-waves',
		name: 'Sine waves are everywhere',
		yearLevel: 'NZ Yr 12–13',
		description:
			'Fit a single cosine to a rhythm. Read amplitude, phase, midline, period and R²; compare with the truth.',
		curriculum: [
			{
				framework: 'NZC',
				code: 'M8-7 / M7-2',
				title: 'Trig equations & graphs (amplitude/period/phase)',
				confidence: 'snippet-verified'
			},
			{
				framework: 'NCEA',
				code: 'AS91575',
				title: 'Apply trigonometric methods (L3, 4cr, Internal)',
				confidence: 'verified'
			}
		],
		async build() {
			const rng = mulberry32(404);
			const PERIOD = 24;
			const AMP = 40;
			const MESOR = 50;
			const ACRO_HOUR = 8; // cosine peaks (acrophase) at 08:00
			const hours = seq(24 * 7, (i) => i);
			const signal = hours.map(
				(h) => MESOR + AMP * Math.cos((2 * Math.PI * (h - ACRO_HOUR)) / PERIOD) + normal(rng, 0, 5)
			);
			const t = mkCol('number', hours, 'hour');
			const v = mkCol('number', signal, 'signal');
			const tp = new TableProcess(
				{
					name: 'Cosinor',
					args: {
						xIN: t,
						yIN: [v],
						Ncurves: 1,
						outputX: -1,
						useFixedPeriod: true,
						fixedPeriod: PERIOD,
						nHarmonics: 1,
						alpha: 0.05,
						preProcesses: [],
						out: { cosinorx: -1 }
					}
				},
				null
			);
			pushObj(tp);
			// Run the fit so its fitted curve is baked into the session, then plot
			// the raw points with the fitted cosine drawn through them as a line.
			await tp.doProcess();
			const xOut = tp.args.out.cosinorx;
			const yOut = tp.args.out['cosinory_' + v];
			const sc = addScatter('Signal vs hour', [
				{ x: t, y: v, label: 'Data', kind: 'points', colour: RAW_COLOUR },
				{ x: xOut, y: yOut, label: 'Cosinor fit', kind: 'line', colour: FIT_COLOUR }
			]);
			sc.x = 760;
			sc.y = 80;
			teacherNote(
				`SINE WAVES ARE EVERYWHERE — ${this.yearLevel}\n\n` +
					`Hidden truth: midline (mesor) ${MESOR}, amplitude ${AMP}, period ${PERIOD} h, ` +
					`acrophase (peak) at ${ACRO_HOUR}:00, plus noise (sd 5). The Cosinor fit should ` +
					`recover these; R² near 1 means the cosine model fits well.\n\n` +
					`Curriculum (NZ): NZC M8-7 / M7-2 (trig modelling & graphs); NCEA AS91575 (trig methods). ` +
					`Intl: AP Precalc trig, A-level Trig, IB composite trig a·sin(b(x+c))+d.\n${NCEA_TRANSITION}\n\n${HANDBOOK_REF}`
			);
		}
	}
];

function manifestEntry(lesson, file) {
	const showcases = [...new Set(core.plots.map((p) => p.type))];
	return {
		id: lesson.id,
		name: lesson.name,
		family: 'Classroom',
		description: lesson.description,
		url: `sessions/classroom/${file}`,
		kind: 'lesson',
		yearLevel: lesson.yearLevel,
		curriculum: lesson.curriculum,
		showcases,
		keywords: [lesson.name, lesson.description, 'classroom', lesson.yearLevel, ...showcases]
			.filter(Boolean)
			.join(' ')
			.toLowerCase()
	};
}

describe.runIf(process.env.GEN_CLASSROOM)('generate classroom sessions', () => {
	it('writes classroom lesson JSON + index.json', async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();

		const manifest = [];
		for (const lesson of LESSONS) {
			resetCore();
			noteSeq = 0;
			await lesson.build();
			prewarmWrapperNames();
			const file = `${lesson.id}.json`;
			writeFileSync(join(OUT_DIR, file), outputCoreAsJson(), 'utf8');
			manifest.push(manifestEntry(lesson, file));
		}

		const index = { version: 1, count: manifest.length, sessions: manifest };
		writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
		// eslint-disable-next-line no-console
		console.log(`GENERATED ${manifest.length} classroom lessons -> ${OUT_DIR}`);
	});
});
