<script>
  // Opens a ready-made AnCiR session straight from the browser.
  //
  // AnCiR (`base`) reads the real query string (window.location.search) for
  // `loadFromURL`, then fetch()es that URL and JSON.parses it. It must resolve
  // to *raw JSON*, so we point at raw.githubusercontent.com — the same source
  // AnCiR's own built-in example uses (AnCiR_next/src/routes/+page.svelte:246).
  // NB: the deployed app path ancir.pages.dev/sessions/*.json returns the SPA
  // HTML shell (200 OK), which would fail JSON.parse with "Unexpected token '<'".
  let {
    session = "",
    label = "Open this example in AnCiR",
    base = "https://ancir.pages.dev",
    sessionBase = "https://raw.githubusercontent.com/DaveCumin/AnCiR_next/refs/heads/main/static"
  } = $props();

  const sessionUrl = $derived(
    /^https?:\/\//.test(session) ? session : `${sessionBase}/${session}`
  );
  const href = $derived(`${base}/?loadFromURL=${encodeURIComponent(sessionUrl)}`);
</script>

<a class="demo-link" {href} target="_blank" rel="noopener noreferrer">
  <svg
    class="demo-icon"
    width="14"
    height="14"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M6.3 4.9a1 1 0 0 0-1.5.86v8.48a1 1 0 0 0 1.5.86l7.5-4.24a1 1 0 0 0 0-1.72L6.3 4.9z" />
  </svg>
  <span>{label}</span>
  <span class="demo-arrow" aria-hidden="true">↗</span>
</a>

<style>
  .demo-link {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-top: 14px;
    padding: 7px 14px;
    background: var(--blue, #3e7295);
    color: #fff;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    text-decoration: none;
    line-height: 1.2;
    transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }
  .demo-link:hover {
    background: #325c79;
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(62, 114, 149, 0.3);
    text-decoration: none;
  }
  .demo-icon {
    flex: none;
    opacity: 0.95;
  }
  .demo-arrow {
    font-size: 0.95em;
    opacity: 0.85;
  }
</style>
