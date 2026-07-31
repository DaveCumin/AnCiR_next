<script>
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import SectionHead from "$lib/components/SectionHead.svelte";
  import { VERSION } from "$lib/version.js";
  import manifest from "$ancir/static/nodes.json";

  // The handbook and AnCiR are archived as two separate Zenodo records, so that
  // the handbook can be cited at its own version rather than at whichever AnCiR
  // release happened to ship alongside it.
  const DOI = "10.5281/zenodo.21727169"; // this handbook
  const DOI_URL = `https://doi.org/${DOI}`;
  const ANCIR_DOI = "10.5281/zenodo.19340642"; // the AnCiR software
  const ANCIR_DOI_URL = `https://doi.org/${ANCIR_DOI}`;
  const REPO = "https://github.com/DaveCumin/AnCiR_next";
  const YEAR = 2026;

  // The AnCiR release is stamped into nodes.json by the manifest generator, so
  // the version shown here follows a version bump automatically. The display
  // form carries a prefix ("β.72.8"); the citation wants the plain, tag-matching
  // form ("72.8").
  const ancirDisplay = manifest.generatedFromVersion ?? "unknown";
  const ancirVersion = ancirDisplay.replace(/^[^0-9]*/, "");

  const citation =
    `Cumin D. A Handbook of Chronobiological Data Analysis. ` +
    `Version ${VERSION}. Zenodo; ${YEAR}. doi:${DOI}`;

  const bibtex = `@book{cumin_handbook,
  author    = {Cumin, David},
  title     = {A Handbook of Chronobiological Data Analysis},
  version   = {${VERSION}},
  year      = {${YEAR}},
  publisher = {Zenodo},
  doi       = {${DOI}},
  url       = {${DOI_URL}}
}`;

  const ancirCitation =
    `Cumin D. AnCiR: Analysis of Chronobiological Rhythms. ` +
    `Version ${ancirVersion}. Zenodo; ${YEAR}. doi:${ANCIR_DOI}`;

  let copied = $state("");

  async function copy(text, which) {
    try {
      await navigator.clipboard.writeText(text);
      copied = which;
      setTimeout(() => (copied = ""), 2000);
    } catch {
      // Clipboard access is blocked in some contexts (notably a handbook.html
      // opened straight off disk). Say so rather than failing silently.
      copied = `${which}-failed`;
      setTimeout(() => (copied = ""), 4000);
    }
  }

  function label(which) {
    if (copied === which) return "Copied";
    if (copied === `${which}-failed`) return "Select and copy manually";
    return "Copy";
  }
</script>

<ChapterSection id="colophon" num="Colophon" title="Citation, Licence, and Versions">
  <p class="chapter-intro">
    This handbook is archived and citable. It has its own Zenodo record, separate
    from AnCiR, so a citation resolves to a fixed, preserved snapshot of the text
    rather than to whatever the website happens to serve today, and its version
    reflects changes to the handbook rather than to the software.
  </p>

  <SectionHead text="How to cite the handbook" />

  <p>
    Cite the Zenodo record. The DOI below is a <em>concept</em> DOI: it always
    resolves to the most recent release, and each release also has its own
    version DOI if you need to pin a specific one. Please cite the version you
    actually used.
  </p>

  <div class="cite-block">
    <div class="cite-text">{citation}</div>
    <button class="copy-btn" onclick={() => copy(citation, "cite")}>
      {label("cite")}
    </button>
  </div>

  <p class="doi-line">
    DOI:
    <a href={DOI_URL} target="_blank" rel="noopener">{DOI_URL}</a>
  </p>

  <div class="cite-block">
    <pre class="bibtex">{bibtex}</pre>
    <button class="copy-btn" onclick={() => copy(bibtex, "bib")}>
      {label("bib")}
    </button>
  </div>

  <SectionHead text="How to cite AnCiR" />

  <p>
    If your analysis was carried out in AnCiR, cite the software as well. It is a
    separate record with its own DOI and its own version history.
  </p>

  <div class="cite-block">
    <div class="cite-text">{ancirCitation}</div>
    <button class="copy-btn" onclick={() => copy(ancirCitation, "ancir")}>
      {label("ancir")}
    </button>
  </div>

  <p class="doi-line">
    AnCiR DOI:
    <a href={ANCIR_DOI_URL} target="_blank" rel="noopener">{ANCIR_DOI_URL}</a>
  </p>

  <SectionHead text="Licence" />

  <p>
    The two works carry different licences, because they are different kinds of
    thing. They share one source repository.
  </p>

  <table class="licence-table">
    <thead>
      <tr><th>What</th><th>Licence</th><th>In practice</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>AnCiR, the software</td>
        <td>
          <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">
            Apache-2.0
          </a>
        </td>
        <td>
          Use, modify, and redistribute, including commercially, provided you
          keep the notices and state your changes.
        </td>
      </tr>
      <tr>
        <td>This handbook (text, figures, animations)</td>
        <td>
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">
            CC BY 4.0
          </a>
        </td>
        <td>
          Copy, adapt, and reuse, including in teaching and in your own papers,
          as long as you give attribution.
        </td>
      </tr>
    </tbody>
  </table>

  <p class="small-note">
    If you reuse a figure or an animation from this handbook, the handbook
    citation above is the attribution CC BY 4.0 asks for.
  </p>

  <SectionHead text="Versions" />

  <table class="licence-table">
    <tbody>
      <tr><td>Handbook</td><td><code>{VERSION}</code></td></tr>
      <tr><td>AnCiR</td><td><code>{ancirDisplay}</code></td></tr>
    </tbody>
  </table>

  <p class="small-note">
    Source: <a href={REPO} target="_blank" rel="noopener">{REPO}</a>, with the
    handbook under <code>handbook/</code>. The two Zenodo records are linked to
    each other, so either one leads to the other.
  </p>
</ChapterSection>

<style>
  .cite-block {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    background: var(--panel-bg, #f8f9fa);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 6px);
    padding: 0.85rem 1rem;
    margin: 0.9rem 0;
  }

  .cite-text {
    flex: 1;
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .bibtex {
    flex: 1;
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    white-space: pre;
    overflow-x: auto;
  }

  .copy-btn {
    flex: none;
    font-size: 0.8rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 4px);
    background: var(--bg, #fff);
    color: var(--muted);
    cursor: pointer;
  }

  .copy-btn:hover {
    color: var(--blue);
    border-color: var(--blue);
  }

  .doi-line {
    font-size: 0.92rem;
  }

  .licence-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.9rem 0;
    font-size: 0.92rem;
  }

  .licence-table th,
  .licence-table td {
    border: 1px solid var(--border);
    padding: 0.5rem 0.7rem;
    text-align: left;
    vertical-align: top;
  }

  .licence-table th {
    background: var(--panel-bg, #f8f9fa);
    font-weight: 600;
  }

  /* Keep the licence name on one line; "Apache-2.0" otherwise breaks at the
     hyphen in the narrow middle column. */
  .licence-table td:nth-child(2) {
    white-space: nowrap;
  }

  .small-note {
    font-size: 0.87rem;
    color: var(--muted);
  }
</style>
