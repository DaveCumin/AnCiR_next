// Structured logging (pino) with hard secret redaction. Used by the backend instead of
// raw console.* so hosted deploys get parseable JSON logs. LOG_LEVEL sets verbosity.
import pino from 'pino';

export const log = pino(
	{
		level: process.env.LOG_LEVEL || 'info',
		// Belt-and-suspenders: never emit an API key / auth header even if one slips into
		// a logged object.
		redact: {
			paths: ['apiKey', 'llm.apiKey', 'req.headers.authorization', 'headers.authorization', '*.apiKey'],
			censor: '[redacted]'
		},
		base: undefined // omit pid/hostname noise
	},
	// Write to stderr (fd 2), keeping stdout clean and matching the prior console.error
	// behaviour that readiness-probing test harnesses watch. Sync so the startup line is
	// visible immediately.
	pino.destination({ dest: 2, sync: true })
);
