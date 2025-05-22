import { Column } from '$lib/core/Column.svelte.js';
import { Process } from '$lib/core/Process.svelte.js';
import { core } from '$lib/core/theCore.svelte.js';

function getRandomColor() {
	var letters = '0123456789ABCDEF';
	var color = '#';
	for (var i = 0; i < 6; i++) {
		color += letters[Math.floor(Math.random() * 16)];
	}
	return color;
}

class ScatterDataclass {
	parent = $state();
	x = $state();
	y = $state();
	colour = $state(getRandomColor());
	polyline = $derived.by(() => {
		let out = '';
		let tempx = this.x.getData() ?? [];
		let tempy = this.y.getData() ?? [];

		const xmax = Math.max(...tempx);
		const ymax = Math.max(...tempy);
		for (let p = 0; p < tempx.length; p++) {
			out +=
				(this.parent.width * tempx[p]) / xmax +
				',' +
				(this.parent.height - (this.parent.height * tempy[p]) / this.parent.ylims[1]) +
				' ';
		}

		return out;
	});

	constructor(parent, dataIN) {
		this.parent = parent;

		if (dataIN && dataIN.x) {
			this.x = Column.fromJSON(dataIN.x);
		} else {
			this.x = new Column({ refDataID: -1 });
		}
		if (dataIN && dataIN.y) {
			this.y = Column.fromJSON(dataIN.y);
		} else {
			this.y = new Column({ refDataID: -1 });
		}
	}

	toJSON() {
		return {
			x: this.x,
			y: this.y,
			colour: this.colour
		};
	}

	static fromJSON(json, parent) {
		return new ScatterDataclass(parent, {
			x: json.x,
			y: json.y
		});
	}
}

export class Scatterplotclass {
	width = $state(400);
	height = $state(100);
	data = $state([]);
	ylims = $derived.by(() => {
		let ymin = Infinity;
		let ymax = -Infinity;
		this.data.forEach((d, i) => {
			let tempy = this.data[i].y.getData() ?? [];
			ymin = Math.min(ymin, Math.min(...tempy));
			ymax = Math.max(ymax, Math.max(...tempy));
		});
		return [ymin, ymax];
	});

	constructor(width = 300, height = 100, data) {
		this.width = width;
		this.height = height;
		if (data) {
			this.addData(data);
		}
	}

	addData(dataIN) {
		console.log('din: ', dataIN);
		this.data.push(new ScatterDataclass(this, dataIN));
	}
	removeData(idx) {
		this.data.splice(idx, 1);
	}

	toJSON() {
		return {
			width: this.width,
			height: this.height,
			data: this.data
		};
	}
	static fromJSON(json) {
		if (!json) {
			return new Scatterplotclass();
		}
		const { width, height, data } = json;
		const scatter = new Scatterplotclass(width, height);
		if (data) {
			scatter.data = data.map((d) => ScatterDataclass.fromJSON(d, scatter));
		}
		return scatter;
	}
}
