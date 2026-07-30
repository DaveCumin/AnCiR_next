# ancir-redcap — REDCap import proxy

Phase 1 of the REDCap import feature: the server side only. **No UI yet** — this is
independently testable and deployable, and the app-side node comes next.

```bash
npm run redcap:test      # 26 tests, no network, no deploy
npm run redcap:dev       # wrangler dev --local
npm run redcap:deploy    # wrangler deploy
```

## Why a Worker at all

REDCap's API is a server-to-server POST endpoint that does not send
`Access-Control-Allow-Origin`. A browser can issue the request but **cannot read the
response**; `mode: 'no-cors'` only silences the error and returns an opaque response. So the
call has to happen server-side. There is no client-only version of this feature.

## Why a SEPARATE Worker from `ancir-nl`

- A REDCap incident cannot take the AI button down.
- The two want different CORS: `ancir-nl` allows `*` because nothing secret flows _from_ the
  client. Here a token does, so `/redcap` is restricted to the app's own origins.
- Different rate limits and different log fields.

It holds **no state** — no KV, no D1, no cache — on purpose. The only interesting thing passing
through is a token that must not be stored.

## The API

`POST /redcap`

```jsonc
{
	"endpoint": "https://redcap.auckland.ac.nz/api/",
	"token": "…", // never stored, never logged
	"content": "record", // or "report"
	"reportId": 42 // required when content is "report"
}
```

Returns `text/csv` on success. Errors are JSON `{ error }` with a useful status:

| status | meaning                                                                            |
| ------ | ---------------------------------------------------------------------------------- |
| 400    | bad JSON, missing token, bad `content`, non-numeric `reportId`, non-https endpoint |
| 403    | endpoint host not in the allow-list                                                |
| 413    | response over `REDCAP_MAX_BYTES`                                                   |
| 429    | rate limited                                                                       |
| 502    | REDCap unreachable, or returned an error                                           |

`GET /health` reports `{ ok, allowedHosts }`.

## record vs report

`record` exports everything the token can reach. `report` runs a saved report.

**Prefer `report`.** A REDCap token grants project-wide export, and a saved report can exclude
identifiers — so the credential cannot pull them even if it is misused. `reportId` is required
rather than optional when `content=report`, because silently falling back to a full record
export would turn a careful choice into a broad one.

## The allow-list is the real security control

The **caller** supplies the endpoint URL. Without an allow-list this Worker would POST
arbitrary bodies to arbitrary hosts on request — an SSRF relay usable to reach internal
addresses from Cloudflare's egress, with our domain as the laundering hop.

Matching is on a **dot boundary**, not a bare suffix: `auckland.ac.nz` permits
`redcap.auckland.ac.nz` but rejects `evil-auckland.ac.nz` and `auckland.ac.nz.attacker.com`.
A plain `endsWith` would accept both, which is the hole an allow-list exists to close.

Adding an institution:

```toml
REDCAP_ALLOWED_HOSTS = "auckland.ac.nz,otago.ac.nz"
```

Every entry widens the SSRF surface. Add them one at a time, deliberately. There is no
wildcard, and a bare TLD must never be used.

CORS restriction is **secondary**: it reduces incidental browser exposure, but a non-browser
client ignores CORS entirely. The allow-list and the rate limit are the controls that matter.

## What never happens

- no token in any log line, on any path, success or failure
- no request body logged
- no URL built containing the token
- **no upstream error body forwarded** — REDCap error text can quote the request back, which
  would put the token in our response and in the browser console
- no fetch at all to a non-allow-listed host, or over plain HTTP

`logLine()` takes a fixed field set (`event, outcome, host, content, ms, bytes`) rather than an
arbitrary object, so a later caller cannot over-fill it.

## The tests are mutation-checked

The security properties are asserted, not commented — a behaviour-only suite would stay green
while a refactor leaked a credential on every call. Each of these mutations was applied and
confirmed to FAIL the suite:

| mutation                                        | caught by                                 |
| ----------------------------------------------- | ----------------------------------------- |
| bare suffix match instead of dot boundary       | the lookalike-domain assertions           |
| forward the upstream error body                 | "an upstream error body is NOT forwarded" |
| wildcard CORS fallback for unknown origins      | "an unknown origin gets NO ACAO header"   |
| dump the whole `fields` object inside `logLine` | the every-line token scan                 |
| log the incoming payload in `handleRedcap`      | 3 tests                                   |

That fourth one initially **passed**, because the assertion only inspected the last log line.
An extra log statement hid behind the permitted one. Fixed by scanning every line — worth
recording, because it is the exact shape of mistake this suite exists to prevent.

## Before this is deployed

1. `wrangler deploy --config redcap-worker/wrangler.toml`, then confirm `/health` reports the
   expected allow-list.
2. Set `ALLOWED_ORIGINS` to the real app origin if it is not `ancir.pages.dev`.
3. Decide `record` vs `report` policy with whoever owns the REDCap project. If the data is
   identifiable, a de-identified saved report is the answer, and that is a conversation before
   it is a config value.
