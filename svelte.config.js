import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),

		output: {
			bundleStrategy: 'inline'
		},

		router: {
			type: 'hash'
		}
	},
	vitePlugin: {
		inspector: true
	}
};

export default config;
