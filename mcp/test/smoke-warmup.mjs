// Warm-up smoke: the stdio server must answer initialize and tools/list before the engine has
// loaded, return the "Just warming up the bots" message to a tool call made during the load,
// tell the client over logging notifications, and run the same call once warm.
// The load is stretched with ANCIR_MCP_WARMUP_DELAY_MS so this works on a warm machine.
// Run from the mcp/ dir:  node test/smoke-warmup.mjs
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { WARMING_MESSAGE } from '../src/warmup.js';

const t0 = Date.now();
const secs = () => (Date.now() - t0) / 1000;
const transport = new StdioClientTransport({
	command: 'npx',
	args: ['vite-node', 'src/server.js'],
	cwd: process.cwd(),
	stderr: 'inherit',
	env: { ...process.env, ANCIR_MCP_WARMUP_DELAY_MS: '15000', ANCIR_MCP_WARMUP_WAIT_MS: '2000' }
});
const client = new Client({ name: 'smoke-warmup', version: '0.0.1' });
const logs = [];
client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => logs.push(n.params));

await client.connect(transport);
const initS = secs();
const tools = (await client.listTools()).tools;
console.log(`INITIALIZE + TOOLS/LIST: ${secs().toFixed(1)} s (${tools.length} tools)`);
assert.ok(initS < 10, `initialize took ${initS} s`);
assert.equal(tools.length, 9);
assert.match(tools.find((t) => t.name === 'add_plot').description, /scatterplot/);

const first = await client.callTool({ name: 'create_session', arguments: { id: 'warm' } });
console.log(`DURING WARM-UP (${secs().toFixed(1)} s):`, first.content[0].text);
assert.equal(first.isError, true);
assert.ok(first.content[0].text.startsWith(WARMING_MESSAGE));

let res;
for (;;) {
	res = await client.callTool({ name: 'create_session', arguments: { id: 'warm' } });
	if (!res.isError) break;
	assert.ok(secs() < 300, 'engine never became ready');
	await new Promise((ok) => setTimeout(ok, 2000));
}
console.log(`WARM (${secs().toFixed(1)} s):`, res.content[0].text);
assert.deepEqual(JSON.parse(res.content[0].text), { created: true, id: 'warm' });

console.log('LOGS:', logs.map((l) => l.data).join(' | '));
assert.ok(
	logs.some((l) => l.data === WARMING_MESSAGE),
	'warming message logged to the client'
);
assert.ok(
	logs.some((l) => /warmed up/.test(l.data)),
	'ready message logged to the client'
);

await client.close();
console.log('SMOKE-WARMUP OK');
