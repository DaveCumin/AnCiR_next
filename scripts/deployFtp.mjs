// FTP upload step of a release (root `deploy:ftp` / `uploadall`, handbook `deploy:ftp`).
//
// Usage: node scripts/deployFtp.mjs [VAR_NAME]     (VAR_NAME defaults to DEPLOY_COMMAND)
//
// Reads `.env` from the current directory (so the handbook, run by pnpm --filter with its own
// cwd, reads handbook/.env), takes the upload command from VAR_NAME, and runs it in a shell.
// As with `node --env-file`, a variable already set in the environment wins over the file.
//
// Exit codes, which is the point of this script:
//   - no .env, or VAR_NAME unset/empty: "nothing configured", prints a skip message, exits 0.
//     This is the normal case on Cloudflare Pages, which builds without a .env.
//   - the upload command fails: exits with THAT command's exit code (1 if it died by signal),
//     so `npm run build` fails instead of reporting a failed upload as skipped.
//     (The old `... || echo 'FTP upload skipped.'` turned an exit 7 into success.)
//   - the upload command succeeds: exits 0.
//
// The command itself is never echoed: it usually carries FTP credentials.

import { spawnSync } from 'node:child_process';

const varName = process.argv[2] || 'DEPLOY_COMMAND';

try {
	process.loadEnvFile('.env');
} catch (err) {
	if (err?.code === 'ENOENT') {
		console.warn(`No .env in ${process.cwd()}; FTP upload skipped (nothing configured).`);
		process.exit(0);
	}
	console.error(`FTP upload FAILED: could not read .env in ${process.cwd()}: ${err.message}`);
	process.exit(1);
}

const cmd = process.env[varName];
if (!cmd) {
	console.warn(`No ${varName} in .env; FTP upload skipped (nothing configured).`);
	process.exit(0);
}

console.log(`Uploading to FTP (${varName})...`);
const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
if (r.error) {
	console.error(`FTP upload FAILED: could not start ${varName}: ${r.error.message}`);
	process.exit(1);
}
if (r.status !== 0) {
	const code = r.status ?? 1;
	console.error(
		`FTP upload FAILED: ${varName} exited with code ${r.status ?? `null (signal ${r.signal})`}.`
	);
	process.exit(code);
}
console.log('FTP upload completed.');
