// Named figure-style presets: the shape, the validators and the store.
//
// These assert the REPORT as well as the result. A validator that never throws is easy to
// keep green while it silently drops half a file, and the report is the only thing standing
// between "loaded with 3 items dropped" and a user wondering why their style looks wrong.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, appState, appConsts } from '$lib/core/core.svelte.js';
import { privacy, setEphemeral } from '$lib/core/localData.svelte.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { pinAppearance } from '$lib/plots/appearanceIdentity.js';
import {
	normaliseStyleConfig,
	captureStyle,
	saveStyle,
	getStyle,
	listStyles,
	deleteStyle,
	styleExists,
	getActiveStyleName,
	setActiveStyleName,
	forgetAllStyles,
	resolvePalette,
	applyStyleToSession,
	currentPaletteName,
	choosePalette,
	takePendingPalette,
	planStyleRules,
	applyStyleRules,
	STYLE_CONFIG_VERSION
} from './styleConfig.js';

const KNOWN_PALETTE = 'batlowk';

beforeEach(async () => {
	localStorage.clear();
	sessionStorage.clear();
	privacy.ephemeral = false;
	core.seriesAppearance = {};
	core.categoryColours = {};
	core.data = [];
	appState.appColours = [...appConsts.colourPalettes[KNOWN_PALETTE]];
});

/** A minimal valid config. */
function validConfig() {
	return {
		ancirStyleConfig: 1,
		activeStyle: 'Lab default',
		styles: {
			'Lab default': {
				figureStyle: { fontFamily: 'serif', fontSize: 'l', exportDpi: 600 },
				palette: { name: KNOWN_PALETTE, colours: ['#04050A', '#FACCFA'] },
				columns: { control: { colour: { hex: '#8a8a8a' }, shape: 'circle' } },
				groups: { WT: { colour: { hex: '#8a8a8a' } }, KO: { colour: { hex: '#c0392b' } } },
				categories: { treatment: { colour: { hex: '#c0392b' } } }
			}
		}
	};
}

describe('normaliseStyleConfig — what loads', () => {
	it('loads a valid config whole', () => {
		const { config, report } = normaliseStyleConfig(validConfig());
		expect(report.ok).toBe(true);
		expect(report.dropped).toEqual([]);
		expect(report.styleNames).toEqual(['Lab default']);
		expect(report.activeStyle).toBe('Lab default');
		const style = config.styles['Lab default'];
		expect(style.figureStyle.fontFamily).toBe('serif');
		expect(style.figureStyle.fontSize).toBe('l');
		expect(style.figureStyle.exportDpi).toBe(600);
		expect(style.palette).toEqual({ name: KNOWN_PALETTE, colours: ['#04050A', '#FACCFA'] });
		expect(style.groups.KO).toEqual({ colour: { hex: '#c0392b' } });
		expect(style.categories.treatment).toEqual({ colour: { hex: '#c0392b' } });
	});

	it('parses a JSON string, which is how a file will arrive', () => {
		const { config, report } = normaliseStyleConfig(JSON.stringify(validConfig()));
		expect(report.ok).toBe(true);
		expect(config.styles['Lab default'].figureStyle.fontFamily).toBe('serif');
	});

	it('accepts the shorthand colour forms a hand-edited file would use', () => {
		const { config } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			styles: { s: { groups: { WT: { colour: '#8a8a8a' }, KO: '#c0392b' } } }
		});
		// Pinned as hex, NOT re-bound to a palette slot: a config's colour must not become
		// whatever this session's palette happens to hold in that position.
		expect(config.styles.s.groups.WT).toEqual({ colour: { hex: '#8a8a8a' } });
		expect(config.styles.s.groups.KO).toEqual({ colour: { hex: '#c0392b' } });
	});

	it('does not rewrite a palette colour into a slot even when it matches the live palette', () => {
		const { config } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			styles: { s: { groups: { WT: '#04050A' } } }
		});
		expect(config.styles.s.groups.WT).toEqual({ colour: { hex: '#04050A' } });
	});
});

describe('normaliseStyleConfig — hard failures change nothing', () => {
	it('rejects a garbage string as not JSON', () => {
		const { config, report } = normaliseStyleConfig('not a config at all {');
		expect(config).toBeNull();
		expect(report.ok).toBe(false);
		expect(report.reason).toMatch(/not JSON/i);
		expect(report.summary).toMatch(/Not loaded/);
	});

	it('rejects null', () => {
		const { config, report } = normaliseStyleConfig(null);
		expect(config).toBeNull();
		expect(report.ok).toBe(false);
	});

	it('rejects an array, and says it is a list', () => {
		const { config, report } = normaliseStyleConfig([{ ancirStyleConfig: 1 }]);
		expect(config).toBeNull();
		expect(report.reason).toMatch(/list/i);
	});

	it('rejects valid JSON that holds nothing recognisable as a style', () => {
		const { config, report } = normaliseStyleConfig('{"hello":"world"}');
		expect(config).toBeNull();
		expect(report.reason).toMatch(/nothing recognisable/i);
	});

	it('rejects a config whose styles are all unusable, rather than loading an empty one', () => {
		const { config, report } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			styles: { broken: 'a string, not a style' }
		});
		expect(config).toBeNull();
		expect(report.ok).toBe(false);
	});
});

describe('normaliseStyleConfig — what is dropped, and why', () => {
	it('drops a bad figureStyle field by field and names each one', () => {
		const { config, report } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			styles: {
				s: {
					figureStyle: { fontFamily: 'comic', fontSize: 'l', exportDpi: 'lots', wat: 1 }
				}
			}
		});
		expect(report.ok).toBe(true);
		// The valid field survives; the invalid ones fall back to the registry defaults.
		expect(config.styles.s.figureStyle.fontSize).toBe('l');
		expect(config.styles.s.figureStyle.fontFamily).toBe('sans');
		expect(config.styles.s.figureStyle.exportDpi).toBe(300);
		const keys = report.dropped.map((d) => d.key);
		expect(keys).toContain('fontFamily');
		expect(keys).toContain('exportDpi');
		expect(keys).toContain('wat');
		expect(keys).not.toContain('fontSize');
		expect(report.dropped.find((d) => d.key === 'wat').why).toMatch(/unknown/i);
		expect(report.summary).toMatch(/3 items dropped/);
	});

	it('reports a figureStyle that is not an object at all, and uses the defaults', () => {
		const { config, report } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			styles: { s: { figureStyle: 'serif', groups: { WT: '#c0392b' } } }
		});
		expect(config.styles.s.figureStyle.fontFamily).toBe('sans');
		expect(
			report.dropped.some((d) => d.section === 'figureStyle' && /not an object/.test(d.why))
		).toBe(true);
	});

	it("rejects a malformed colour ('nope') and says the colour was not recognised", () => {
		const { config, report } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			styles: {
				s: {
					columns: {
						bad: { colour: 'nope' },
						partly: { colour: { hex: 'nope' }, shape: 'square' },
						fine: { colour: { hex: '#c0392b' } }
					}
				}
			}
		});
		// A rule with nothing usable left is dropped whole.
		expect(config.styles.s.columns.bad).toBeUndefined();
		expect(report.dropped.some((d) => d.key === 'bad')).toBe(true);
		// A rule that keeps its shape but loses its colour must SAY so, or the loss is silent.
		expect(config.styles.s.columns.partly).toEqual({ shape: 'square' });
		expect(report.dropped.some((d) => d.key === 'partly' && /colour/i.test(d.why))).toBe(true);
		expect(config.styles.s.columns.fine).toEqual({ colour: { hex: '#c0392b' } });
	});

	it('drops an unknown marker shape and reports it', () => {
		const { config, report } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			styles: { s: { columns: { a: { colour: '#c0392b', shape: 'dodecahedron' } } } }
		});
		expect(config.styles.s.columns.a).toEqual({ colour: { hex: '#c0392b' } });
		expect(report.dropped.some((d) => d.key === 'a' && /shape/i.test(d.why))).toBe(true);
	});

	it('counts unknown keys at both levels without failing the load', () => {
		const { config, report } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			analysisDefaults: { alpha: 0.05 },
			styles: { s: { groups: { WT: '#c0392b' }, notes: 'hello' } }
		});
		expect(config.styles.s.groups.WT).toBeDefined();
		expect(report.dropped.some((d) => d.key === 'analysisDefaults')).toBe(true);
		expect(report.dropped.some((d) => d.key === 'notes')).toBe(true);
	});

	it('reports a rule table that is not an object', () => {
		const { report } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			styles: { s: { groups: ['WT'], columns: { a: '#c0392b' } } }
		});
		expect(report.dropped.some((d) => d.section === 'groups' && /not an object/.test(d.why))).toBe(
			true
		);
	});

	it('notes an activeStyle naming a style the file does not contain', () => {
		const { config, report } = normaliseStyleConfig({
			ancirStyleConfig: 1,
			activeStyle: 'Missing',
			styles: { s: { groups: { WT: '#c0392b' } } }
		});
		expect(config.activeStyle).toBeNull();
		expect(report.notes.some((n) => /Missing/.test(n))).toBe(true);
	});

	it('loads a config with an unknown top-level version, and says so', () => {
		const { config, report } = normaliseStyleConfig({
			ancirStyleConfig: 99,
			styles: { s: { figureStyle: { fontFamily: 'serif' } } }
		});
		expect(report.ok).toBe(true);
		expect(config.styles.s.figureStyle.fontFamily).toBe('serif');
		expect(config.ancirStyleConfig).toBe(STYLE_CONFIG_VERSION);
		expect(report.notes.some((n) => /99/.test(n))).toBe(true);
	});

	it('notes a missing version field rather than refusing', () => {
		const { report } = normaliseStyleConfig({ styles: { s: { figureStyle: {} } } });
		expect(report.ok).toBe(true);
		expect(report.notes.some((n) => /No version field/i.test(n))).toBe(true);
	});
});

describe('palette resolution', () => {
	it('prefers the name when this build has it, so a preset tracks an improved palette', () => {
		const resolved = resolvePalette({ name: KNOWN_PALETTE, colours: ['#000000'] });
		expect(resolved.source).toBe('name');
		expect(resolved.colours).toEqual(appConsts.colourPalettes[KNOWN_PALETTE]);
		expect(resolved.note).toBeNull();
	});

	it('falls back to the stored colours for an unknown palette name, and says so', () => {
		const resolved = resolvePalette({ name: 'nosuchpalette', colours: ['#04050A', '#FACCFA'] });
		expect(resolved.source).toBe('colours');
		expect(resolved.colours).toEqual(['#04050A', '#FACCFA']);
		expect(resolved.note).toMatch(/nosuchpalette/);
	});

	it('keeps the current palette when the name is unknown and there is no array', () => {
		const resolved = resolvePalette({ name: 'nosuchpalette' });
		expect(resolved.source).toBe('none');
		expect(resolved.colours).toBeNull();
		expect(resolved.note).toMatch(/current palette was kept/);
	});

	it('never lets an unknown palette name reach appColours', () => {
		const before = [...appState.appColours];
		const result = applyStyleToSession(
			{ figureStyle: {}, palette: { name: 'nosuchpalette' } },
			{ setPalette: (colours) => (appState.appColours = colours) }
		);
		expect(appState.appColours).toEqual(before);
		expect(result.palette).toBe('none');
		expect(result.notes.length).toBe(1);
	});

	it('applies the template and the resolved palette', () => {
		let painted = null;
		applyStyleToSession(
			{
				figureStyle: { fontFamily: 'serif', fontSize: 's' },
				palette: { name: 'nosuchpalette', colours: ['#111111', '#222222'] }
			},
			{ setPalette: (colours) => (painted = colours) }
		);
		expect(core.figureStyle.fontFamily).toBe('serif');
		expect(core.figureStyle.fontSize).toBe('s');
		expect(painted).toEqual(['#111111', '#222222']);
	});
});

describe('captureStyle', () => {
	beforeEach(() => {
		core.data = [
			{ id: 1, name: 'activity', groupLabel: 'WT' },
			{ id: 2, name: 'temperature', groupLabel: 'KO' },
			// A record whose column has gone: it lingers deliberately, and has no name to
			// key a rule on, so it must not reach the file.
			{ id: 4, name: '', groupLabel: null }
		];
		core.seriesAppearance = {
			1: { colour: { hex: '#8a8a8a' }, shape: 'circle', edited: true },
			2: { colour: { slot: 3 } },
			3: { colour: { hex: '#123456' } },
			4: { colour: { hex: '#654321' } }
		};
		core.categoryColours = { treatment: { hex: '#c0392b' } };
		core.figureStyle = { fontFamily: 'serif', fontSize: 'l', exportDpi: 600 };
	});

	it('re-keys the session map onto column names and group labels', () => {
		const { name, style } = captureStyle('Lab default');
		expect(name).toBe('Lab default');
		expect(style.columns).toEqual({
			activity: { colour: { hex: '#8a8a8a' }, shape: 'circle', edited: true },
			temperature: { colour: { slot: 3 } }
		});
		expect(style.groups).toEqual({
			WT: { colour: { hex: '#8a8a8a' }, shape: 'circle', edited: true },
			KO: { colour: { slot: 3 } }
		});
		expect(style.categories).toEqual({ treatment: { colour: { hex: '#c0392b' } } });
		// No column ids anywhere: they are per-run counters and mean nothing in another session.
		expect(JSON.stringify(style)).not.toContain('"3"');
	});

	it('captures the template and the palette by name AND colours', () => {
		const { style } = captureStyle('Lab default');
		expect(style.figureStyle.fontFamily).toBe('serif');
		expect(style.figureStyle.exportDpi).toBe(600);
		expect(style.palette.name).toBe(KNOWN_PALETTE);
		expect(style.palette.colours).toEqual(appConsts.colourPalettes[KNOWN_PALETTE]);
	});

	it('omits every name-keyed rule when includeNames is false', () => {
		const { style } = captureStyle('Shared machine', { includeNames: false });
		expect(style.columns).toBeUndefined();
		expect(style.groups).toBeUndefined();
		expect(style.categories).toBeUndefined();
		expect(style.figureStyle.fontFamily).toBe('serif');
		expect(style.palette.colours.length).toBeGreaterThan(0);
		// The point of the option: nothing identifying survives.
		const blob = JSON.stringify(style);
		expect(blob).not.toContain('activity');
		expect(blob).not.toContain('WT');
		expect(blob).not.toContain('treatment');
	});

	it('reports no palette name when the live colours match none of the built-in palettes', () => {
		appState.appColours = ['#111111', '#222222'];
		expect(currentPaletteName()).toBeNull();
		const { style } = captureStyle('Custom');
		expect(style.palette.name).toBeUndefined();
		expect(style.palette.colours).toEqual(['#111111', '#222222']);
	});
});

describe('the store', () => {
	it('round-trips a captured style through localStorage unchanged', () => {
		core.data = [{ id: 1, name: 'activity', groupLabel: 'WT' }];
		core.seriesAppearance = { 1: { colour: { hex: '#8a8a8a' }, shape: 'square' } };
		core.figureStyle = { fontFamily: 'serif', fontSize: 'l', exportDpi: 600 };

		const { style } = captureStyle('Lab default');
		expect(saveStyle('Lab default', style)).toBe(true);
		expect(listStyles()).toEqual(['Lab default']);
		expect(getStyle('Lab default')).toEqual(style);
	});

	it('keeps several styles, and deletes one at a time', () => {
		saveStyle('a', { figureStyle: { fontFamily: 'serif' } });
		saveStyle('b', { figureStyle: { fontSize: 'l' } });
		expect(listStyles()).toEqual(['a', 'b']);
		expect(styleExists('a')).toBe(true);
		deleteStyle('a');
		expect(listStyles()).toEqual(['b']);
		expect(getStyle('a')).toBeNull();
	});

	it('refuses an empty name rather than storing an unnamed style', () => {
		expect(saveStyle('   ', { figureStyle: {} })).toBe(false);
		expect(listStyles()).toEqual([]);
	});

	it('normalises on the way in, so storage cannot hold an invalid style', () => {
		saveStyle('a', { figureStyle: { fontFamily: 'comic' }, columns: { x: 'nope' } });
		expect(getStyle('a').figureStyle.fontFamily).toBe('sans');
		expect(getStyle('a').columns).toBeUndefined();
	});

	it('tracks the active style name, and clears it when that style is deleted', () => {
		saveStyle('a', { figureStyle: {} });
		setActiveStyleName('a');
		expect(getActiveStyleName()).toBe('a');
		deleteStyle('a');
		expect(getActiveStyleName()).toBeNull();
	});

	it('will not make an unsaved name active', () => {
		setActiveStyleName('ghost');
		expect(getActiveStyleName()).toBeNull();
	});

	it('survives corrupt stored JSON rather than throwing', () => {
		localStorage.setItem('ancir.style.configs.v1', '{ not json');
		expect(listStyles()).toEqual([]);
		expect(saveStyle('a', { figureStyle: {} })).toBe(true);
		expect(listStyles()).toEqual(['a']);
	});
});

describe('styles and the privacy controls', () => {
	it('writes to localStorage, NOT sessionStorage, even in ephemeral mode', () => {
		privacy.ephemeral = true;
		saveStyle('a', { figureStyle: { fontFamily: 'serif' } });
		expect(localStorage.getItem('ancir.style.configs.v1')).toBeTruthy();
		expect(sessionStorage.getItem('ancir.style.configs.v1')).toBeNull();
	});

	it('survives switching ephemeral mode on, which also clears the rest', async () => {
		saveStyle('Lab default', { figureStyle: { fontFamily: 'serif' } });
		localStorage.setItem('ancir.recents.v1', '[]');

		await setEphemeral(true);

		// The whole point of the exemption: recents go, presets stay.
		expect(localStorage.getItem('ancir.recents.v1')).toBeNull();
		expect(listStyles()).toEqual(['Lab default']);
		expect(getStyle('Lab default').figureStyle.fontFamily).toBe('serif');

		await setEphemeral(false);
	});

	it('forgetAllStyles removes them and reports how many', () => {
		saveStyle('a', { figureStyle: {} });
		saveStyle('b', { figureStyle: {} });
		expect(forgetAllStyles()).toBe(2);
		expect(listStyles()).toEqual([]);
		expect(localStorage.getItem('ancir.style.configs.v1')).toBeNull();
	});
});

// The reported bug: picking a palette in Settings repainted every existing figure at once,
// because a {slot} record resolves against appState.appColours on read. Every other field in
// that panel waits for "Apply to all plots", so the palette had to as well.
describe('the pending palette', () => {
	const OTHER = 'devon';

	beforeEach(() => {
		appState.pendingPalette = null;
	});

	it('records the choice WITHOUT touching the live palette', () => {
		const before = [...appState.appColours];
		expect(choosePalette(OTHER)).toBe(true);
		// The whole point. If this ever fails, existing figures repaint on click again.
		expect(appState.appColours).toEqual(before);
		expect(appState.pendingPalette.name).toBe(OTHER);
		expect(appState.pendingPalette.colours).toEqual(appConsts.colourPalettes[OTHER]);
	});

	it('copies the palette rather than aliasing the constant', () => {
		choosePalette(OTHER);
		appState.pendingPalette.colours[0] = '#000000';
		expect(appConsts.colourPalettes[OTHER][0]).not.toBe('#000000');
	});

	it('treats choosing the palette already in use as a cancel', () => {
		choosePalette(OTHER);
		expect(appState.pendingPalette).not.toBeNull();
		// Same colours, so there is nothing to apply and the pending choice is dropped.
		expect(choosePalette(KNOWN_PALETTE)).toBe(false);
		expect(appState.pendingPalette).toBeNull();
	});

	it('compares by value, not identity, so a copied palette still cancels', () => {
		appState.appColours = [...appConsts.colourPalettes[KNOWN_PALETTE]];
		expect(choosePalette(KNOWN_PALETTE)).toBe(false);
	});

	it('ignores a palette this build does not have, and keeps any pending choice', () => {
		choosePalette(OTHER);
		expect(choosePalette('no-such-palette')).toBe(true);
		expect(appState.pendingPalette.name).toBe(OTHER);
	});

	it('take returns the colours and clears the choice', () => {
		choosePalette(OTHER);
		expect(takePendingPalette()).toEqual(appConsts.colourPalettes[OTHER]);
		expect(appState.pendingPalette).toBeNull();
	});

	it('take is null when nothing is pending, and stays null on a second call', () => {
		expect(takePendingPalette()).toBeNull();
		choosePalette(OTHER);
		takePendingPalette();
		// A second Apply must not re-apply: the choice was consumed.
		expect(takePendingPalette()).toBeNull();
	});

	it('take clears a malformed pending value rather than handing it on', () => {
		appState.pendingPalette = { name: 'x', colours: [] };
		expect(takePendingPalette()).toBeNull();
		expect(appState.pendingPalette).toBeNull();
	});
});

// Slice 3: applying a style's rules to the session map.
//
// Matching by NAME is fuzzy in two directions, and both have to be visible. These assert the
// REPORT as much as the result: a rule that matched nothing looks exactly like a rule that
// worked, and the count is the only thing that separates them.
describe('planStyleRules', () => {
	const cols = (...defs) =>
		defs.map(([id, name, groupLabel = null]) => ({ id, name, groupLabel }));

	const style = {
		columns: { activity: { colour: { hex: '#c0392b' }, shape: 'square' } },
		groups: { WT: { colour: { hex: '#8a8a8a' } }, KO: { colour: { hex: '#111111' } } },
		categories: { treatment: { colour: { hex: '#00ff00' } } }
	};

	it('applies a name rule and marks the record edited', () => {
		const plan = planStyleRules(style, cols([1, 'activity']));
		expect(plan.series['1']).toEqual({
			colour: { hex: '#c0392b' },
			shape: 'square',
			edited: true
		});
		expect(plan.columnsTouched).toBe(1);
	});

	it('applies one rule to EVERY column sharing that name', () => {
		// Ids are unique; names are not. Two nodes can both output `activity`.
		const plan = planStyleRules(style, cols([1, 'activity'], [2, 'activity']));
		expect(plan.columnsTouched).toBe(2);
		expect(plan.series['2'].colour).toEqual({ hex: '#c0392b' });
		expect(plan.matched).toEqual([{ key: 'activity', count: 2 }]);
	});

	it('reports a rule that matched nothing rather than staying silent', () => {
		const plan = planStyleRules(style, cols([1, 'Activity (counts)']));
		expect(plan.columnsTouched).toBe(0);
		expect(plan.unmatched).toContain('activity');
		expect(plan.summary).toMatch(/matched nothing/);
		expect(plan.summary).toMatch(/activity/);
	});

	it('applies a group rule to every column in that group', () => {
		const plan = planStyleRules(style, cols([1, 'a', 'WT'], [2, 'b', 'WT'], [3, 'c', 'KO']));
		expect(plan.columnsTouched).toBe(3);
		expect(plan.series['1'].colour).toEqual({ hex: '#8a8a8a' });
		expect(plan.series['3'].colour).toEqual({ hex: '#111111' });
	});

	it('lets a NAME rule beat a group rule on the same column', () => {
		// Naming a column is the more specific statement.
		const plan = planStyleRules(style, cols([1, 'activity', 'WT']));
		expect(plan.series['1'].colour).toEqual({ hex: '#c0392b' });
		// The group rule still counts as matched by its other columns only.
		expect(plan.unmatched).toContain('WT');
	});

	it('merges onto an existing record rather than replacing it', () => {
		// A rule stating only a colour must not wipe the marker the session chose.
		const plan = planStyleRules(
			{ columns: { a: { colour: { hex: '#c0392b' } } } },
			cols([1, 'a']),
			{ 1: { colour: { slot: 4 }, shape: 'star', dash: '5, 5' } }
		);
		expect(plan.series['1']).toEqual({
			colour: { hex: '#c0392b' },
			shape: 'star',
			dash: '5, 5',
			edited: true
		});
	});

	it('leaves columns no rule names completely alone', () => {
		const plan = planStyleRules(style, cols([1, 'activity'], [2, 'untouched']));
		expect(plan.series['2']).toBeUndefined();
	});

	it('writes category rules as a bare colour, not a record', () => {
		// core.categoryColours stores {slot}|{hex}; a rule is a full record, so it is unwrapped.
		const plan = planStyleRules(style, cols([1, 'x']));
		expect(plan.categories.treatment).toEqual({ hex: '#00ff00' });
		expect(plan.categoriesTouched).toEqual(['treatment']);
	});

	it('does not mutate the maps it was given', () => {
		const before = { 1: { colour: { slot: 2 } } };
		planStyleRules(style, cols([1, 'activity']), before);
		expect(before['1']).toEqual({ colour: { slot: 2 } });
	});

	it('says so plainly when a style carries no rules at all', () => {
		const plan = planStyleRules({ figureStyle: {} }, cols([1, 'a']));
		expect(plan.columnsTouched).toBe(0);
		expect(plan.summary).toMatch(/no data rules/);
	});

	it('ignores a malformed rule instead of writing a broken record', () => {
		const plan = planStyleRules({ columns: { a: { colour: 'nope' } } }, cols([1, 'a']));
		expect(plan.series['1']).toBeUndefined();
		expect(plan.columnsTouched).toBe(0);
	});

	it('ignores an empty group label rather than matching every ungrouped column', () => {
		const plan = planStyleRules({ groups: { '': { colour: { hex: '#c0392b' } } } }, cols([1, 'a', '']));
		expect(plan.columnsTouched).toBe(0);
	});
});

// Applying rules must reverse in ONE step. A style can rewrite dozens of records, and undoing
// that record by record is not an undo anyone would recognise.
describe('applyStyleRules — one undoable step', () => {
	beforeEach(() => {
		history.clear();
		history.init();
		core.data = [
			{ id: 1, name: 'activity', groupLabel: 'WT' },
			{ id: 2, name: 'temp', groupLabel: 'WT' }
		];
		core.seriesAppearance = { 1: { colour: { slot: 0 } } };
		core.categoryColours = {};
	});

	const style = {
		columns: { activity: { colour: { hex: '#c0392b' } } },
		groups: { WT: { colour: { hex: '#8a8a8a' } } },
		categories: { treatment: { colour: { hex: '#00ff00' } } }
	};

	it('writes both maps and reports what it did', () => {
		const plan = applyStyleRules(style);
		expect(plan.columnsTouched).toBe(2);
		expect(core.seriesAppearance['1'].colour).toEqual({ hex: '#c0392b' });
		expect(core.seriesAppearance['2'].colour).toEqual({ hex: '#8a8a8a' });
		expect(core.categoryColours.treatment).toEqual({ hex: '#00ff00' });
	});

	it('reverses the whole application with a SINGLE undo', () => {
		const before = JSON.parse(JSON.stringify(core.seriesAppearance));
		applyStyleRules(style);
		expect(history.undoCount).toBe(1);
		history.undo();
		expect(core.seriesAppearance).toEqual(before);
		expect(core.categoryColours).toEqual({});
	});

	it('redoes it again', () => {
		applyStyleRules(style);
		history.undo();
		history.redo();
		expect(core.seriesAppearance['2'].colour).toEqual({ hex: '#8a8a8a' });
		expect(core.categoryColours.treatment).toEqual({ hex: '#00ff00' });
	});

	it('pushes NO undo entry when nothing matched', () => {
		// An undo step that reverses nothing is worse than none: it silently eats the user's
		// real previous action when they press undo.
		const plan = applyStyleRules({ columns: { nosuchcolumn: { colour: { hex: '#c0392b' } } } });
		expect(plan.columnsTouched).toBe(0);
		expect(history.undoCount).toBe(0);
	});

	it('marks applied records edited, so auto-assignment leaves them alone', () => {
		applyStyleRules(style);
		expect(core.seriesAppearance['1'].edited).toBe(true);
		expect(pinAppearance(1, 3)).toBe(false);
		expect(core.seriesAppearance['1'].colour).toEqual({ hex: '#c0392b' });
	});
});
