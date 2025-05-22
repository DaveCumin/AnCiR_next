let tableidCounter = 0;

export class Table {
	tableid;
	name = $state(); //name of the table
	columnRefs = $state([]); //Reference IDs for the raw data that are columns

	//TODO: consider metadata (file imported from, simulated settings, etc).
	// should these be in the table or column (both)? Columns can move, so maybe there... make 'metadata' a separate thing and point to it from Table and Cols?

	constructor({ ...dataIN }, id = null) {
		if (id === null) {
			this.tableid = id ?? tableidCounter;
			tableidCounter++;
		} else {
			this.tableid = id;
			tableidCounter = Math.max(id + 1, tableidCounter + 1);
		}
		this.name = dataIN.name;
		if (dataIN.columnRefs) {
			this.columnRefs = dataIN.columnRefs;
		} else {
			this.columnRefs = [];
		}
	}

	addColumn(dataIN) {
		this.columnRefs.push(dataIN);
	}
	removeColumn(idx) {
		this.columnRefs = this.columnRefs.filter((_, i) => i !== idx);
	}

	toJSON() {
		return {
			tableid: this.tableid,
			name: this.name,
			columnRefs: this.columnRefs
		};
	}

	static fromJSON(json) {
		const { tableid, name, columnRefs } = json;
		let table = new Table({ name, columnRefs }, tableid);
		return table;
	}
}
