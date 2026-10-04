#!/usr/bin/env node
// Builds the standalone presentation pages into build/animations/ from the
// handbook's own animation components (src/lib/animations/), so the pages
// are always the animations of the handbook they ship with.
//
//   build/animations/<slug>.html   one self-contained page per animation
//   build/animations/index.html    the list, with the handbook version
//
// Each page inlines its script and styles, so it works from any web server,
// from a saved copy opened as a file, and inside a slide's web view or an
// iframe. The page mounts the component through src/standalone/shell.js and
// is styled by app.css (the handbook's look) plus src/standalone/standalone.css
// (the one place that governs sizing on every page).
//
// Run by `pnpm build` after `vite build` (SvelteKit copies static/ into build/
// first, so these pages are written last). Nothing here deploys.
//
// Usage: node scripts/build-animations.mjs [outDir] [--only slug,slug]
//   outDir defaults to build/animations; --only builds a subset while iterating
//   (and skips the coverage check, so never use it for a release build).

import { readdirSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LIB = resolve(ROOT, 'src/lib');
const ANIM_DIR = resolve(LIB, 'animations');
const SHELL = resolve(ROOT, 'src/standalone/shell.js');
const STANDALONE_CSS = resolve(ROOT, 'src/standalone/standalone.css');
const APP_CSS = resolve(ROOT, 'src/app.css');
const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt >= 0 ? new Set(args.splice(onlyAt, 2)[1].split(',')) : null;
const OUT = resolve(ROOT, args[0] ?? 'build/animations');

const { ANIMATIONS, NOT_ANIMATIONS } = await import(
	pathToFileURL(resolve(ROOT, 'src/standalone/registry.js')).href
);
const { VERSION } = await import(pathToFileURL(resolve(LIB, 'version.js')).href);

// ── Coverage: every animation component has a page, or a stated reason ──
const components = readdirSync(ANIM_DIR)
	.filter((f) => f.endsWith('.svelte'))
	.map((f) => basename(f, '.svelte'));
const registered = new Set(ANIMATIONS.map((a) => a.component));
const uncovered = components.filter((c) => !registered.has(c) && !(c in NOT_ANIMATIONS));
const missing = [...registered].filter((c) => !components.includes(c));
if (!ONLY && (uncovered.length || missing.length)) {
	if (uncovered.length)
		console.error(
			`Animation components with no standalone page: ${uncovered.join(', ')}.\n` +
				'Add each to ANIMATIONS (or NOT_ANIMATIONS, with a reason) in src/standalone/registry.js.'
		);
	if (missing.length)
		console.error(`Registry names components that do not exist: ${missing.join(', ')}.`);
	process.exit(1);
}

const escapeHtml = (s) =>
	String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
// Inline <script>/<style> must not contain their own closing tag.
const inlineSafe = (code, tag) => code.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

// Entry modules are generated per page into a scratch folder under
// node_modules (ignored by git, removed at the end).
const ENTRY_DIR = resolve(ROOT, 'node_modules/.standalone-animation-entries');
rmSync(ENTRY_DIR, { recursive: true, force: true });
mkdirSync(ENTRY_DIR, { recursive: true });

async function bundle(name, entryCode) {
	const entry = resolve(ENTRY_DIR, `${name}.js`);
	writeFileSync(entry, entryCode);
	const result = await build({
		configFile: false,
		root: ROOT,
		mode: 'production',
		logLevel: 'warn',
		resolve: { alias: { $lib: LIB } },
		define: { 'process.env.NODE_ENV': '"production"' },
		plugins: [
			svelte({
				configFile: false,
				// The handbook's own `vite build` compiles these same components
				// and reports their warnings; repeating them once per page here
				// would bury real build output.
				compilerOptions: { warningFilter: () => false }
			})
		],
		build: {
			write: false,
			minify: true,
			cssCodeSplit: false,
			modulePreload: false,
			lib: { entry, formats: ['iife'], name: 'HandbookAnimation', fileName: () => 'page.js' }
		}
	});
	const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
	const js = outputs
		.filter((o) => o.type === 'chunk')
		.map((o) => o.code)
		.join('\n');
	const css = outputs
		.filter((o) => o.type === 'asset' && o.fileName.endsWith('.css'))
		.map((o) => (typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')))
		.join('\n');
	return { js, css };
}

function page({ title, description, css, js, bodyClass = '', body }) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="AnCiR handbook ${escapeHtml(VERSION)}" />
<meta name="description" content="${escapeHtml(description)}" />
<title>${escapeHtml(title)}</title>
<style>${inlineSafe(css, 'style')}</style>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
${body}
${js ? `<script>${inlineSafe(js, 'script')}</script>` : ''}
</body>
</html>
`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
let built = 0;
for (const anim of ANIMATIONS) {
	if (ONLY && !ONLY.has(anim.slug)) continue;
	const componentPath = resolve(ANIM_DIR, `${anim.component}.svelte`);
	const entry = `
import Component from ${JSON.stringify(componentPath)};
import { mountStandalone } from ${JSON.stringify(SHELL)};
mountStandalone(Component, ${JSON.stringify(anim.props)});
`;
	const { js, css } = await bundle(anim.slug, entry);
	if (!js || !css) throw new Error(`${anim.slug}: bundle produced no ${js ? 'CSS' : 'JS'}`);
	writeFileSync(
		resolve(OUT, `${anim.slug}.html`),
		page({
			title: `${anim.title} | Handbook animation`,
			description: `${anim.blurb} From ${anim.where} of the AnCiR chronobiology handbook ${VERSION}.`,
			css,
			js,
			body: '<div id="anim-root"></div>'
		})
	);
	console.log(`  animations/${anim.slug}.html  (${anim.component})`);
	built++;
}

// ── Index: same stylesheet, no script ──
const { css: indexCss } = await bundle(
	'index',
	`import ${JSON.stringify(APP_CSS)};\nimport ${JSON.stringify(STANDALONE_CSS)};\n`
);
const cards = ANIMATIONS.map(
	(a) => `<li><a href="${a.slug}.html">
<span class="where">${escapeHtml(a.where)}</span>
<h2>${escapeHtml(a.title)}</h2>
<p>${escapeHtml(a.blurb)}</p>
<code>${a.slug}.html</code>
</a></li>`
).join('\n');
writeFileSync(
	resolve(OUT, 'index.html'),
	page({
		title: 'Handbook animations',
		description: `Standalone animations from the AnCiR chronobiology handbook ${VERSION}, for presentations.`,
		css: indexCss,
		js: '',
		bodyClass: 'anim-index',
		body: `<main>
<h1>Handbook animations <span class="version">${escapeHtml(VERSION)}</span></h1>
<p class="lede">The animations from the <a href="../handbook.html">Chronobiology Handbook</a>, one per page, for use in presentations. Each page is the handbook's own animation, built from the same code as this version of the handbook, and fills whatever window or frame it is shown in.</p>
<ul class="cards">
${cards}
</ul>
<section class="howto">
<h2>Using them in a presentation</h2>
<ul>
<li>Open a page full screen, or embed it in a slide as a web page or <code>&lt;iframe&gt;</code>. It rescales whenever its frame changes size; the controls stay readable.</li>
<li>Add <code>?autoplay</code> to a page's address to start it playing on load, for example <code>sine.html?autoplay</code>.</li>
<li>Each page is a single self-contained file. To present offline, save the page (File, Save Page As) and open the saved copy.</li>
</ul>
</section>
</main>`
	})
);

rmSync(ENTRY_DIR, { recursive: true, force: true });

console.log(
	`Built ${built} standalone animations + index into ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)} s`
);
