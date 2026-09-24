import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	webServer: {
		// `buildonly` is a bare `vite build`. Never `build`: its postbuild hook deploys
		// the site (MCP release + FTP upload). --strictPort so a busy 4173 fails loudly
		// instead of Vite moving to another port while Playwright waits on this one.
		command: 'pnpm buildonly && pnpm preview --port 4173 --strictPort',
		url: 'http://localhost:4173',
		// A production build takes ~15-60 s depending on machine load; Playwright's
		// 60 s default made the whole run fail before the first test on a busy machine.
		timeout: 300_000,
		reuseExistingServer: !process.env.CI
	},
	use: { baseURL: 'http://localhost:4173' }
});
