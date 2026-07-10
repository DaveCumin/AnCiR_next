// Request validation for /build (zod) + an SSRF guard on the BYO `baseUrl`.
//
// A user-supplied baseUrl means the SERVER makes an outbound request to an arbitrary
// URL — a classic SSRF vector. In "public" mode we require https, block private/loopback/
// link-local hosts, and (by default) restrict to known provider hosts; a deployer can
// relax to "block-private-only" via ALLOW_CUSTOM_LLM_ENDPOINTS=1, or allow localhost via
// ALLOW_LOCAL_LLM=1. In non-public (local dev) mode everything is allowed so a local
// Ollama works.
import { z } from 'zod';

const PROVIDER_HOSTS = new Set([
	'api.openai.com',
	'api.anthropic.com',
	'api.x.ai',
	'api.groq.com',
	'integrate.api.nvidia.com',
	'openrouter.ai',
	'generativelanguage.googleapis.com',
	'api.mistral.ai',
	'api.deepseek.com',
	'api.together.xyz',
	'api.fireworks.ai'
]);

function envHosts() {
	return (process.env.LLM_EXTRA_HOSTS || '')
		.split(',')
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean);
}

// Literal private / loopback / link-local / metadata hosts. (Pragmatic guard: literal
// hosts + IPs. Full DNS-rebinding protection would resolve at connect time.)
function isPrivateHost(hostname) {
	const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
	if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
	const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (m) {
		const [a, b] = [Number(m[1]), Number(m[2])];
		if (a === 127 || a === 0 || a === 10) return true;
		if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
		if (a === 192 && b === 168) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	}
	return false;
}

/**
 * @returns {{ok:true}|{ok:false, error:string}}
 */
export function checkBaseUrl(baseUrl, { isPublic }) {
	let u;
	try {
		u = new URL(baseUrl);
	} catch {
		return { ok: false, error: 'baseUrl is not a valid URL' };
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') {
		return { ok: false, error: 'baseUrl must be http(s)' };
	}
	if (!isPublic) return { ok: true }; // local/dev: permissive (Ollama etc.)

	if (u.protocol !== 'https:') return { ok: false, error: 'baseUrl must be https' };
	const allowLocal = process.env.ALLOW_LOCAL_LLM === '1';
	if (!allowLocal && isPrivateHost(u.hostname)) {
		return { ok: false, error: 'baseUrl host is private/loopback and not allowed' };
	}
	const allowCustom = process.env.ALLOW_CUSTOM_LLM_ENDPOINTS === '1';
	if (!allowCustom) {
		const host = u.hostname.toLowerCase();
		if (!PROVIDER_HOSTS.has(host) && !envHosts().includes(host)) {
			return { ok: false, error: `baseUrl host "${host}" is not an allowed provider` };
		}
	}
	return { ok: true };
}

const clampNum = (lo, hi) => z.coerce.number().min(lo).max(hi);
const clampInt = (lo, hi) => z.coerce.number().int().min(lo).max(hi);

export const buildSchema = z
	.object({
		prompt: z.string().trim().min(1, 'prompt is required').max(4000),
		llm: z
			.object({
				baseUrl: z.string().url().max(500).optional(),
				apiKey: z.string().max(500).optional(),
				model: z.string().max(200).optional()
			})
			.strict()
			.optional(),
		// Cost/abuse levers — clamped server-side.
		options: z
			.object({
				maxTurns: clampInt(1, 24).optional(),
				timeoutMs: clampInt(5000, 120000).optional(),
				retries: clampInt(0, 5).optional(),
				temperature: clampNum(0, 2).optional(),
				topP: clampNum(0, 1).optional(),
				maxTokens: clampInt(1, 8192).optional(),
				parallelToolCalls: z.boolean().optional()
			})
			.strict()
			.optional()
	})
	.strict();

/**
 * Validate + SSRF-check a /build body.
 * @returns {{ok:true, value:object}|{ok:false, error:string}}
 */
export function validateBuild(body, { isPublic }) {
	const parsed = buildSchema.safeParse(body ?? {});
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') };
	}
	const baseUrl = parsed.data.llm?.baseUrl;
	if (baseUrl) {
		const u = checkBaseUrl(baseUrl, { isPublic });
		if (!u.ok) return { ok: false, error: u.error };
	}
	return { ok: true, value: parsed.data };
}
