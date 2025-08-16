import fs from 'fs';
import { execSync } from 'child_process';

const buildNumber = execSync('git rev-parse --short HEAD').toString().trim();

fs.writeFileSync(
	'./src/lib/utils/build-info.js',
	`export const buildInfo = { buildNumber: "${buildNumber}" };`
);
