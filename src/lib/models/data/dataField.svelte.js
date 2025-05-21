import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';
import { data } from '$lib/store.svelte';

export class DataField {
	id;
	refDataID = $state(null); //if it is a column that is based on another
	properties = {};
	dataArr = $state([]); // set everything reactive
	
	displayName = $derived.by(() => {
		if(this.refDataID !== null){
			return data.find((column) => column.columnID === this.refDataID)?.name
		}
		// else generate?
	});
	type = $derived.by(() => {
		if(this.refDataID !== null){
			return data.find((column) => column.columnID === this.refDataID)?.type
		}
	});
	timeformat = $state();
	processArr = $state([]); // implement later

	constructor(id, type) {
		this.id = id;
		this.type = type;
	}


    // Simulate new dataField based on type
    simulateDataField(fs_min, startDate, period, maxHeight, dataLength) {
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

        this.dataArr = {
            raw: timeData,
            content: processedTimeData,
            // derived_by: raw -> format -> process2
        };

		this.properties = {
			timeFormat: timefmt,
			recordPeriod: timePeriod
		};

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

		this.dataArr = {
			// raw: valueData // consistency but duplication
			content: valueData
		};

		// this.properties = {
		// }
	}
}
