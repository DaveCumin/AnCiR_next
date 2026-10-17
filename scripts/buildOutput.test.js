// The e2e suite's own build must never write the repo's build/ (the tracked, deployed page).
//
// Without E2E_BASE_URL, playwright.config.js starts a web server that builds the app. That
// build used to be a plain `pnpm buildonly`, which writes build/ (adapter-static) and then
// rewrites build/index.html (scripts/csp.mjs): a test run clobbered David's build/ once.
// The e2e server now builds into .e2e/ through ANCIR_BUILD_DIR / ANCIR_KIT_DIR, which
// svelte.config.js and csp.mjs read; with neither set, the normal build is unchanged.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { buildOutputDirs, E2E_BUILD_ENV } from './buildOutput.js';

const ROOT = resolve(import.meta.dirname, '..');
const inRepoBuild = (dir) => resolve(ROOT, dir) === resolve(ROOT, 'build');

describe('buildOutputDirs', () => {
	it('defaults to build/ and .svelte-kit (the normal `npm run build`)', () => {
		expect(buildOutputDirs({})).toEqual({ pages: 'build', kitOutDir: '.svelte-kit' });
	});

	it('follows ANCIR_BUILD_DIR / ANCIR_KIT_DIR', () => {
		expect(buildOutputDirs({ ANCIR_BUILD_DIR: 'x/out', ANCIR_KIT_DIR: 'x/kit' })).toEqual({
			pages: 'x/out',
			kitOutDir: 'x/kit'
		});
	});

	it('the e2e environment points both away from build/ and .svelte-kit', () => {
		const dirs = buildOutputDirs(E2E_BUILD_ENV);
		expect(inRepoBuild(dirs.pages)).toBe(false);
		expect(resolve(ROOT, dirs.kitOutDir)).not.toBe(resolve(ROOT, '.svelte-kit'));
	});
});

describe('svelte.config.js', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	const adapterPages = async () => {
		vi.resetModules();
		const captured = {};
		vi.doMock('@sveltejs/adapter-static', () => ({
			default: (opts) => {
				Object.assign(captured, opts);
				return { name: 'adapter-static-stub' };
			}
		}));
		const config = (await import('../svelte.config.js')).default;
		vi.doUnmock('@sveltejs/adapter-static');
		return { ...captured, kitOutDir: config.kit.outDir ?? '.svelte-kit' };
	};

	it('writes build/ by default', async () => {
		vi.stubEnv('ANCIR_BUILD_DIR', '');
		vi.stubEnv('ANCIR_KIT_DIR', '');
		const c = await adapterPages();
		expect(c.pages).toBe('build');
		expect(c.assets).toBe('build');
		expect(c.kitOutDir).toBe('.svelte-kit');
	});

	it('writes the e2e directory under the e2e environment', async () => {
		for (const [k, v] of Object.entries(E2E_BUILD_ENV)) vi.stubEnv(k, v);
		const c = await adapterPages();
		expect(c.pages).toBe(E2E_BUILD_ENV.ANCIR_BUILD_DIR);
		expect(c.assets).toBe(E2E_BUILD_ENV.ANCIR_BUILD_DIR);
		expect(c.kitOutDir).toBe(E2E_BUILD_ENV.ANCIR_KIT_DIR);
	});
});

describe('playwright.config.js', () => {
	// The real @playwright/test opens a connection when imported into vitest; the config
	// only needs defineConfig, which returns its argument.
	vi.mock('@playwright/test', () => ({ defineConfig: (c) => c }));
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('without E2E_BASE_URL its web server builds with the e2e environment, never into build/', async () => {
		vi.stubEnv('E2E_BASE_URL', '');
		vi.resetModules();
		const config = (await import('../playwright.config.js')).default;
		const ws = config.webServer;
		expect(ws).toBeTruthy();
		expect(ws.env).toMatchObject(E2E_BUILD_ENV);
		// Never the deploying build, never an explicit write to build/.
		expect(ws.command).not.toMatch(/\bpnpm (run )?build\b|npm run build\b/);
		expect(ws.command).not.toMatch(/(^|[\s=/])\.?\/?build(\/|\s|$)/);
	});

	it('with E2E_BASE_URL it starts no server at all', async () => {
		vi.stubEnv('E2E_BASE_URL', 'http://localhost:5197');
		vi.resetModules();
		const config = (await import('../playwright.config.js')).default;
		expect(config.webServer).toBeUndefined();
	});
});
