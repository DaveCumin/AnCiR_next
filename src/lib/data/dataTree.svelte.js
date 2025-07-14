// @ts-nocheck
import { DateTime } from 'luxon';

import { pushObj } from '$lib/core/core.svelte';
import { Table } from '$lib/core/table.svelte';

import {
	utils,
	getFilesToImport,
	setFilesToImport,
	getTempData
} from '$lib/data/importData.svelte';

export function simulateData() {
	// manual handle simulate
	// create new DataItem object with static method simulateDataItem(Ndays, fs_min, startDate, periods, maxHeights, Id)
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
		[100, 150]
	);
	// console.log(newDataEntry instanceof Table);
	pushObj(newDataEntry);
}

// handleSimulateData()

// ImportData
export const ImportData = {
	utils,
	getFilesToImport,
	setFilesToImport,
	getTempData
};
