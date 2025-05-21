import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
import { DataField } from './dataField.svelte';
import { data } from '$lib/store.svelte';

export class DataItem {
	id;
	importedFrom = '';
	displayName = $state('');
	dataLength = 0;
	dataField = $state([]);

	// simulate only
	constructor(ID, importedFrom, displayName, dataLength) {
		this.id = ID;
		this.importedFrom = importedFrom;
		this.displayName = displayName;
		this.dataLength = dataLength;
		
	}


	// getter and setter methods
    setName = (name) => {
		this.displayName = name;
	}


	// create simulated data through static function
	static simulateDataItem(Ndays, fs_min, startDate, periods, maxHeights, ID) {
		const item = new DataItem(ID, `simulated(${Ndays},${maxHeights[0]})`, `Simulated_${ID}`, Ndays * 24 * (60 / fs_min));
		item.simulateData(fs_min, startDate, periods, maxHeights);
		return item;
	}

	simulateData(fs_min, startDate, periods, maxHeights) {
		//time
		const df = new DataField(0, 'time');
		df.simulateDataField(fs_min, startDate, periods, maxHeights, this.dataLength);
		this.dataField.push(df);

		//value
		for (let i = 0; i < periods.length; i++) {
			const dfv = new DataField(this.dataField.length + i, 'value');
			dfv.simulateDataField(fs_min, startDate, periods[i], maxHeights[i], this.dataLength);
			this.dataField.push(dfv);
		}
	}
}

/*
    collection.push({ id: 2, name: "✅ Object", count: 1 })
    collection.push(new Ob(3, '✅ Class.toObj()').toObj())
*/
