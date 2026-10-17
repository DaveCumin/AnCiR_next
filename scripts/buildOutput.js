// Where a build writes, in one place: svelte.config.js (adapter-static `pages`/`assets` and
// SvelteKit's `outDir`), scripts/csp.mjs (which rewrites the built index.html) and
// playwright.config.js (whose web server builds a private copy for the e2e suite).
//
// The normal build (`npm run build`, `pnpm buildonly`) sets neither variable and writes
// build/ and .svelte-kit as always. The e2e web server sets E2E_BUILD_ENV, so a test run
// never touches the tracked, deployed build/ (it once did), nor the dev server's .svelte-kit.

/** The environment playwright.config.js gives its build-and-preview web server. */
export const E2E_BUILD_ENV = Object.freeze({
	ANCIR_BUILD_DIR: '.e2e/build',
	ANCIR_KIT_DIR: '.e2e/svelte-kit'
});

/**
 * @param {Record<string, string|undefined>} env usually process.env
 * @returns {{ pages: string, kitOutDir: string }}
 */
export function buildOutputDirs(env) {
	return {
		pages: env.ANCIR_BUILD_DIR || 'build',
		kitOutDir: env.ANCIR_KIT_DIR || '.svelte-kit'
	};
}
