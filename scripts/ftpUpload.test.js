// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
	existsSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { planUploads } from './ftpUpload.mjs';

// Runs the real script as a child process against a FAKE curl placed first on PATH, in a temp
// directory with no .env above it. Nothing touches the network or the real deploy.
const SCRIPT = resolve(__dirname, 'ftpUpload.mjs');

let dir, bin, log, stdinLog;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'ancir-ftpupload-'));
	bin = join(dir, 'bin');
	mkdirSync(bin);
	log = join(dir, 'curl-args.log');
	stdinLog = join(dir, 'curl-stdin.log');
	// Each call appends one JSON line of its argv, saves stdin, and fails (curl's exit 6,
	// "could not resolve host") when FAKE_CURL_FAIL matches any argument.
	writeFileSync(
		join(bin, 'curl'),
		`#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
cat >> "${stdinLog}"
if [ -n "$FAKE_CURL_FAIL" ] && printf '%s\\n' "$*" | grep -q -- "$FAKE_CURL_FAIL"; then
  echo "curl: (6) Could not resolve host: fake" >&2
  exit 6
fi
exit 0
`
	);
	chmodSync(join(bin, 'curl'), 0o755);
	// a small tree to upload
	mkdirSync(join(dir, 'build', 'sub', 'deep'), { recursive: true });
	writeFileSync(join(dir, 'build', 'index.html'), '<html>');
	writeFileSync(join(dir, 'build', 'sub', 'a.json'), '{}');
	writeFileSync(join(dir, 'build', 'sub', 'deep', 'b.css'), 'x{}');
	writeFileSync(join(dir, 'single.js'), '1');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args, extraEnv = {}) {
	const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
	for (const k of ['FTP_HOST', 'FTP_USER', 'FTP_PASSWORD', 'FTP_CONCURRENCY', 'FAKE_CURL_FAIL'])
		delete env[k];
	Object.assign(env, extraEnv);
	const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env, encoding: 'utf8' });
	return { code: r.status, out: r.stdout + r.stderr };
}
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
const CREDS = {
	FTP_HOST: '127.0.0.1',
	FTP_USER: 'someone@example.org',
	FTP_PASSWORD: 'p"a\\ss w0rd'
};

describe('ftpUpload: the plan', () => {
	it('a file goes to the root under its own name; a directory keeps its tree', () => {
		const plan = planUploads([join(dir, 'single.js'), join(dir, 'build')]).map((p) => p.remote);
		expect(plan).toEqual(['single.js', 'index.html', 'sub/a.json', 'sub/deep/b.css']);
	});
	it('a missing path is an error', () => {
		expect(() => planUploads([join(dir, 'nope')])).toThrow(/no such file/);
	});
});

describe('ftpUpload: the run', () => {
	it('nothing configured (the Pages case): skips with a message and exits 0, calling nothing', () => {
		const r = run(['build']);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/No FTP_HOST configured.*skipped/);
		expect(calls()).toEqual([]);
	});

	it('a host without credentials is a configuration failure, not a skip', () => {
		const r = run(['build'], { FTP_HOST: '127.0.0.1' });
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/FTP_USER or FTP_PASSWORD is missing/);
		expect(calls()).toEqual([]);
	});

	it('--dry-run lists every file and its remote path and calls nothing', () => {
		const r = run(['--dry-run', 'build', 'single.js'], { FTP_HOST: 'ftp.example.invalid' });
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/4 file\(s\) would upload to ftp:\/\/ftp\.example\.invalid\//);
		expect(r.out).toMatch(/sub\/deep\/b\.css {2}-> {2}\/sub\/deep\/b\.css/);
		expect(r.out).toMatch(/single\.js {2}-> {2}\/single\.js/);
		expect(calls()).toEqual([]);
	});

	it('uploads every file with retries, create-dirs, and the credential on stdin, never in argv or output', () => {
		const r = run(['build', 'single.js'], CREDS);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/FTP upload completed: 4 file\(s\)/);
		const c = calls();
		expect(c).toHaveLength(4);
		for (const line of c) {
			expect(line).toMatch(/--retry 5 --retry-all-errors/);
			expect(line).toMatch(/--ftp-create-dirs/);
			expect(line).toMatch(/--config -/);
			expect(line).toMatch(/--fail/);
			expect(line).not.toMatch(/w0rd/);
			expect(line).not.toMatch(/-u /);
		}
		expect(c.some((l) => l.endsWith('ftp://127.0.0.1/sub/deep/b.css'))).toBe(true);
		expect(c.some((l) => l.endsWith('ftp://127.0.0.1/single.js'))).toBe(true);
		// the credential went down stdin as a curl config line, escaped for curl's quoting
		expect(readFileSync(stdinLog, 'utf8')).toContain(
			'user = "someone@example.org:p\\"a\\\\ss w0rd"'
		);
		expect(r.out).not.toMatch(/w0rd/);
	});

	it('pins the resolved address with --resolve when the host is a name', () => {
		const r = run(['single.js'], { ...CREDS, FTP_HOST: 'localhost' });
		expect(r.code).toBe(0);
		expect(calls()[0]).toMatch(/--resolve localhost:21:127\.0\.0\.1/);
	});

	it('does not pass --resolve for a literal IP', () => {
		run(['single.js'], CREDS);
		expect(calls()[0]).not.toMatch(/--resolve/);
	});

	it('an unresolvable host fails before any transfer, naming the host', () => {
		const r = run(['single.js'], { ...CREDS, FTP_HOST: 'no-such-host.invalid' });
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/could not resolve no-such-host\.invalid/);
		expect(calls()).toEqual([]);
	});

	it('one failed file fails the run, is named with curl’s message, and the rest still upload', () => {
		const r = run(['build', 'single.js'], { ...CREDS, FAKE_CURL_FAIL: 'sub/a.json' });
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/FTP upload FAILED: 1 of 4 file\(s\) did not upload/);
		expect(r.out).toMatch(/\/sub\/a\.json: curl: \(6\) Could not resolve host/);
		expect(calls()).toHaveLength(4);
		expect(r.out).not.toMatch(/w0rd/);
	});

	it('honours FTP_CONCURRENCY and still uploads everything', () => {
		const r = run(['build'], { ...CREDS, FTP_CONCURRENCY: '1' });
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/\(1 in parallel\)/);
		expect(calls()).toHaveLength(3);
	});

	it('an environment variable wins over .env, as with node --env-file', () => {
		writeFileSync(join(dir, '.env'), "FTP_HOST=127.0.0.1\nFTP_USER=u\nFTP_PASSWORD='from-file'\n");
		const r = run(['single.js'], { FTP_PASSWORD: 'from-env' });
		expect(r.code).toBe(0);
		expect(readFileSync(stdinLog, 'utf8')).toContain('u:from-env');
	});
});
