import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
import { DataField } from './dataField.svelte';

export class TestDataItem {
	id;
	importedFrom = '';
	displayName = $state();
	dataLength = 0;
	dataField = $state([]);

	// simulate only
	constructor(Ndays, fs_min, startDate, periods, maxHeights, ID) {
		this.id = ID;
		this.importedFrom = `simulated(${Ndays},${maxHeights[0]})`;
		this.displayName = `Simulated_${ID}`;
		this.dataLength = Ndays * 24 * (60 / fs_min);

		this.simulateData(fs_min, startDate, periods, maxHeights);
	}

	changeName(name) {
		this.displayName = name;
	}

	simulateData(fs_min, startDate, periods, maxHeights) {
		//time
		const df = new DataField(0, 'time', this.dataLength);
		df.newDataField(fs_min, startDate, periods, maxHeights);
		this.dataField.push(df);

		//value
		for (let i = 0; i < periods.length; i++) {
			const dfv = new DataField(this.dataField.length + i, 'value', this.dataLength);
			dfv.newDataField(fs_min, startDate, periods[i], maxHeights[i]);
			this.dataField.push(dfv);
		}
	}

	/*
    collection.push({ id: 2, name: "✅ Object", count: 1 })
    collection.push(new Ob(3, '✅ Class.toObj()').toObj())
    */
}
