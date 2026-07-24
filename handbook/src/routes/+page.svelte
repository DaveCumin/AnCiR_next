<script>
  import { VERSION } from "$lib/version.js";
  import HomeSection from "../lib/sections/HomeSection.svelte";
  import QuickStart from "../lib/sections/QuickStart.svelte";
  import ChooseMethodSection from "../lib/sections/ChooseMethodSection.svelte";
  import RecipesSection from "../lib/sections/RecipesSection.svelte";
  import Ch01 from "../lib/sections/Ch01.svelte";
  import Ch02 from "../lib/sections/Ch02.svelte";
  import Ch03 from "../lib/sections/Ch03.svelte";
  import Ch04 from "../lib/sections/Ch04.svelte";
  import Ch05 from "../lib/sections/Ch05.svelte";
  import Ch06 from "../lib/sections/Ch06.svelte";
  import Ch07 from "../lib/sections/Ch07.svelte";
  import Ch08 from "../lib/sections/Ch08.svelte";
  import Ch09 from "../lib/sections/Ch09.svelte";
  import Ch10 from "../lib/sections/Ch10.svelte";
  import Ch11 from "../lib/sections/Ch11.svelte";
  import Ch12 from "../lib/sections/Ch12.svelte";
  import Ch13 from "../lib/sections/Ch13.svelte";
  import GlossarySection from "../lib/sections/GlossarySection.svelte";
  import SoftwareSection from "../lib/sections/SoftwareSection.svelte";
  import ComparisonSection from "../lib/sections/ComparisonSection.svelte";
  import NodeReferenceSection from "../lib/sections/NodeReferenceSection.svelte";
  import ExampleGallerySection from "../lib/sections/ExampleGallerySection.svelte";
  import ReferencesSection from "../lib/sections/ReferencesSection.svelte";
</script>

<svelte:head>
  <title>Chronobiological Data Analysis — Handbook {VERSION}</title>
</svelte:head>

<HomeSection />
<hr class="section-divider" />
<QuickStart />
<hr class="section-divider" />
<ChooseMethodSection />
<hr class="section-divider" />
<RecipesSection />
<hr class="section-divider" />
<Ch01 />
<hr class="section-divider" />
<Ch02 />
<hr class="section-divider" />
<Ch03 />
<hr class="section-divider" />
<Ch04 />
<hr class="section-divider" />
<Ch05 />
<hr class="section-divider" />
<Ch06 />
<hr class="section-divider" />
<Ch07 />
<hr class="section-divider" />
<Ch08 />
<hr class="section-divider" />
<Ch09 />
<hr class="section-divider" />
<Ch10 />
<hr class="section-divider" />
<Ch11 />
<hr class="section-divider" />
<Ch12 />
<hr class="section-divider" />
<Ch13 />
<hr class="section-divider" />
<GlossarySection />
<hr class="section-divider" />
<SoftwareSection />
<hr class="section-divider" />
<ComparisonSection />
<hr class="section-divider" />
<NodeReferenceSection />
<hr class="section-divider" />
<ExampleGallerySection />
<hr class="section-divider" />
<ReferencesSection />

<style>
  :global(.section-divider) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2rem 0;
  }
</style>
