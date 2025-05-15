import { forceFormat, getPeriod } from '$lib/utils/time/TimeUtils';

export class DataItem {
    id;
    importedFrom;
    displayName = $state('');
    dataLength;
    data;

    // simulate only
    constructor(Ndays, fs_min, startDate, periods, maxheights, ID) {
        this.id = ID;
        this.importedFrom = `simulated(${Ndays},${maxheights[0]})`;
        this.displayName = `Simulated_${ID}`;
        this.dataLength = Ndays * 24 * (60 / fs_min);
        this.data = {};

        this.generateTimeData(fs_min, startDate);
        this.generateValueData(fs_min, periods, maxheights);
    };

    
    generateTimeData(fs_min, startDate) {
        const timeData = [];
        for (let i = 0; i < this.dataLength; i++) {
            const time = new Date(
            startDate.getTime() + i * fs_min * 60 * 1000
            ).toLocaleString("en-US");
            timeData.push(time);
        }

        const timefmt = "M/D/YYYY, h:mm:s A";
        const processedTimeData = forceFormat(timeData, timefmt);
        const timePeriod = getPeriod(timeData, timefmt);

        // future implementation: data.numerical, data.categorical ...
        this.data.time = {
            name: "time",
            type: "time",
            data: timeData,
            timeData: processedTimeData,
            timeFormat: timefmt,
            recordPeriod: timePeriod,
        };
    }

    generateValueData(fs_min, periods, maxheights) {
        for (let i = 0; i < periods.length; i++) {
            // const valueKey = `generated_${i}`;
            const valueData = [];
            const max = maxheights[i];
            const period = periods[i];
            const periodL = period * (60 / fs_min); //the length of the period
        
            for (let j = 0; j < this.dataLength; j++) {
              const isLowPeriod = j % periodL < periodL / 2;
              const mult = isLowPeriod ? max * 0.05 : max;
        
              const randomValue = Math.random() * mult;
              valueData.push(Math.round(randomValue));
            }
            
            //bug
            this.data.value = {
              name: `value${i}`,
              type: "value",
              data: valueData,
            };
        }
    }

}