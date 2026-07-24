import adapter from "@sveltejs/adapter-static";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),

    // $ancir → the AnCiR app at the workspace root (one level up). Lets the
    // handbook import AnCiR's node manifest and session index directly, instead
    // of copying them in (they now live in the same repo).
    alias: {
      $ancir: "..",
    },

    output: {
      bundleStrategy: "inline",
    },

    router: {
      type: "hash",
    },
  },
  vitePlugin: {
    inspector: true,
  },
};

export default config;
