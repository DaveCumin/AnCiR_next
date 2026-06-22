// @ts-nocheck
const MIN_INPUT_LEN_FOR_WORKER = 500;
// Aggregate-work threshold for ops whose cost is NOT a single input length but a
// loop of analyses (e.g. MovingAnalysis: windows × y-series × per-window fit).
// Such ops pass `work` (an estimated count of unit analyses); even a modest
// number is worth one off-thread dispatch since each unit is itself a fit/spectrum.
const MIN_WORK_FOR_WORKER = 32;

let _override = null; // null | 'on' | 'off'

export function _setGateOverride(v) {
	_override = v;
}

export function shouldUseWorkers({ inputLen = 0, work = 0 } = {}) {
	if (_override === 'on') return true;
	if (_override === 'off') return false;
	if (typeof Worker === 'undefined') return false;
	return inputLen >= MIN_INPUT_LEN_FOR_WORKER || work >= MIN_WORK_FOR_WORKER;
}
