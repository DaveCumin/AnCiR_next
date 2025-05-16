import { forceFormat, getPeriod } from '../utils/time/TimeUtils';

export class DataField {
	id;
	// displayName = '';
	type = ''; // future update: categorical ?
	properties = {};
	dataLength = 0;
	dataArr = $state([]); // set everything reactive
	testD = $derived.by(() => {
		// Check if dataArr.content exists and has values
		if (this.dataArr.content && this.dataArr.content.length > 0) {
			return this.dataArr.content[0] + Math.random();
		}
		return 0; // Default value if dataArr.content is empty
	});

	//
	// processArr = {};
	// origin = null;
	// chartArr = {};

	constructor(id, type, dataLength) {
		this.id = id;
		// this.displayName = displayName;
		this.type = type;
		this.dataLength = dataLength;
	}

	// Return for reactivity
	toObj() {
		return {
			id: this.id,
			type: this.type,
			properties: this.properties,
			dataArr: this.dataArr

			// processArr: this.processArr,
		};
	}

    // Populate new dataField based on type
    newDataField(fs_min, startDate, period, maxHeight) {
        switch (this.type) {
            case 'time':
                this.generateTimeData(fs_min, startDate);
                break;
            case 'value':
                this.generateValueData(fs_min, period, maxHeight)
                break;
            default:
                console.log('error: double check type');
        }
    }


	// Data with type 'time'
	generateTimeData(fs_min, startDate) {
		const timeData = [];
		for (let i = 0; i < this.dataLength; i++) {
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
	}

	// Data with type 'value'
	generateValueData(fs_min, period, maxHeight) {
		const valueData = [];

		const periodL = period * (60 / fs_min); //the length of the period

		for (let j = 0; j < this.dataLength; j++) {
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
