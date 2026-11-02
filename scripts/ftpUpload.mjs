// FTP upload step of a release: root `deploy:ftp` and `uploadall`, handbook `deploy:ftp`.
//
// Usage: node scripts/ftpUpload.mjs [--dry-run] <path>...
//   a file      uploads to the FTP root under its own name  (build/index.html -> /index.html)
//   a directory uploads its whole tree, paths kept relative  (build -> /index.html, /_app/..., ...)
//
// Configuration, from the environment or a `.env` (the one in the current directory, then the
// workspace root's, so the handbook, run by pnpm --filter with its own cwd, shares the root's):
//   FTP_HOST, FTP_USER, FTP_PASSWORD   required to upload
//   FTP_CONCURRENCY                    parallel transfers, default 4 (shared hosts cap ~8/IP)
// With no FTP_HOST configured it prints a skip message and exits 0: that is the normal case on
// Cloudflare Pages, which builds without a .env.
//
// Why this exists. The previous step was a `.env` one-liner, `find build | while read f; do
// curl -s ... ; done`: one process, one DNS lookup and one FTP login per file (152 of them),
// no retries, errors silenced by -s, and a loop whose exit status is only its LAST file's, so a
// run that lost half its files could still report success. A release failed with curl exit 6
// (could not resolve host) partway through, and nothing said which files were missing.
// This script:
//   - resolves the host ONCE and pins it (--resolve), so a resolver that falters under a burst
//     of lookups cannot fail a transfer;
//   - retries each transfer (5 tries, all errors) and gives up loudly, with curl's message;
//   - runs a few transfers in parallel, each with --ftp-create-dirs;
//   - fails (exit 1) if ANY file failed, naming each one, so partial uploads are never silent;
//   - passes the credentials to curl on stdin (--config -), so they never appear in `ps`, and
//     never prints them.
// The credential is only as safe as the FTP transport it rides on: plain FTP sends it in clear.

import { spawn } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const PORT = 21;
const RETRIES = 5;

/* ── configuration ───────────────────────────────────────────────────────── */

/** Load `.env` from cwd, then from the pnpm workspace root; existing env vars always win. */
function loadEnvFiles() {
	const seen = new Set();
	const tryLoad = (dir) => {
		const f = join(dir, '.env');
		if (seen.has(f) || !existsSync(f)) return;
		seen.add(f);
		process.loadEnvFile(f);
	};
	tryLoad(process.cwd());
	let dir = process.cwd();
	for (;;) {
		if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
			tryLoad(dir);
			break;
		}
		const up = dirname(dir);
		if (up === dir) break;
		dir = up;
	}
}

function parseArgs(argv) {
	const paths = [];
	let dryRun = false;
	for (const a of argv) {
		if (a === '--dry-run') dryRun = true;
		else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
		else paths.push(a);
	}
	if (paths.length === 0) throw new Error('nothing to upload: give at least one file or directory');
	return { paths, dryRun };
}

/* ── the upload plan ─────────────────────────────────────────────────────── */

/** @returns {{ local: string, remote: string }[]} remote paths are POSIX, relative to the FTP root */
export function planUploads(paths) {
	const plan = [];
	for (const p of paths) {
		const abs = resolve(p);
		if (!existsSync(abs)) throw new Error(`${p}: no such file or directory`);
		if (statSync(abs).isDirectory()) {
			for (const file of walk(abs))
				plan.push({ local: file, remote: toPosix(relative(abs, file)) });
		} else {
			plan.push({ local: abs, remote: basename(abs) });
		}
	}
	return plan;
}

function* walk(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name)
	)) {
		const full = join(dir, e.name);
		if (e.isDirectory()) yield* walk(full);
		else if (e.isFile()) yield full;
	}
}

const toPosix = (p) => p.split(sep).join('/');

/* ── one transfer ────────────────────────────────────────────────────────── */

/** curl config-file syntax: a double-quoted string with backslash escapes. */
const curlQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function uploadOne({ local, remote }, { host, ip, user, password }) {
	const url = `ftp://${host}/${remote.split('/').map(encodeURIComponent).join('/')}`;
	const args = [
		'--silent',
		'--show-error',
		'--fail',
		'--retry',
		String(RETRIES),
		'--retry-all-errors',
		'--retry-delay',
		'2',
		'--connect-timeout',
		'20',
		'--max-time',
		'600',
		'--ftp-create-dirs',
		'--config',
		'-',
		'--upload-file',
		local,
		url
	];
	if (ip) args.unshift('--resolve', `${host}:${PORT}:${ip}`);
	return new Promise((done) => {
		const child = spawn('curl', args, { stdio: ['pipe', 'ignore', 'pipe'] });
		let stderr = '';
		child.stderr.on('data', (d) => (stderr += d));
		child.on('error', (err) => done({ remote, ok: false, code: null, message: err.message }));
		child.on('close', (code) =>
			done({
				remote,
				ok: code === 0,
				code,
				message: stderr.trim() || `curl exited with code ${code}`
			})
		);
		child.stdin.end(`user = ${curlQuote(`${user}:${password}`)}\n`);
	});
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	const worker = async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main() {
	const { paths, dryRun } = parseArgs(process.argv.slice(2));
	loadEnvFiles();

	const host = process.env.FTP_HOST;
	if (!host) {
		console.warn('No FTP_HOST configured (.env or environment); FTP upload skipped.');
		return 0;
	}
	const user = process.env.FTP_USER;
	const password = process.env.FTP_PASSWORD;
	if (!dryRun && (!user || !password)) {
		console.error('FTP upload FAILED: FTP_HOST is set but FTP_USER or FTP_PASSWORD is missing.');
		return 1;
	}
	const limit = Math.max(1, parseInt(process.env.FTP_CONCURRENCY || '4', 10) || 4);

	const plan = planUploads(paths);
	if (dryRun) {
		console.log(
			`Dry run: ${plan.length} file(s) would upload to ftp://${host}/ (${limit} in parallel):`
		);
		for (const { local, remote } of plan)
			console.log(`  ${relative(process.cwd(), local)}  ->  /${remote}`);
		return 0;
	}

	// One lookup for the whole run. Resolver trouble then fails here, before anything is sent,
	// instead of partway through 150 transfers.
	let ip = null;
	if (!isIP(host)) {
		try {
			({ address: ip } = await lookup(host, { family: 4 }));
		} catch (err) {
			console.error(`FTP upload FAILED: could not resolve ${host}: ${err.code || err.message}`);
			return 1;
		}
	}

	console.log(`Uploading ${plan.length} file(s) to ftp://${host}/ (${limit} in parallel)...`);
	const t0 = Date.now();
	const results = await pool(plan, limit, (item) => uploadOne(item, { host, ip, user, password }));
	const failed = results.filter((r) => !r.ok);
	const secs = ((Date.now() - t0) / 1000).toFixed(1);

	if (failed.length) {
		console.error(
			`FTP upload FAILED: ${failed.length} of ${plan.length} file(s) did not upload (${secs} s):`
		);
		for (const f of failed) console.error(`  /${f.remote}: ${f.message}`);
		return 1;
	}
	console.log(`FTP upload completed: ${plan.length} file(s) in ${secs} s.`);
	return 0;
}

// Only run when executed directly, so the test can import planUploads.
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
	main().then(
		(code) => process.exit(code),
		(err) => {
			console.error(`FTP upload FAILED: ${err.message}`);
			process.exit(1);
		}
	);
}
