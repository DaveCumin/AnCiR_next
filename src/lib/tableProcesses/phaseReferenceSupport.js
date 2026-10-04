// @ts-nocheck
// Node-side glue for the shared phase reference (src/lib/utils/phaseReference.js):
// reads the session's display timezone, which the pure util must not touch.
//
// The zone is read ONLY in clock mode. Node compute tests mock core.svelte with
// just `core` and `appConsts`; reading `appState` unconditionally would break
// every one of them for a mode they do not use.
import { getDisplayZone } from '$lib/utils/time/displayTime.js';
import {
	PHASE_REFERENCE_CLOCK,
	resolvePhaseReference,
	timeOriginMs
} from '$lib/utils/phaseReference.js';

/**
 * Resolve a node's `phaseReference` arg against its x column.
 *
 * @param {object} argsIN  the node args (`phaseReference` absent = since first sample)
 * @param {object|null} xCol  the x column phases are measured on
 * @returns {{clock: boolean, offsetHours: number, warning: string|null}}
 */
export function resolveNodePhaseReference(argsIN, xCol) {
	if (argsIN?.phaseReference !== PHASE_REFERENCE_CLOCK) return resolvePhaseReference(undefined);
	return resolvePhaseReference(PHASE_REFERENCE_CLOCK, timeOriginMs(xCol), getDisplayZone());
}
