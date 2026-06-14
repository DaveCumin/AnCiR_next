// @ts-nocheck
const MIN_INPUT_LEN_FOR_WORKER = 500;

let _override = null; // null | 'on' | 'off'

export function _setGateOverride(v) {
	_override = v;
}

export function shouldUseWorkers({ inputLen = 0 } = {}) {
	if (_override === 'on') return true;
	if (_override === 'off') return false;
	if (typeof Worker === 'undefined') return false;
	return inputLen >= MIN_INPUT_LEN_FOR_WORKER;
}
