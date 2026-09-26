import { defineConfig } from '@playwright/test';

// E2E_BASE_URL points the suite at a server that is already running (a dev server, or a
// preview of a build made elsewhere), for example:
//   E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
// Without it the config builds and previews the app itself. That build is `buildonly`
// (a bare `vite build`), never `build`, whose postbuild hook deploys the site.
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
					url: baseURL,
					// A production build takes ~15-60 s depending on machine load; Playwright's
					// 60 s default made the whole run fail before the first test on a busy machine.
					timeout: 300_000,
					reuseExistingServer: !process.env.CI
				}
			}),
	use: { baseURL }
});
