// Copy the built handbook into static/, so the AnCiR build (and the dev server) serve the
// handbook that matches this checkout.
//
// Usage: node scripts/syncHandbook.mjs [--if-present]
//
// Source:  handbook/build/handbook.html and handbook/build/animations/   (the handbook's build)
// Target:  static/handbook.html and static/animations/                  (served at /handbook.html,
//          /animations/...; both are gitignored build products)
//
// `build` runs it right after the handbook build, where a missing source is an error.
// `predev` runs it with --if-present: a fresher handbook build is copied in, no handbook build
// means a quiet skip. This replaced a static/handbook.html that could sit for weeks behind the
// handbook source, because only a full root build refreshed it; a reader of the dev server at
// /handbook.html then saw an old handbook and concluded a change had not been made.
//
// Paths are resolved from the workspace root, so the handbook's own scripts can call it too.

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ifPresent = process.argv.includes('--if-present');

function workspaceRoot() {
	let dir = process.cwd();
	for (;;) {
		if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
		const up = dirname(dir);
		if (up === dir)
			throw new Error('not inside the pnpm workspace (no pnpm-workspace.yaml above cwd)');
		dir = up;
	}
}

const root = workspaceRoot();
const srcHtml = join(root, 'handbook', 'build', 'handbook.html');
const srcAnim = join(root, 'handbook', 'build', 'animations');
const dstHtml = join(root, 'static', 'handbook.html');
const dstAnim = join(root, 'static', 'animations');

if (!existsSync(srcHtml)) {
	if (ifPresent) {
		console.log(
			'syncHandbook: no handbook build to copy (run `pnpm build:handbook` to refresh /handbook.html).'
		);
		process.exit(0);
	}
	console.error(`syncHandbook: ${srcHtml} is missing; the handbook build must run first.`);
	process.exit(1);
}

const newer = !existsSync(dstHtml) || statSync(srcHtml).mtimeMs > statSync(dstHtml).mtimeMs;
if (!newer && ifPresent) {
	console.log('syncHandbook: static/handbook.html is already current.');
	process.exit(0);
}

mkdirSync(dirname(dstHtml), { recursive: true });
cpSync(srcHtml, dstHtml);
if (existsSync(srcAnim)) {
	// Replace, not merge: a renamed or removed animation page must not linger.
	rmSync(dstAnim, { recursive: true, force: true });
	cpSync(srcAnim, dstAnim, { recursive: true });
}
console.log(
	`syncHandbook: copied handbook.html${existsSync(srcAnim) ? ' and animations/' : ''} into static/.`
);
