import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs the real wrapper as a child process, in a temp directory with a fake .env whose
// "upload command" is a harmless shell command. Never touches the real deploy.
const SCRIPT = resolve(__dirname, 'deployFtp.mjs');

let dir;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'ancir-deployftp-'));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function deploy(envFile, args = [], extraEnv = {}) {
	if (envFile !== null) writeFileSync(join(dir, '.env'), envFile);
	const env = { ...process.env };
	delete env.DEPLOY_COMMAND;
	delete env.FULL_DEPLOY_COMMAND;
	Object.assign(env, extraEnv);
	const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env, encoding: 'utf8' });
	return { code: r.status, out: r.stdout + r.stderr };
}

describe('deployFtp', () => {
	it('no .env at all: skips with a clear message and exits 0 (the Pages case)', () => {
		const r = deploy(null);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/No \.env in .*FTP upload skipped/);
	});

	it('.env without DEPLOY_COMMAND: skips with a clear message and exits 0', () => {
		const r = deploy('OTHER=1\n');
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/No DEPLOY_COMMAND in \.env; FTP upload skipped/);
	});

	it('a failing upload command exits with that command’s code (7), not 0', () => {
		const r = deploy('DEPLOY_COMMAND="exit 7"\n');
		expect(r.code).toBe(7);
		expect(r.out).toMatch(/FTP upload FAILED: DEPLOY_COMMAND exited with code 7/);
		expect(r.out).not.toMatch(/skipped/);
	});

	it('a succeeding upload command exits 0 and runs in the current directory', () => {
		const r = deploy('DEPLOY_COMMAND="echo uploaded > marker.txt"\n');
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/FTP upload completed/);
		expect(spawnSync('cat', ['marker.txt'], { cwd: dir, encoding: 'utf8' }).stdout).toBe(
			'uploaded\n'
		);
	});

	it('reads the variable named on the command line (uploadall uses FULL_DEPLOY_COMMAND)', () => {
		const r = deploy('DEPLOY_COMMAND="exit 0"\nFULL_DEPLOY_COMMAND="exit 3"\n', [
			'FULL_DEPLOY_COMMAND'
		]);
		expect(r.code).toBe(3);
	});

	it('an environment variable wins over .env, as with node --env-file', () => {
		const r = deploy('DEPLOY_COMMAND="exit 5"\n', [], { DEPLOY_COMMAND: 'exit 0' });
		expect(r.code).toBe(0);
	});

	it('never echoes the command (it carries credentials)', () => {
		const r = deploy('DEPLOY_COMMAND="exit 2 # secret-password"\n');
		expect(r.code).toBe(2);
		expect(r.out).not.toMatch(/secret-password/);
	});
});
