import { defineConfig } from '@playwright/test';

// E2E_BASE_URL points the suite at a server that is already running (a dev server, or a
// preview of a build made elsewhere). Without it the config builds and previews the app,
// and `npm run build` DEPLOYS (postbuild), so a local run should always set it:
//   E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4173';

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 90_000,
	...(process.env.E2E_BASE_URL
		? {}
		: {
				webServer: {
					command: 'npm run build && npm run preview',
					url: baseURL,
					reuseExistingServer: !process.env.CI
				}
			}),
	use: { baseURL }
});
