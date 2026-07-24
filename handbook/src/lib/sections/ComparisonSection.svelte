<script>
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import MethodTable from '$lib/components/MethodTable.svelte';
</script>

<ChapterSection id="comparison" num="Appendix C" title="Tool Comparison">
  <MethodTable
    headers={["Feature", "AnCiR", "ActogramJ", "RhythmicAlly", "BioDare2"]}
    rows={[
      ["Browser-based (no install)", "✅", "❌", "✅", "✅"],
      ["No programming required", "✅", "✅", "✅", "✅"],
      ["CSV/Excel import", "✅", "Partial", "✅", "✅"],
      ["Actograms", "✅", "✅", "✅", "❌"],
      ["Chi-squared periodogram", "✅", "✅", "✅", "✅"],
      ["Lomb-Scargle periodogram", "✅", "❌", "✅", "✅"],
      ["Cosinor analysis", "✅", "❌", "✅", "✅"],
      ["Correlogram / NPCRA", "✅", "❌", "✅", "❌"],
      ["Preprocessing pipeline", "✅", "Partial", "✅", "Partial"],
      ["Mixed-effects models / GAMs", "❌", "❌", "❌", "❌"],
      ["Circular statistics", "✅", "❌", "Partial", "❌"],
      ["Open source", "✅", "✅", "✅", "❌"]
    ]}
  />
</ChapterSection>
