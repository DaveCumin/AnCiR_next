<script>
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import ParamTable from '$lib/components/ParamTable.svelte';
</script>

<ChapterSection id="software" num="Appendix B" title="Software Landscape">
  <p>A range of tools are available for chronobiological analysis:</p>
  
  <ParamTable
    headers={["Tool", "Platform", "Notes"]}
    rows={[
      ["AnCiR", "Web browser (no install)", "Free, open-source (Apache-2.0). Actograms, periodograms (χ²/Lomb-Scargle/Enright), cosinor, correlogram, FFT, non-parametric rest-activity metrics, circular statistics (Rayleigh, Watson-Williams), and preprocessing. Does not yet cover PRC construction or mixed-effects/GAM modelling."],
      ["ActogramJ", "ImageJ plug-in", "Free, open-source. Requires Java/ImageJ. Strong actogram tools."],
      ["RhythmicAlly", "R/Shiny (web)", "Free, open-source. Requires R knowledge."],
      ["BioDare2", "Web browser", "Free for academic use. Strong period analysis tools."],
      ["zeitgebr / circatools", "R packages", "Free. Requires R knowledge. PRCs, circular statistics."],
      ["ClockLab", "Desktop (Windows)", "Commercial. Comprehensive actogram and analysis suite."],
      ["cosinor2 / CircadiPy", "R / Python", "Free. Cosinor, population-mean cosinor, group comparisons."]
    ]}
  />
</ChapterSection>
