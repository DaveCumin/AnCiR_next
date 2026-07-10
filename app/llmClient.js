// Thin OpenAI-compatible chat client with retry/backoff + timeout. Transport-level
// reliability only — it never throws on a normal HTTP error (returns it so the caller
// can handle e.g. Groq's `tool_use_failed`); it retries transient failures (429, 408,
// 5xx, network) with exponential backoff + jitter, honouring Retry-After.
const RETRYABLE = (status) => status === 429 || status === 408 || (status >= 500 && status <= 599);

function backoffDelay(attempt, retryAfterMs, baseDelayMs) {
	if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
	const capped = Math.min(baseDelayMs * 2 ** attempt, 8000);
	return Math.round(capped * (0.5 + Math.random() * 0.5)); // 50–100% jitter
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{baseUrl:string, apiKey:string, model:string}} cfg
 * @param {object} body  extra chat-completions params (messages, tools, temperature, …)
 * @param {{retries?:number, timeoutMs?:number, baseDelayMs?:number, onRetry?:Function}} [opts]
 * @returns {Promise<{ok:boolean, status:number, message?:object, json?:any, body?:string}>}
 *   ok → { message } (choices[0].message). Non-retryable HTTP error → { ok:false, status,
 *   body, json }. Throws only when retries are exhausted on a transient/network failure.
 */
export async function chatCompletion(cfg, body, opts = {}) {
	const { retries = 3, timeoutMs = 90000, baseDelayMs = 500, onRetry } = opts;
	const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
	const payload = JSON.stringify({ model: cfg.model, ...body });

	for (let attempt = 0; ; attempt++) {
		let res;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
				body: payload,
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (err) {
			// Network error / timeout (AbortError) — retry if we have budget.
			if (attempt < retries) {
				const delay = backoffDelay(attempt, null, baseDelayMs);
				onRetry?.({ attempt: attempt + 1, reason: `network:${err?.name || err?.message}`, delayMs: delay });
				await sleep(delay);
				continue;
			}
			throw new Error(`LLM request failed after ${retries + 1} attempts: ${err?.message || err}`);
		}

		if (res.ok) {
			const json = await res.json();
			return { ok: true, status: res.status, message: json?.choices?.[0]?.message, json };
		}

		const text = await res.text();
		if (RETRYABLE(res.status) && attempt < retries) {
			const ra = Number(res.headers.get('retry-after'));
			const delay = backoffDelay(attempt, Number.isFinite(ra) ? ra * 1000 : null, baseDelayMs);
			onRetry?.({ attempt: attempt + 1, reason: `http:${res.status}`, delayMs: delay });
			await sleep(delay);
			continue;
		}
		let json;
		try {
			json = JSON.parse(text);
		} catch {
			/* not JSON */
		}
		return { ok: false, status: res.status, body: text, json };
	}
}
