/**
 * The epoch length coded on line 4 (index 3) of an Actiwatch / MotionWatch AWD header.
 *
 * Review STAT-U1 (2026-10-03): the importer read every code as code x 15 s. No manufacturer
 * (CamNtech) specification of the AWD header was found. The only published mapping found is
 * the one in pyActigraphy (Hammad et al. 2021, PLoS Comput. Biol. 17:e1009302;
 * pyActigraphy/io/awd/awd.py, `frequency_code`):
 *
 *   '1' 15 s, '2' 30 s, '4' 60 s, '8' 2 min, '20' 5 min, '81' 2 s, 'C1' 5 s, 'C2' 10 s.
 *
 * The first five are code x 15 s, so the old rule agreed with them. '81' read as 1,215 s
 * (20 min 15 s) instead of 2 s, and 'C1' / 'C2' (not numbers) fell back to 1 min instead of
 * 5 s and 10 s. Those three now follow the table. Any other code keeps the old x 15 s reading
 * (or 1 min when it is not a positive number) with `known: false`, so the importer can say
 * the epoch length is a guess.
 */

/** pyActigraphy's frequency_code, in seconds. */
export const AWD_EPOCH_SECONDS = Object.freeze({
	1: 15,
	2: 30,
	4: 60,
	8: 120,
	20: 300,
	81: 2,
	C1: 5,
	C2: 10
});

/**
 * @param {unknown} raw  the header cell (line index 3)
 * @returns {{ seconds: number, known: boolean, code: string }}
 */
export function awdEpochSeconds(raw) {
	const code = String(raw ?? '')
		.trim()
		.toUpperCase();
	if (Object.prototype.hasOwnProperty.call(AWD_EPOCH_SECONDS, code)) {
		return {
			seconds: AWD_EPOCH_SECONDS[/** @type {keyof typeof AWD_EPOCH_SECONDS} */ (code)],
			known: true,
			code
		};
	}
	const n = Number(code);
	if (code !== '' && Number.isFinite(n) && n > 0) return { seconds: n * 15, known: false, code };
	return { seconds: 60, known: false, code };
}

/** True when the header cell is an epoch code the importer can read (a known code or a positive number). */
export function isAwdIntervalCode(raw) {
	const code = String(raw ?? '')
		.trim()
		.toUpperCase();
	if (Object.prototype.hasOwnProperty.call(AWD_EPOCH_SECONDS, code)) return true;
	const n = Number(code);
	return code !== '' && Number.isFinite(n) && n > 0;
}
