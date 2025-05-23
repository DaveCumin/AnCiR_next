import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
import { core } from '$lib/core/theCore.svelte';

let _counter = 0;
function getNextId() {
	return _counter++;
}

export class Column {
	id;
	parentId = $state();
	refId = $state(null); //if it is a column that is based on another

	name = $derived.by(() => {
		if (this.refId !== null) {
			return core.data[this.parentId].find((df) => df.id === this.refId)?.name;
		}
	})
	type = $derived.by(() => {
		if (this.refId !== null) {
			return core.data[this.parentId].find((df) => df.id === this.refId)?.type;
		}
	})
	
	properties = $state([]);
	// compression = $state(null);
	// timeformat = $state();
	dataArr = $state(); // set everything reactive
	processArr = $state([]); // implement later

	constructor(parentId, type) {
		this.id = getNextId();
		this.parentId = parentId;
		this.type = type;
	}


    // Simulate new dataField based on type
    simulateColumn(fs_min, startDate, period, maxHeight, dataLength) {
        switch (this.type) {
            case 'time':
                this.generateTimeData(fs_min, startDate, dataLength);
                break;
            case 'value':
                this.generateValueData(fs_min, period, maxHeight, dataLength)
                break;
            default:
                console.log('error: double check type');
        }
    }


	// Data with type 'time'
	generateTimeData(fs_min, startDate, dataLength) {
		const timeData = [];
		for (let i = 0; i < dataLength; i++) {
			const time = new Date(startDate.getTime() + i * fs_min * 60 * 1000).toLocaleString('en-US');
			timeData.push(time);
		}

		const timefmt = 'M/D/YYYY, h:mm:s A';
		const processedTimeData = forceFormat(timeData, timefmt);
		const timePeriod = getPeriod(timeData, timefmt);

        this.dataArr = processedTimeData;

		// this.properties = {
		// 	timeFormat: timefmt,
		// 	recordPeriod: timePeriod
		// };

		// refactor dataArr and properties
	}

	// Data with type 'value'
	generateValueData(fs_min, period, maxHeight, dataLength) {
		const valueData = [];

		const periodL = period * (60 / fs_min); //the length of the period

		for (let j = 0; j < dataLength; j++) {
			const isLowPeriod = j % periodL < periodL / 2;
			const mult = isLowPeriod ? maxHeight * 0.05 : maxHeight;

			const randomValue = Math.random() * mult;
			valueData.push(Math.round(randomValue));
		}
		this.dataArr = valueData;

		// this.properties = {
		// }
	}
}
