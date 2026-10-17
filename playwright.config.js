import { defineConfig } from '@playwright/test';
import { E2E_BUILD_ENV } from './scripts/buildOutput.js';

// E2E_BASE_URL points the suite at a server that is already running (a dev server, or a
// preview of a build made elsewhere), for example:
//   E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
// Without it the config builds and previews the app itself. That build is `buildonly`
// (a bare `vite build`), never `build`, whose postbuild hook deploys the site, and it runs
// with E2E_BUILD_ENV, so it writes .e2e/ and never the repo's tracked build/ (which a test
// run once overwrote) nor the dev server's .svelte-kit (scripts/buildOutput.js).
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4173';

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 90_000,
	...(process.env.E2E_BASE_URL
		? {}
		: {
				webServer: {
					// --strictPort so a busy 4173 fails loudly instead of Vite moving to another
					// port while Playwright waits on this one.
					command: 'pnpm buildonly && pnpm preview --port 4173 --strictPort',
					// Read by svelte.config.js and scripts/csp.mjs, for the build AND the preview.
					env: { ...E2E_BUILD_ENV },
					url: baseURL,
					// A production build takes ~15-60 s depending on machine load; Playwright's
					// 60 s default made the whole run fail before the first test on a busy machine.
					timeout: 300_000,
					reuseExistingServer: !process.env.CI
				}
			}),
	use: { baseURL }
});
