// @ts-nocheck
import { DateTime } from 'luxon';

import { pushObj } from '$lib/core/theCore.svelte';
import { Table } from '$lib/models/data/table.svelte';

// import {
//     importDataUtils,
//     setFilesToImport,
//     getTempData
// } from '$lib/models/data/importData.svelte';

export function simulateData() {
    // manual handle simulate 
    // create new DataItem object with static method simulateDataItem(Ndays, fs_min, startDate, periods, maxHeights, ID)
    const newDataEntry = Table.simulateTable(
        28,
        15,
        DateTime.now()
            .set({
                hour: 0,
                minute: 0,
                second: 0,
                millisecond: 0
            })
            .toJSDate(),
        [24, 28],
        [100, 150],
    );

    pushObj(newDataEntry);
}

// handleSimulateData()

// export async function importData(e) {
//     setFilesToImport(e.target.files);
//     await importDataUtils.parseFile(6);
//     previewHTML = importDataUtils.makeTempTable(getTempData());
//     importReady = true;
// }
