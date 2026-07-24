import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // Allow importing AnCiR's manifest/sessions from the workspace root (one
    // level up) via the $ancir alias during dev.
    fs: {
      allow: ['..']
    }
  }
});
