import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
import { DataField } from './dataField.svelte';

let _counter = 0;
function getNextId() {
	return _counter++;
}

export class DataItem {
	id;
	name = $state('');
	importedFrom = '';
	dataLength = 0;
	dataFields = $state([]);

	// simulate only
	constructor(name, importedFrom, dataLength) {
		this.id = getNextId();
		this.name = name;
		this.importedFrom = importedFrom;
		this.dataLength = dataLength;
	}


	// getter and setter methods
    setName = (name) => {
		this.name = name;
	}


	// create simulated data through static function
	static simulateDataItem(Ndays, fs_min, startDate, periods, maxHeights) {
		const item = new DataItem('', `simulated(${Ndays},${maxHeights[0]})`, Ndays * 24 * (60 / fs_min));
		item.setName(`Simulated_${item.id}`);
		item.simulateData(fs_min, startDate, periods, maxHeights);
		return item;
	}

	simulateData(fs_min, startDate, periods, maxHeights) {
		//time
		const dft = new DataField(this.id, 'time');
		dft.simulateDataField(fs_min, startDate, periods, maxHeights, this.dataLength);
		this.dataFields.push(dft);

		//value
		for (let i = 0; i < periods.length; i++) {
			const dfv = new DataField(this.id, 'value');
			dfv.simulateDataField(fs_min, startDate, periods[i], maxHeights[i], this.dataLength);
			this.dataFields.push(dfv);
		}
	}
}

/*
    collection.push({ id: 2, name: "✅ Object", count: 1 })
    collection.push(new Ob(3, '✅ Class.toObj()').toObj())
*/
