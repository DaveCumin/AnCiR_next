import { describe, it, expect } from 'vitest';
import { getSharedSchema, getSharedDataSchema } from '$lib/plots/sharedControls.js';

class FakeAxis {
	label = 'x';
	toJSON() {
		return { label: this.label };
	}
}

class FakePlotClass {
	static descriptors = {
		paddingIN: { group: 'Padding' },
		periodHrs: { group: 'Time', label: 'Period (h)', step: 0.1 },
		ylimsOption: {
			group: 'Y-lims',
			label: 'Scale Y-axis',
			input: 'select',
			options: ['overall', 'byperiod', 'manual']
		},
		ylimsIN: { group: 'Y-lims', _children: { 0: { label: 'Y min' }, 1: { label: 'Y max' } } },
		internalDebug: { skip: true }
	};

	paddingIN = { top: 30, right: 20, bottom: 10, left: 20 };
	periodHrs = 24;
	showDayNumbers = false;
	ylimsOption = 'overall';
	ylimsIN = [0, 100];
	internalDebug = 7;
	xAxis = new FakeAxis();

	toJSON() {
		return {
			paddingIN: this.paddingIN,
			periodHrs: this.periodHrs,
			showDayNumbers: this.showDayNumbers,
			ylimsOption: this.ylimsOption,
			ylimsIN: this.ylimsIN,
			internalDebug: this.internalDebug,
			xAxis: this.xAxis.toJSON(),
			data: []
		};
	}
}

class FakeDataClass {
	static descriptors = {};
	x = { refId: 1 };
	y = { refId: 2 };
	label = '';
	draw = true;
	toJSON() {
		return { x: this.x, y: this.y, label: this.label, draw: this.draw };
	}
}

function makeWrapper() {
	const inner = new FakePlotClass();
	inner.data = [new FakeDataClass()];
	return { width: 495, height: 240, name: 'p', plot: inner };
}

describe('getSharedSchema', () => {
	it('prepends wrapper width/height with Dimension group', () => {
		const schema = getSharedSchema(makeWrapper());
		const widthField = schema.find((f) => f.path === 'width');
		const heightField = schema.find((f) => f.path === 'height');
		expect(widthField).toEqual({
			path: 'width',
			label: 'Width',
			input: 'number',
			group: 'Dimension'
		});
		expect(heightField).toEqual({
			path: 'height',
			label: 'Height',
			input: 'number',
			group: 'Dimension'
		});
	});

	it('expands plain-object fields into per-leaf descriptors with cascaded group', () => {
		const schema = getSharedSchema(makeWrapper());
		const top = schema.find((f) => f.path === 'plot.paddingIN.top');
		const right = schema.find((f) => f.path === 'plot.paddingIN.right');
		expect(top).toEqual({
			path: 'plot.paddingIN.top',
			label: 'Top',
			input: 'number',
			group: 'Padding'
		});
		expect(right).toEqual({
			path: 'plot.paddingIN.right',
			label: 'Right',
			input: 'number',
			group: 'Padding'
		});
	});

	it('expands primitive arrays into indexed descriptors and honours _children labels', () => {
		const schema = getSharedSchema(makeWrapper());
		expect(schema).toContainEqual({
			path: 'plot.ylimsIN[0]',
			label: 'Y min',
			input: 'number',
			group: 'Y-lims'
		});
		expect(schema).toContainEqual({
			path: 'plot.ylimsIN[1]',
			label: 'Y max',
			input: 'number',
			group: 'Y-lims'
		});
	});

	it('uses descriptor label/group/step on scalar fields', () => {
		const schema = getSharedSchema(makeWrapper());
		const period = schema.find((f) => f.path === 'plot.periodHrs');
		expect(period).toEqual({
			path: 'plot.periodHrs',
			label: 'Period (h)',
			input: 'number',
			group: 'Time',
			step: 0.1
		});
	});

	it('promotes string fields to select when descriptors supply options', () => {
		const schema = getSharedSchema(makeWrapper());
		const opt = schema.find((f) => f.path === 'plot.ylimsOption');
		expect(opt).toEqual({
			path: 'plot.ylimsOption',
			label: 'Scale Y-axis',
			input: 'select',
			options: ['overall', 'byperiod', 'manual'],
			group: 'Y-lims'
		});
	});

	it('infers boolean input from value type and title-cases the label', () => {
		const schema = getSharedSchema(makeWrapper());
		const show = schema.find((f) => f.path === 'plot.showDayNumbers');
		expect(show).toEqual({
			path: 'plot.showDayNumbers',
			label: 'Show Day Numbers',
			input: 'boolean'
		});
	});

	it('skips class-instance fields, data, and annotations', () => {
		const schema = getSharedSchema(makeWrapper());
		expect(schema.some((f) => f.path.startsWith('plot.xAxis'))).toBe(false);
		expect(schema.some((f) => f.path.startsWith('plot.data'))).toBe(false);
		expect(schema.some((f) => f.path.startsWith('plot.annotations'))).toBe(false);
	});

	it('honours skip:true in descriptors', () => {
		const schema = getSharedSchema(makeWrapper());
		expect(schema.some((f) => f.path === 'plot.internalDebug')).toBe(false);
	});

	it('returns just the wrapper fields when plot has no toJSON', () => {
		const schema = getSharedSchema({ width: 1, height: 2, plot: null });
		expect(schema).toEqual([
			{ path: 'width', label: 'Width', input: 'number', group: 'Dimension' },
			{ path: 'height', label: 'Height', input: 'number', group: 'Dimension' }
		]);
	});
});

describe('getSharedDataSchema', () => {
	it('returns primitive fields on plot.data[0] and skips column-ref objects', () => {
		const schema = getSharedDataSchema(makeWrapper());
		expect(schema).toContainEqual({ path: 'label', label: 'Label', input: 'text' });
		expect(schema).toContainEqual({ path: 'draw', label: 'Draw', input: 'boolean' });
		expect(schema.some((f) => f.path === 'x' || f.path === 'y')).toBe(false);
	});

	it('returns [] when there is no data', () => {
		const wrapper = makeWrapper();
		wrapper.plot.data = [];
		expect(getSharedDataSchema(wrapper)).toEqual([]);
	});
});

// `descend: true` opts a style sub-object in so its scalar leaves surface, using
// the sub-class's own `static descriptors` for label/input/options.
class FakeStyle {
	static descriptors = {
		colour: { input: 'color', label: 'Colour', group: 'Style' },
		shape: { input: 'select', options: ['circle', 'square'], label: 'Shape', group: 'Style' },
		nested: { skip: false }
	};
	colour = '#ff0000';
	shape = 'circle';
	nested = { deep: 1 }; // object leaf — must NOT be expanded by the descent
	toJSON() {
		return { colour: this.colour, shape: this.shape, nested: this.nested };
	}
}

class FakeRowWithStyle {
	static descriptors = {
		style: { descend: true, label: 'Style' },
		plain: { descend: false } // class instance without opt-in stays opaque
	};
	style = new FakeStyle();
	plain = new FakeAxis();
	toJSON() {
		return { style: this.style.toJSON(), plain: this.plain.toJSON() };
	}
}

describe('descend descriptor', () => {
	function makeStyledWrapper() {
		const inner = new FakePlotClass();
		inner.data = [new FakeRowWithStyle()];
		return { width: 1, height: 1, name: 'p', plot: inner };
	}

	it('expands an opted-in style sub-object into prefixed scalar leaves', () => {
		const schema = getSharedDataSchema(makeStyledWrapper());
		const colour = schema.find((f) => f.path === 'style.colour');
		const shape = schema.find((f) => f.path === 'style.shape');
		expect(colour).toEqual({ path: 'style.colour', label: 'Style Colour', input: 'color', group: 'Style' });
		expect(shape).toEqual({
			path: 'style.shape',
			label: 'Style Shape',
			input: 'select',
			options: ['circle', 'square'],
			group: 'Style'
		});
	});

	it('does not descend into non-opted-in class instances, nor expand nested objects', () => {
		const schema = getSharedDataSchema(makeStyledWrapper());
		expect(schema.some((f) => f.path.startsWith('plain'))).toBe(false);
		expect(schema.some((f) => f.path.startsWith('style.nested'))).toBe(false);
	});
});
