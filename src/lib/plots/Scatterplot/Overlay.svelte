<script module>
	import { Column as ColumnClass } from '$lib/core/Column.svelte';
	import { isInvalidValue } from '$lib/utils/stats.js';

	// One family for everything that is "geometry positioned by values" on a
	// scatterplot: reference LINES and shaded BANDS (plan 2026-09-13, part B).
	// A night band is a band of form `repeating`; a 95% CI is a band of form
	// `ribbon`; an alert time is a vertical line. What differs between them is
	// only WHICH channels exist, and that is decided by (kind, form) below.
	//
	// The class is the whole contract: the Overlays tab, the plotbits renderers
	// and the canvas port emitter all read it and never each other, so the
	// names here are load-bearing (`channelsFor`, `setWire`, `addWire`,
	// `removeWire`, `setTyped`, `values`, `positions`, `capped`, `geometry`,
	// `warning`, `domainExtension`, `getLegendItem`, `toJSON`/`fromJSON`,
	// `fromLegacyNightBand`).

	let _overlayCounter = 0;

	/** Position-style channels are collapsed to finite uniques and cut here. */
	export const OVERLAY_POSITION_CAP = 50;

	const MS_PER_HOUR = 3600000;

	/** Colours for reference lines: explicit, never the series identity map. */
	const LINE_PALETTE = ['#2C2C2C', '#C0392B', '#2980B9', '#27AE60', '#8E44AD'];
	const BAND_FILL_DEFAULT = '#2C2C2C30'; // the NightBand grey
	const RIBBON_FILL_FALLBACK = '#4682B430';
	const EDGE_COLOUR_DEFAULT = '#2C2C2C';

	// The channel table from the plan, in panel/port order. `axis` is the axis
	// the channel is READ on. No channel is dynamic (decision 2026-09-18): every
	// channel holds ONE column, so each wired source is its own Line overlay with
	// its own colour, stroke and label. The flag stays in the spec shape because
	// the port emitter and the MCP catalogue read it; `fromJSONSplit` turns a
	// saved multi-column `at` from before that decision into one Line per column.
	const CHANNEL_TABLE = {
		line: {
			vertical: [{ key: 'at', axis: 'x', dynamic: false }],
			horizontal: [{ key: 'at', axis: 'y', dynamic: false }]
		},
		band: {
			ribbon: [
				{ key: 'x', axis: 'x', dynamic: false },
				{ key: 'lower', axis: 'y', dynamic: false },
				{ key: 'upper', axis: 'y', dynamic: false }
			],
			horizontal: [
				{ key: 'lower', axis: 'y', dynamic: false },
				{ key: 'upper', axis: 'y', dynamic: false }
			],
			vertical: [
				{ key: 'start', axis: 'x', dynamic: false },
				{ key: 'end', axis: 'x', dynamic: false }
			],
			repeating: []
		}
	};

	// Channels that are paired element-wise into segments. Uniqueness for these
	// applies to the PAIR, not to each channel on its own: deduping `start` and
	// `end` separately would re-pair start[i] with the wrong end.
	const PAIRED_FORMS = {
		vertical: ['start', 'end'],
		horizontal: ['lower', 'upper']
	};

	const toFinite = (v) => {
		if (isInvalidValue(v)) return null;
		const n = typeof v === 'number' ? v : Number(v);
		return Number.isFinite(n) ? n : null;
	};

	/** '#RRGGBB' → '#RRGGBBAA'; anything else → null. */
	function withAlpha(hex, alphaByte) {
		if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
		return hex + alphaByte;
	}

	export class OverlayClass {
		/** Forms per kind, in the order the panel offers them. */
		static FORMS = {
			line: ['vertical', 'horizontal'],
			band: ['ribbon', 'horizontal', 'vertical', 'repeating']
		};

		/**
		 * The ordered channel list for a (kind, form), each
		 * `{ key, axis: 'x'|'y', dynamic, display }` with display like 'at (x)'.
		 * Repeating bands have no channels; an unknown pair gives [].
		 */
		static channelsFor(kind, form) {
			const list = CHANNEL_TABLE[kind]?.[form] ?? [];
			return list.map((c) => ({ ...c, display: `${c.key} (${c.axis})` }));
		}

		static defaultForm(kind) {
			return OverlayClass.FORMS[kind]?.[0] ?? 'vertical';
		}

		/** The fill a band of this form starts with; ribbon borrows the first series' line colour. */
		static defaultFillFor(parent, form) {
			if (form !== 'ribbon') return BAND_FILL_DEFAULT;
			const first = parent?.data?.[0]?.line?.colour;
			return withAlpha(first, '33') ?? RIBBON_FILL_FALLBACK;
		}

		parentPlot = $state();
		id;
		kind; // 'line' | 'band' — fixed for the overlay's lifetime
		name = $state('');
		form = $state('vertical');
		enabled = $state(true);
		label = $state(''); // legend entry when non-empty

		// Line style.
		colour = $state('#2C2C2C');
		strokeWidth = $state(1.5);
		stroke = $state('5, 5'); // STROKE_STYLES vocabulary (Line.svelte)

		// Band style.
		fill = $state(BAND_FILL_DEFAULT);
		edge = $state(false);
		edgeColour = $state(EDGE_COLOUR_DEFAULT);
		edgeWidth = $state(1);

		// Repeating band fields, exactly NightBand's.
		repeatEveryHours = $state(24);
		nightDurationHours = $state(12);
		startTimeHours = $state(0);
		useDataMin = $state(true);

		// Keyed by channel key; only keys valid for the current form exist.
		// Each value is `{ columns: ColumnClass[], typed: number[] }`, and a
		// channel is wired OR typed, never both (see setWire/setTyped).
		channels = $state({});

		constructor(parent, dataIN) {
			this.parentPlot = parent;
			// The id is the overlay's canvas identity: its ports are named
			// `ov<id>_<key>` and the right-click picker / history ops address it by
			// that name. A saved id therefore SURVIVES fromJSON (history replay,
			// session load, facet copy); only a brand-new overlay mints one, and the
			// counter always stays above every id it has seen so a re-minted id can
			// never collide with a restored one.
			const savedId = dataIN?.id;
			this.id = Number.isInteger(savedId) && savedId >= 0 ? savedId : _overlayCounter++;
			_overlayCounter = Math.max(_overlayCounter, this.id + 1);
			this.kind = dataIN?.kind === 'band' ? 'band' : 'line';

			const sameKind = (parent?.overlays ?? []).filter((o) => o?.kind === this.kind).length;
			this.name = dataIN?.name ?? `${this.kind === 'line' ? 'Line' : 'Band'} ${sameKind + 1}`;

			const form = dataIN?.form;
			this.form = OverlayClass.FORMS[this.kind].includes(form)
				? form
				: OverlayClass.defaultForm(this.kind);

			this.enabled = dataIN?.enabled ?? true;
			this.label = dataIN?.label ?? '';

			this.colour = dataIN?.colour ?? LINE_PALETTE[sameKind % LINE_PALETTE.length];
			this.strokeWidth = dataIN?.strokeWidth ?? 1.5;
			this.stroke = dataIN?.stroke ?? '5, 5';

			this.fill = dataIN?.fill ?? OverlayClass.defaultFillFor(parent, this.form);
			this.edge = dataIN?.edge ?? false;
			this.edgeColour = dataIN?.edgeColour ?? EDGE_COLOUR_DEFAULT;
			this.edgeWidth = dataIN?.edgeWidth ?? 1;

			this.repeatEveryHours = dataIN?.repeatEveryHours ?? 24;
			this.nightDurationHours = dataIN?.nightDurationHours ?? 12;
			this.startTimeHours = dataIN?.startTimeHours ?? 0;
			this.useDataMin = dataIN?.useDataMin ?? true;

			// Channels: one empty slot per valid key, then whatever the json holds
			// for those keys (a saved channel that no longer fits the form is dropped).
			// Only the FIRST saved column is kept: a channel holds one column, and a
			// legacy multi-column `at` is split by fromJSONSplit before it gets here.
			for (const { key } of OverlayClass.channelsFor(this.kind, this.form)) {
				const saved = dataIN?.channels?.[key];
				this.channels[key] = {
					columns: (saved?.columns ?? [])
						.filter((c) => c?.refId != null)
						.slice(0, 1)
						.map((c) => ColumnClass.fromJSON({ refId: c.refId })),
					typed: (saved?.typed ?? []).map(toFinite).filter((v) => v != null)
				};
			}
		}

		// ---- form ----------------------------------------------------------

		/**
		 * Change the form, swapping channel keys IN PLACE: keys the new form
		 * shares keep their wires/typed values, dropped keys vanish (and with
		 * them their canvas ports), new keys start empty. A form that does not
		 * belong to this kind is ignored.
		 */
		setForm(form) {
			if (!OverlayClass.FORMS[this.kind].includes(form) || form === this.form) return;
			const wasDefaultFill = this.fill === OverlayClass.defaultFillFor(this.parentPlot, this.form);
			const keep = new Set(OverlayClass.channelsFor(this.kind, form).map((c) => c.key));
			for (const key of Object.keys(this.channels)) {
				if (!keep.has(key)) delete this.channels[key];
			}
			for (const key of keep) {
				if (!this.channels[key]) this.channels[key] = { columns: [], typed: [] };
			}
			this.form = form;
			if (this.kind === 'band' && wasDefaultFill) {
				this.fill = OverlayClass.defaultFillFor(this.parentPlot, form);
			}
		}

		/** The channel spec `{ key, axis, dynamic, display }` for a key of the current form, or null. */
		channelSpec(key) {
			return OverlayClass.channelsFor(this.kind, this.form).find((c) => c.key === key) ?? null;
		}

		// ---- wiring --------------------------------------------------------

		/** Replace the channel's wires with one column; typed values are cleared. */
		setWire(key, refId) {
			const ch = this.channels[key];
			if (!ch) return;
			ch.columns = [new ColumnClass({ refId })];
			ch.typed = [];
		}

		/**
		 * Kept for API compatibility with the dynamic-`at` era: every channel is
		 * single now, so this is `setWire` (a second wire replaces the first).
		 */
		addWire(key, refId) {
			this.setWire(key, refId);
		}

		removeWire(key, refId) {
			const ch = this.channels[key];
			if (!ch) return;
			ch.columns = ch.columns.filter((c) => c.refId !== refId);
		}

		/**
		 * Type values into the channel; wires are cleared. Accepts a number, a
		 * number[] or a comma-separated string; tokens that are not finite
		 * numbers are ignored.
		 */
		setTyped(key, numbersOrString) {
			const ch = this.channels[key];
			if (!ch) return;
			let raw;
			if (Array.isArray(numbersOrString)) raw = numbersOrString;
			else if (typeof numbersOrString === 'string') raw = numbersOrString.split(',');
			else raw = [numbersOrString];
			ch.typed = raw.map(toFinite).filter((v) => v != null);
			ch.columns = [];
		}

		wiredRefIds(key) {
			return (this.channels[key]?.columns ?? []).map((c) => c.refId);
		}

		// ---- resolution ----------------------------------------------------

		/**
		 * The finite numbers a channel provides, in order: wired → the column's
		 * data (null/blank/NaN skipped), typed → the typed list, neither → [].
		 * An x-axis channel wired to an hours-from-origin column is converted
		 * onto the time axis exactly as series x is (xOriginFor).
		 */
		values(key) {
			const ch = this.channels[key];
			if (!ch) return [];
			const col = ch.columns[0];
			if (!col) return ch.typed.slice();
			const spec = this.channelSpec(key);
			const parent = this.parentPlot;
			const data = typeof col?.getData === 'function' ? (col.getData() ?? []) : [];
			const origin =
				spec?.axis === 'x' && typeof parent?.xOriginFor === 'function'
					? parent.xOriginFor(col)
					: null;
			const out = [];
			for (const raw of data) {
				const v = toFinite(raw);
				if (v == null) continue;
				out.push(origin != null ? origin + v * MS_PER_HOUR : v);
			}
			return out;
		}

		/** True when the user has put something into the channel: a wire or a typed value. */
		hasInput(key) {
			const ch = this.channels[key];
			return !!ch && (ch.columns.length > 0 || ch.typed.length > 0);
		}

		#isPositionChannel(key) {
			return this.kind === 'line' && key === 'at';
		}

		#uniques(list) {
			// Local scratch, never reactive state: a plain Set is right here.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const seen = new Set();
			const out = [];
			for (const v of list) {
				if (seen.has(v)) continue;
				seen.add(v);
				out.push(v);
			}
			return out;
		}

		/**
		 * `values(key)` as they are drawn: the `at` channel is collapsed to
		 * uniques and capped; paired channels (start/end, lower/upper) are
		 * capped as raw lists and deduped per PAIR in geometry(); ribbon
		 * channels are returned whole.
		 */
		positions(key) {
			const vals = this.values(key);
			if (this.form === 'ribbon') return vals;
			const base = this.#isPositionChannel(key) ? this.#uniques(vals) : vals;
			return base.slice(0, OVERLAY_POSITION_CAP);
		}

		/** `{ shown, total }` so the panel can say "showing the first 50". */
		capped(key) {
			const vals = this.values(key);
			const total = this.#isPositionChannel(key) ? this.#uniques(vals).length : vals.length;
			const shown = this.form === 'ribbon' ? total : Math.min(total, OVERLAY_POSITION_CAP);
			return { shown, total };
		}

		// ---- geometry ------------------------------------------------------

		#pairedSegments(k0, k1, n0, n1) {
			const a = this.positions(k0);
			const b = this.positions(k1);
			const n = Math.min(a.length, b.length);
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch, not state
			const seen = new Set();
			const out = [];
			for (let i = 0; i < n; i++) {
				const lo = Math.min(a[i], b[i]);
				const hi = Math.max(a[i], b[i]);
				if (!(hi > lo)) continue; // an empty pair draws nothing (NightBand skipped these too)
				const sig = `${lo}|${hi}`;
				if (seen.has(sig)) continue;
				seen.add(sig);
				out.push({ [n0]: lo, [n1]: hi });
			}
			return out;
		}

		// NightBand's repeating maths, ported verbatim: `startTimeHours` is in
		// AXIS units (ms when x is time, because the control is a date picker
		// there), while `nightDurationHours`/`repeatEveryHours` are hours and
		// scale to ms on a time axis.
		#repeatingSegments(ctx) {
			const parent = this.parentPlot;
			const minX = ctx?.xDomainMin ?? parent?.xlims?.[0];
			const maxX = ctx?.xDomainMax ?? parent?.xlims?.[1];
			const isTime = ctx?.xIsTime ?? parent?.anyXdataTime ?? false;
			if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return [];

			let bandStart = this.useDataMin ? minX : this.startTimeHours;
			const bandWidth = isTime ? this.nightDurationHours * MS_PER_HOUR : this.nightDurationHours;
			const step = isTime ? this.repeatEveryHours * MS_PER_HOUR : this.repeatEveryHours;
			if (!(step > 0) || !(bandWidth > 0)) return [];

			const segments = [];
			while (bandStart < maxX) {
				const bandEnd = bandStart + bandWidth;
				if (bandEnd > minX && bandStart < maxX) {
					segments.push({ x0: Math.max(bandStart, minX), x1: Math.min(bandEnd, maxX) });
				}
				bandStart += step;
			}
			return segments;
		}

		#ribbon() {
			const x = this.positions('x');
			const lower = this.positions('lower');
			const upper = this.positions('upper');
			if (x.length !== lower.length || x.length !== upper.length || x.length === 0) {
				return { x: [], lower: [], upper: [] };
			}
			return { x, lower, upper };
		}

		/**
		 * What to draw, as plain data. `ctx` = `{ xDomainMin, xDomainMax, xIsTime }`
		 * (only repeating bands read it; each falls back to the parent plot).
		 *
		 *   line             → { kind:'line', orientation:'vertical'|'horizontal', positions:number[] }
		 *   band vertical    → { kind:'band', form, segments:[{x0,x1}] }   (start[i] with end[i])
		 *   band repeating   → { kind:'band', form, segments:[{x0,x1}] }   (NightBand maths)
		 *   band horizontal  → { kind:'band', form, segments:[{y0,y1}] }   (lower[i] with upper[i])
		 *   band ribbon      → { kind:'band', form, x:[], lower:[], upper:[] } (equal lengths, or all empty)
		 */
		geometry(ctx = {}) {
			if (this.kind === 'line') {
				return { kind: 'line', orientation: this.form, positions: this.positions('at') };
			}
			switch (this.form) {
				case 'vertical':
					return {
						kind: 'band',
						form: 'vertical',
						segments: this.#pairedSegments('start', 'end', 'x0', 'x1')
					};
				case 'horizontal':
					return {
						kind: 'band',
						form: 'horizontal',
						segments: this.#pairedSegments('lower', 'upper', 'y0', 'y1')
					};
				case 'repeating':
					return { kind: 'band', form: 'repeating', segments: this.#repeatingSegments(ctx) };
				case 'ribbon':
				default:
					return { kind: 'band', form: 'ribbon', ...this.#ribbon() };
			}
		}

		// ---- warnings ------------------------------------------------------

		// Read-only, in the seriesHealth.js house style (requirement / actual /
		// remedy where there is one). A PRISTINE overlay (nothing wired, nothing
		// typed) is silent, like an unwired series: it is not broken, just not
		// filled in yet. Repeating never warns.
		warning = $derived.by(() => {
			const specs = OverlayClass.channelsFor(this.kind, this.form);
			if (specs.length === 0) return null;
			if (!specs.some((c) => this.hasInput(c.key))) return null;

			for (const { key } of specs) {
				if (this.values(key).length === 0) {
					return `${this.name} cannot be drawn: ${key} has no values`;
				}
			}

			if (this.form === 'ribbon') {
				const nx = this.values('x').length;
				const nl = this.values('lower').length;
				const nu = this.values('upper').length;
				if (nx !== nl || nx !== nu) {
					return (
						`${this.name} cannot be drawn: x, lower and upper must provide the same number of values, ` +
						`but x has ${nx}, lower has ${nl} and upper has ${nu}`
					);
				}
				return null;
			}

			for (const { key } of specs) {
				const { shown, total } = this.capped(key);
				if (total > shown) {
					const where = specs.length > 1 ? ` ${key}` : '';
					return `${this.name} has ${total}${where} positions; showing the first ${shown}`;
				}
			}

			const pair = PAIRED_FORMS[this.form];
			if (pair) {
				const n0 = this.values(pair[0]).length;
				const n1 = this.values(pair[1]).length;
				if (n0 !== n1) {
					return `${this.name}: ${pair[0]} has ${n0} values and ${pair[1]} has ${n1}; extra values are ignored`;
				}
			}
			return null;
		});

		// ---- axis limits ---------------------------------------------------

		#extent(list) {
			if (list.length === 0) return null;
			let lo = Infinity;
			let hi = -Infinity;
			for (const v of list) {
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			return [lo, hi];
		}

		/**
		 * `{ x: [min,max]|null, y: [min,max]|null }` from what would be drawn, so
		 * the plot can widen its AUTO limits and never leave a reference mark
		 * off-screen. Empty when disabled, when nothing resolves, and always for
		 * repeating (which clamps itself to the domain).
		 */
		domainExtension() {
			const none = { x: null, y: null };
			if (!this.enabled || this.form === 'repeating') return none;
			const g = this.geometry({});
			if (g.kind === 'line') {
				const ext = this.#extent(g.positions);
				return g.orientation === 'vertical' ? { x: ext, y: null } : { x: null, y: ext };
			}
			if (g.form === 'ribbon') {
				return { x: this.#extent(g.x), y: this.#extent([...g.lower, ...g.upper]) };
			}
			if (g.form === 'vertical') {
				return { x: this.#extent(g.segments.flatMap((s) => [s.x0, s.x1])), y: null };
			}
			return { x: null, y: this.#extent(g.segments.flatMap((s) => [s.y0, s.y1])) };
		}

		// ---- legend --------------------------------------------------------

		/** One legend item when labelled, else null. Bands use Legend.svelte's rect swatch (`boxplot`). */
		getLegendItem() {
			const label = (this.label ?? '').trim();
			if (!label) return null;
			if (this.kind === 'line') {
				return {
					label,
					elements: [
						{ type: 'line', color: this.colour, strokeWidth: this.strokeWidth, stroke: this.stroke }
					]
				};
			}
			return {
				label,
				elements: [
					{
						type: 'boxplot',
						fillColor: this.fill,
						fillOpacity: 1,
						color: this.edge ? this.edgeColour : 'none'
					}
				]
			};
		}

		// ---- persistence ---------------------------------------------------

		toJSON() {
			const channels = {};
			for (const [key, ch] of Object.entries(this.channels)) {
				channels[key] = {
					columns: ch.columns.map((c) => ({ refId: c.refId })),
					typed: ch.typed.slice()
				};
			}
			return {
				id: this.id,
				name: this.name,
				kind: this.kind,
				form: this.form,
				enabled: this.enabled,
				label: this.label,
				colour: this.colour,
				strokeWidth: this.strokeWidth,
				stroke: this.stroke,
				fill: this.fill,
				edge: this.edge,
				edgeColour: this.edgeColour,
				edgeWidth: this.edgeWidth,
				repeatEveryHours: this.repeatEveryHours,
				nightDurationHours: this.nightDurationHours,
				startTimeHours: this.startTimeHours,
				useDataMin: this.useDataMin,
				channels
			};
		}

		// `json` may be absent or partial; the constructor's `??` guards keep
		// every default, and channel columns are rebuilt from refId ONLY (see the
		// Scatterplot.svelte note on why saved column fields must not be replayed).
		static fromJSON(parent, json) {
			return new OverlayClass(parent, json ?? undefined);
		}

		/**
		 * Session-load variant of fromJSON that honours the one-column rule: a
		 * saved Line whose `at.columns` holds N > 1 entries (the dynamic-`at` era,
		 * before 2026-09-18) becomes N Line overlays, one column each. The first
		 * keeps the saved id, name, label and style; the others are copies with a
		 * fresh id and the usual "Line N" name (counted from the lines already in
		 * `parent` plus the first), sharing the style and label. Anything else
		 * (a single or unwired line, a typed line, any band) is one overlay, as
		 * fromJSON. The caller pushes the result onto `parent.overlays` in order.
		 */
		static fromJSONSplit(parent, json) {
			const first = OverlayClass.fromJSON(parent, json);
			const saved = (json?.channels?.at?.columns ?? []).filter((c) => c?.refId != null);
			if (first.kind !== 'line' || saved.length <= 1) return [first];
			// Copies share everything but identity and the column. `name` is minted
			// explicitly because the constructor's counter only sees overlays that
			// are already in the parent, and none of these are yet.
			const shared = { ...first.toJSON() };
			delete shared.id;
			delete shared.name;
			delete shared.channels;
			const lineCount = (parent?.overlays ?? []).filter((o) => o?.kind === 'line').length + 1;
			const rest = saved.slice(1).map((c, i) => {
				const copy = new OverlayClass(parent, {
					...shared,
					channels: { at: { columns: [{ refId: c.refId }], typed: [] } }
				});
				copy.name = `Line ${lineCount + i + 1}`;
				return copy;
			});
			return [first, ...rest];
		}

		/**
		 * Migrate a saved NightBand: mode 'repeating' → a repeating band with the
		 * four fields; mode 'custom' → a vertical band whose start/end are typed
		 * from `customBands` (`{startTime, durationHours}` or the older
		 * `{startTime, endTime}`), with durations scaled to ms on a time axis as
		 * NightBand did. `name`, `colour` → `fill` and `enabled` are kept.
		 */
		static fromLegacyNightBand(parent, json) {
			const nb = json ?? {};
			const base = {
				kind: 'band',
				name: nb.name ?? 'Night',
				fill: nb.colour ?? BAND_FILL_DEFAULT,
				enabled: nb.enabled ?? true
			};
			if (nb.mode !== 'custom') {
				return new OverlayClass(parent, {
					...base,
					form: 'repeating',
					repeatEveryHours: nb.repeatEveryHours ?? 24,
					nightDurationHours: nb.nightDurationHours ?? 12,
					startTimeHours: nb.startTimeHours ?? 0,
					useDataMin: nb.useDataMin ?? true
				});
			}
			const msPerUnit = parent?.anyXdataTime ? MS_PER_HOUR : 1;
			const start = [];
			const end = [];
			for (const band of nb.customBands ?? []) {
				const s = toFinite(band?.startTime);
				if (s == null) continue;
				let e = toFinite(band?.endTime);
				const dur = toFinite(band?.durationHours);
				if (dur != null) e = s + dur * msPerUnit;
				if (e == null || !(e > s)) continue;
				start.push(s);
				end.push(e);
			}
			return new OverlayClass(parent, {
				...base,
				form: 'vertical',
				channels: { start: { typed: start }, end: { typed: end } }
			});
		}
	}
</script>

<script>
	// Component half: the Overlays-tab block (`which="controls"`) and the plot-side
	// rendering (`which="plot"`), both driven entirely by the model above.
	import Column from '$lib/core/Column.svelte';
	import Line from '$lib/components/plotbits/Line.svelte';
	import Band from '$lib/components/plotbits/Band.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ColourPicker from '$lib/components/inputs/ColourPicker.svelte';
	import DateTimeHrs from '$lib/components/inputs/DateTimeHrs.svelte';
	import Editable from '$lib/components/inputs/Editable.svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip as attachTooltip } from '$lib/utils/tooltip.js';
	import { removeOverlayWithUndo } from '$lib/plots/seriesDelete.js';

	let {
		/** the OverlayClass instance */
		overlay,
		/** the plot's inner data object (Scatterplotclass): parentBox, scales, removeOverlay */
		inner,
		which = 'controls'
	} = $props();

	const FORM_LABELS = {
		vertical: 'Vertical',
		horizontal: 'Horizontal',
		ribbon: 'Ribbon',
		repeating: 'Repeating'
	};

	const channelSpecs = $derived(OverlayClass.channelsFor(overlay?.kind, overlay?.form));
	const isTimeX = $derived(!!inner?.anyXdataTime);

	// The EMPTY picker (shown while a channel is unwired): a blank wrapper column
	// that is NOT in the model. Once it resolves to a real column the wire goes in
	// through the API, the wired column's own picker takes the slot, and the blank
	// is replaced (its picker re-mounted via `blankGen`) so that if the wire is
	// later removed the slot reads empty again. Plain objects on purpose: the
	// blank is scratch, and a Column must not be constructed inside an effect (see
	// the vault note on derived_inert).
	const blanks = {};
	let blankGen = $state({});
	function blankFor(key) {
		if (!blanks[key]) blanks[key] = new ColumnClass({ refId: -1 });
		return blanks[key];
	}
	function resetBlank(key) {
		blanks[key] = new ColumnClass({ refId: -1 });
		blankGen[key] = (blankGen[key] ?? 0) + 1;
	}

	/** The empty picker resolved: the channel takes the column as its one wire. */
	function onBlankChange(key, refId) {
		if (refId == null || refId < 0) return;
		overlay.setWire(key, refId);
		resetBlank(key);
	}

	/** The wired column's picker changed column: replace the wire (typed values clear). */
	function onWireChange(key, refId) {
		if (refId == null || refId < 0) return;
		overlay.setWire(key, refId);
	}

	function typedText(key) {
		return (overlay.channels[key]?.typed ?? []).join(', ');
	}

	// Typed x values on a time axis are ms (what the date picker stores).
	function setTypedAt(key, index, value) {
		const arr = (overlay.channels[key]?.typed ?? []).slice();
		arr[index] = Number(value);
		overlay.setTyped(key, arr);
	}
	function addTypedTime(key) {
		const arr = (overlay.channels[key]?.typed ?? []).slice();
		const last = arr[arr.length - 1];
		arr.push(Number.isFinite(last) ? last : (inner?.xlims?.[0] ?? Date.now()));
		overlay.setTyped(key, arr);
	}
	function removeTypedAt(key, index) {
		const arr = (overlay.channels[key]?.typed ?? []).slice();
		arr.splice(index, 1);
		overlay.setTyped(key, arr);
	}

	function isXChannel(spec) {
		return spec.axis === 'x';
	}

	function capNote(key) {
		const { shown, total } = overlay.capped(key);
		return total > shown ? `${total} positions; showing the first ${shown}` : null;
	}

	function remove() {
		removeOverlayWithUndo(inner, overlay.id);
	}
</script>

{#snippet header(overlay)}
	<div class="overlay-block-header">
		<div class="overlay-block-identity">
			<p class="overlay-title" title={overlay.name}>
				<Editable
					bind:value={overlay.name}
					placeholder={overlay.kind === 'line' ? 'Line' : 'Band'}
				/>
			</p>
		</div>
		<div class="overlay-block-icons">
			<button
				class="icon"
				title={overlay.enabled ? 'Hide this overlay' : 'Show this overlay'}
				onclick={(e) => {
					e.stopPropagation();
					overlay.enabled = !overlay.enabled;
				}}
			>
				{#if !overlay.enabled}
					<Icon name="eye-slash" width={16} height={16} />
				{:else}
					<Icon name="eye" width={16} height={16} className="visible" />
				{/if}
			</button>
			<button
				class="icon"
				title={overlay.kind === 'line' ? 'Remove this line' : 'Remove this band'}
				onclick={remove}
				{@attach attachTooltip(overlay.kind === 'line' ? 'Remove this line' : 'Remove this band')}
			>
				<Icon name="trash" width={16} height={16} className="series-block-icon" />
			</button>
		</div>
	</div>
	{#if overlay.warning}
		<div class="data-warning">
			<p>⚠ {overlay.warning}</p>
		</div>
	{/if}
{/snippet}

{#snippet channelRow(spec)}
	{@const key = spec.key}
	{@const ch = overlay.channels[key]}
	<div class="overlay-channel">
		<div class="overlay-channel-head">
			<ControlInput label={spec.display}></ControlInput>
		</div>
		<div class="overlay-channel-pickers">
			<!-- Exactly one picker per channel: the wired column when wired, else
			     the blank one (a channel holds one column; see the model). -->
			{#if ch?.columns?.[0]}
				{#key ch.columns[0].id}
					<Column
						col={ch.columns[0]}
						canChange={true}
						onChange={(refId) => onWireChange(key, refId)}
					/>
				{/key}
			{:else}
				{#key blankGen[key] ?? 0}
					<Column
						col={blankFor(key)}
						canChange={true}
						onChange={(refId) => onBlankChange(key, refId)}
					/>
				{/key}
			{/if}
		</div>
		{#if isTimeX && isXChannel(spec)}
			<div class="overlay-typed-times">
				<p class="overlay-or">or pick times:</p>
				{#each ch?.typed ?? [] as v, i (i)}
					<div class="overlay-typed-time">
						<DateTimeHrs value={v} onChange={(val) => setTypedAt(key, i, val)} />
						<button class="icon" title="Remove this value" onclick={() => removeTypedAt(key, i)}>
							<Icon name="trash" width={14} height={14} className="series-block-icon" />
						</button>
					</div>
				{/each}
				<button class="btn-add" onclick={() => addTypedTime(key)}>+ Add time</button>
			</div>
		{:else}
			<div class="overlay-typed">
				<p class="overlay-or">or type:</p>
				<input
					type="text"
					class="overlay-typed-input"
					placeholder="35, 55.6"
					value={typedText(key)}
					onchange={(e) => overlay.setTyped(key, e.currentTarget.value)}
				/>
			</div>
		{/if}
		{#if capNote(key)}
			<p class="overlay-cap-note">{capNote(key)}</p>
		{/if}
	</div>
{/snippet}

{#snippet repeatingFields(overlay)}
	<div class="control-input">
		<label class="overlay-check">
			<input type="checkbox" bind:checked={overlay.useDataMin} />
			<span>Use data minimum as reference</span>
		</label>
	</div>

	{#if !overlay.useDataMin}
		<div class="control-input">
			<p>Start Time (hours)</p>
			{#if isTimeX}
				<DateTimeHrs step="0.5" bind:value={overlay.startTimeHours} />
			{:else}
				<NumberWithUnits step="0.5" bind:value={overlay.startTimeHours} />
			{/if}
		</div>
	{:else}
		<div class="control-input">
			<p>Start Time: Data Min + {overlay.startTimeHours} hrs</p>
		</div>
	{/if}

	<ControlInput label="Period (hours)">
		<NumberWithUnits min="0.5" step="0.5" bind:value={overlay.repeatEveryHours} />
	</ControlInput>

	<ControlInput label="Night Duration (hours)">
		<NumberWithUnits
			min="0.1"
			max={overlay.repeatEveryHours * 0.99}
			step="0.5"
			bind:value={overlay.nightDurationHours}
		/>
	</ControlInput>

	{#if inner}
		{@const n = overlay.geometry(inner.overlayContext?.() ?? {}).segments?.length ?? 0}
		{#if n > 0}
			<div class="control-input">
				<p>Generates {n} band(s)</p>
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet controls(overlay)}
	{@render header(overlay)}

	<div class="control-input-horizontal">
		<ControlInput label="Form">
			<select
				class="overlay-form"
				value={overlay.form}
				onchange={(e) => overlay.setForm(e.currentTarget.value)}
			>
				{#each OverlayClass.FORMS[overlay.kind] as form (form)}
					<option value={form}>{FORM_LABELS[form] ?? form}</option>
				{/each}
			</select>
		</ControlInput>
	</div>

	{#each channelSpecs as spec (spec.key)}
		{@render channelRow(spec)}
	{/each}

	{#if overlay.kind === 'band' && overlay.form === 'repeating'}
		{@render repeatingFields(overlay)}
	{/if}

	{#if overlay.kind === 'line'}
		<Line lineData={overlay} which="styleRow" />
	{:else}
		<div class="control-input-horizontal">
			<div class="control-input overlay-swatch">
				<p>Fill</p>
				<ColourPicker bind:value={overlay.fill} />
			</div>
			<label class="overlay-check">
				<input type="checkbox" bind:checked={overlay.edge} />
				<span>Edge line</span>
			</label>
		</div>
		{#if overlay.edge}
			<div class="control-input-horizontal">
				<div class="control-input overlay-swatch">
					<p>Edge</p>
					<ColourPicker bind:value={overlay.edgeColour} />
				</div>
				<ControlInput label="Edge width">
					<NumberWithUnits step="0.2" min={0.1} bind:value={overlay.edgeWidth} />
				</ControlInput>
			</div>
		{/if}
	{/if}

	<ControlInput label="Label">
		<input
			type="text"
			bind:value={overlay.label}
			placeholder="shown in legend when set"
			title="Shown in the legend when set"
		/>
	</ControlInput>
{/snippet}

{#snippet plot(overlay)}
	{#if inner && overlay.enabled}
		{@const g = overlay.geometry(inner.overlayContext?.() ?? {})}
		{#if g.kind === 'line'}
			<Line
				lineData={overlay}
				positions={g.positions}
				orientation={g.orientation}
				xscale={inner.XScale}
				yscale={inner.overlayYScale}
				xoffset={inner.padding.left}
				yoffset={inner.padding.top}
				which="rules"
			/>
		{:else}
			<Band
				{overlay}
				geometry={g}
				xscale={inner.XScale}
				yscale={inner.overlayYScale}
				xoffset={inner.padding.left}
				yoffset={inner.padding.top}
			/>
		{/if}
	{/if}
{/snippet}

{#if overlay && which === 'plot'}
	{@render plot(overlay)}
{:else if overlay && which === 'controls'}
	{@render controls(overlay)}
{/if}

<style>
	.overlay-block-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		font-weight: 600;
		margin-bottom: var(--space-2);
	}
	.overlay-block-identity {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
		flex: 1;
	}
	.overlay-title {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.overlay-title :global(span),
	.overlay-title :global(input) {
		white-space: nowrap;
	}
	.overlay-block-icons {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}
	button.icon {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
	}
	.data-warning {
		margin: 0 0 var(--space-2);
		padding: 0.45rem 0.6rem;
		border-radius: 0.375rem;
		background: color-mix(in srgb, #f5c76a 18%, white);
		border: 1px solid color-mix(in srgb, #d89c1b 35%, white);
		font-weight: 400;
	}
	.data-warning p {
		margin: 0.15rem 0;
		font-size: 0.92em;
	}
	.overlay-channel {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.overlay-channel-pickers {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.overlay-typed,
	.overlay-typed-time {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.overlay-typed-times {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.overlay-or {
		margin: 0;
		font-size: var(--font-sm);
		color: var(--color-lightness-35);
		white-space: nowrap;
	}
	.overlay-typed-input {
		flex: 1;
		min-width: 0;
	}
	.overlay-cap-note {
		margin: 0;
		font-size: var(--font-xs);
		color: var(--color-lightness-35);
	}
	.overlay-check {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--font-sm);
		cursor: pointer;
	}
	.overlay-check input[type='checkbox'] {
		cursor: pointer;
		width: 16px;
		height: 16px;
	}
	.overlay-form {
		width: 100%;
	}
	/* The Fill / Edge swatch columns: wide enough for their four-letter labels
	   (Line.svelte's 1.5rem "Col" column wraps "Edge" onto two lines). */
	.overlay-swatch {
		max-width: 2.5rem;
	}
	.overlay-swatch p {
		white-space: nowrap;
	}
</style>
