<script>
  import { onMount } from "svelte";

  const STEPS = [
    {
      active: [],
      text: "Overview: the mammalian TTFL operates across the cytoplasm and nucleus over ~24 hours. Click <em>Next</em> to step through each component.",
    },
    {
      active: ["mol-cb"],
      text: "<strong>Step 1 &mdash; CLOCK : BMAL1 heterodimer.</strong> In the nucleus, the CLOCK and BMAL1 proteins pair up (heterodimerize) via their PAS domains. This dimer is the positive arm of the clock.",
    },
    {
      active: ["mol-cb", "mol-ebox"],
      text: "<strong>Step 2 &mdash; E-box binding &amp; transcription.</strong> The CLOCK:BMAL1 dimer binds E-box enhancer elements (CACGTG) in the promoters of the <em>Per1/2/3</em> and <em>Cry1/2</em> genes, driving their transcription. <em>Per</em> and <em>Cry</em> mRNA accumulates in the cytoplasm.",
    },
    {
      active: ["mol-cb", "mol-ebox", "mol-percry"],
      text: "<strong>Step 3 &mdash; PER &amp; CRY protein synthesis.</strong> The mRNA is translated in the cytoplasm to produce PER and CRY proteins. Protein accumulation is delayed by several hours relative to mRNA &mdash; this delay is critical for the ~24 h period.",
    },
    {
      active: ["mol-cb", "mol-ebox", "mol-percry", "mol-tim"],
      text: "<strong>Step 4 &mdash; CK1&delta;/&epsilon; times PER (light input).</strong> Casein kinase 1&delta;/&epsilon; phosphorylates PER, controlling its stability and the timing of its nuclear entry &mdash; a key part of the ~24 h delay. In mammals, light resets the clock not by acting here but via the retina, which acutely <em>induces Per transcription</em> in the SCN.",
    },
    {
      active: ["mol-cb", "mol-ebox", "mol-percry", "mol-tim", "mol-complex"],
      text: "<strong>Step 5 &mdash; PER : CRY repressive complex.</strong> PER and CRY proteins associate in the cytoplasm, then translocate together into the nucleus as a repressive complex.",
    },
    {
      active: [
        "mol-cb",
        "mol-ebox",
        "mol-percry",
        "mol-tim",
        "mol-complex",
        "mol-inhibit",
      ],
      text: "<strong>Step 6 &mdash; Negative feedback (inhibition).</strong> Inside the nucleus, the PER:CRY complex directly inhibits CLOCK:BMAL1 transcriptional activity, switching off its own production. As PER and CRY are gradually degraded (~CK1&epsilon;/&delta; phosphorylation), the inhibition lifts and the cycle begins again.",
    },
    {
      active: [
        "mol-cb",
        "mol-ebox",
        "mol-percry",
        "mol-tim",
        "mol-complex",
        "mol-inhibit",
        "mol-ror",
      ],
      text: "<strong>Step 7 &mdash; Secondary stabilising loop (ROR&alpha; / REV-ERB&alpha;).</strong> CLOCK:BMAL1 also drives expression of <em>Ror</em> and <em>Rev-erb</em> genes. ROR&alpha; activates <em>Bmal1</em> transcription; REV-ERB&alpha; represses it. This interlocking loop sharpens the oscillation and confers robustness.",
    },
  ];

  const TOTAL_STEPS = STEPS.length;
  const GROUPS = [
    "mol-cb",
    "mol-ebox",
    "mol-percry",
    "mol-tim",
    "mol-complex",
    "mol-inhibit",
    "mol-ror",
  ];

  let step = 0,
    autoPlaying = false,
    autoTimer = null;
  let stepText, stepInd, btnAuto;

  function applyStep(s) {
    step = Math.max(0, Math.min(s, TOTAL_STEPS - 1));
    const current = STEPS[step];
    GROUPS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.opacity = current.active.includes(id) ? "1" : "0.08";
    });
    stepText.innerHTML = current.text;
    stepInd.textContent = `Step ${step + 1} / ${TOTAL_STEPS}`;
  }

  function molNext() {
    applyStep(step + 1);
  }
  function molPrev() {
    applyStep(step - 1);
  }

  function molReset() {
    molAutoToggle(false);
    applyStep(0);
  }

  function molAutoToggle(forceOff) {
    if (forceOff === false || autoPlaying) {
      autoPlaying = false;
      clearInterval(autoTimer);
      btnAuto.textContent = "▶ Auto-advance";
    } else {
      autoPlaying = true;
      btnAuto.textContent = "⏸ Pause";
      autoTimer = setInterval(() => {
        if (step >= TOTAL_STEPS - 1) {
          clearInterval(autoTimer);
          autoPlaying = false;
          btnAuto.textContent = "▶ Auto-advance";
          return;
        }
        molNext();
      }, 2800);
    }
  }

  onMount(() => {
    applyStep(0);
    return () => {
      clearInterval(autoTimer);
    };
  });
</script>

<div class="anim-embed">
  <div id="mol-wrap">
    <svg id="mol-svg" viewBox="0 0 720 460" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker
          id="ar-green"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#137333" /></marker
        >
        <marker
          id="ar-gold"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#e6a817" /></marker
        >
        <marker
          id="ar-navy"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#003b71" /></marker
        >
        <marker
          id="ar-blue"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#4a90d9" /></marker
        >
        <marker
          id="ar-red"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#c5221f" /></marker
        >
        <marker
          id="ar-purple"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#7c3aed" /></marker
        >
        <marker
          id="ar-gray"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#6b7280" /></marker
        >
        <marker
          id="ar-inhibit"
          markerWidth="6"
          markerHeight="8"
          refX="4"
          refY="4"
          orient="auto"
          ><rect x="3" y="0" width="2" height="8" fill="#c5221f" /></marker
        >
      </defs>

      <!-- compartment backgrounds -->
      <rect
        x="0"
        y="280"
        width="720"
        height="180"
        rx="0"
        fill="#eaf2fb"
        opacity="0.7"
      />
      <ellipse
        cx="360"
        cy="370"
        rx="200"
        ry="60"
        fill="none"
        stroke="#4a90d9"
        stroke-width="1.2"
        stroke-dasharray="6,4"
        opacity="0.5"
      />
      <line
        x1="0"
        y1="280"
        x2="720"
        y2="280"
        stroke="#4a90d9"
        stroke-width="2"
        stroke-dasharray="10,5"
      />
      <text
        x="12"
        y="275"
        font-size="11"
        font-weight="bold"
        font-family="Inter,sans-serif"
        fill="#6b7280"
        letter-spacing="0.04em">CYTOPLASM</text
      >
      <text
        x="12"
        y="305"
        font-size="11"
        font-weight="bold"
        font-family="Inter,sans-serif"
        fill="#6b7280"
        letter-spacing="0.04em">NUCLEUS</text
      >

      <!-- STEP 1: CLOCK:BMAL1 -->
      <g id="mol-cb" class="mol-group" opacity="0.1">
        <rect x="260" y="318" width="70" height="32" rx="5" fill="#003b71" />
        <text
          x="295"
          y="339"
          text-anchor="middle"
          fill="white"
          font-size="12"
          font-weight="bold"
          font-family="Inter,sans-serif">CLOCK</text
        >
        <rect x="340" y="318" width="70" height="32" rx="5" fill="#4a90d9" />
        <text
          x="375"
          y="339"
          text-anchor="middle"
          fill="white"
          font-size="12"
          font-weight="bold"
          font-family="Inter,sans-serif">BMAL1</text
        >
        <line
          x1="295"
          y1="316"
          x2="375"
          y2="316"
          stroke="#c8962e"
          stroke-width="2"
        />
        <text
          x="335"
          y="311"
          text-anchor="middle"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#c8962e">heterodimerize</text
        >
      </g>

      <!-- STEP 2: E-BOX + TRANSCRIPTION -->
      <g id="mol-ebox" class="mol-group" opacity="0.1">
        <rect x="310" y="360" width="52" height="24" rx="4" fill="#c8962e" />
        <text
          x="336"
          y="376"
          text-anchor="middle"
          fill="white"
          font-size="10"
          font-weight="bold"
          font-family="Inter,sans-serif">E-BOX</text
        >
        <line
          x1="335"
          y1="350"
          x2="336"
          y2="361"
          stroke="#c8962e"
          stroke-width="1.8"
          marker-end="url(#ar-gold)"
        />
        <line
          x1="336"
          y1="358"
          x2="336"
          y2="256"
          stroke="#16a34a"
          stroke-width="1.8"
          stroke-dasharray="5,3"
          marker-end="url(#ar-green)"
        />
        <rect
          x="290"
          y="226"
          width="96"
          height="28"
          rx="4"
          fill="#dcfce7"
          stroke="#16a34a"
          stroke-width="1.2"
        />
        <text
          x="338"
          y="244"
          text-anchor="middle"
          fill="#15803d"
          font-size="10"
          font-weight="bold"
          font-family="Inter,sans-serif">Per / Cry mRNA</text
        >
      </g>

      <!-- STEP 3: PER + CRY proteins -->
      <g id="mol-percry" class="mol-group" opacity="0.1">
        <rect x="220" y="148" width="60" height="28" rx="5" fill="#16a34a" />
        <text
          x="250"
          y="166"
          text-anchor="middle"
          fill="white"
          font-size="12"
          font-weight="bold"
          font-family="Inter,sans-serif">PER</text
        >
        <line
          x1="300"
          y1="240"
          x2="270"
          y2="177"
          stroke="#16a34a"
          stroke-width="1.5"
          marker-end="url(#ar-green)"
        />
        <rect x="380" y="148" width="60" height="28" rx="5" fill="#c8962e" />
        <text
          x="410"
          y="166"
          text-anchor="middle"
          fill="white"
          font-size="12"
          font-weight="bold"
          font-family="Inter,sans-serif">CRY</text
        >
        <line
          x1="375"
          y1="240"
          x2="400"
          y2="177"
          stroke="#16a34a"
          stroke-width="1.5"
          marker-end="url(#ar-green)"
        />
        <text
          x="268"
          y="197"
          text-anchor="middle"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#6b7280">translation</text
        >
        <text
          x="402"
          y="197"
          text-anchor="middle"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#6b7280">translation</text
        >
      </g>

      <!-- STEP 4: TIM + light signal -->
      <g id="mol-tim" class="mol-group" opacity="0.1">
        <rect x="470" y="104" width="60" height="28" rx="5" fill="#7c3aed" />
        <text
          x="500"
          y="122"
          text-anchor="middle"
          fill="white"
          font-size="12"
          font-weight="bold"
          font-family="Inter,sans-serif">CK1</text
        >
        <line
          x1="470"
          y1="118"
          x2="282"
          y2="158"
          stroke="#7c3aed"
          stroke-width="1.4"
          stroke-dasharray="4,3"
          marker-end="url(#ar-purple)"
        />
        <text
          x="390"
          y="127"
          text-anchor="middle"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#7c3aed">phosphorylates</text
        >
        <circle
          cx="536"
          cy="80"
          r="12"
          fill="#fef3c7"
          stroke="#c8962e"
          stroke-width="1.5"
        />
        <text
          x="536"
          y="85"
          text-anchor="middle"
          font-size="13"
          font-family="sans-serif">&#9728;</text
        >
        <line
          x1="536"
          y1="92"
          x2="516"
          y2="108"
          stroke="#dc2626"
          stroke-width="1.5"
          marker-end="url(#ar-red)"
        />
        <text
          x="552"
          y="102"
          font-size="9"
          font-family="Inter,sans-serif"
          fill="#dc2626">light &#8594;</text
        >
        <text
          x="552"
          y="114"
          font-size="9"
          font-family="Inter,sans-serif"
          fill="#dc2626">degrades</text
        >
      </g>

      <!-- STEP 5: PER:CRY complex + nuclear translocation -->
      <g id="mol-complex" class="mol-group" opacity="0.1">
        <rect x="286" y="185" width="88" height="30" rx="5" fill="#1a202c" />
        <text
          x="330"
          y="205"
          text-anchor="middle"
          fill="white"
          font-size="11"
          font-weight="bold"
          font-family="Inter,sans-serif">PER : CRY</text
        >
        <line
          x1="255"
          y1="174"
          x2="300"
          y2="187"
          stroke="#1a202c"
          stroke-width="1.5"
          marker-end="url(#ar-navy)"
        />
        <line
          x1="405"
          y1="174"
          x2="363"
          y2="187"
          stroke="#1a202c"
          stroke-width="1.5"
          marker-end="url(#ar-navy)"
        />
        <line
          x1="330"
          y1="215"
          x2="332"
          y2="270"
          stroke="#1a202c"
          stroke-width="2"
          stroke-dasharray="5,3"
          marker-end="url(#ar-navy)"
        />
        <text
          x="348"
          y="248"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#1a202c">translocate</text
        >
      </g>

      <!-- STEP 6: INHIBITION feedback arc -->
      <g id="mol-inhibit" class="mol-group" opacity="0.1">
        <path
          d="M 332 280 C 332 295 440 295 440 334"
          stroke="#dc2626"
          stroke-width="2"
          stroke-dasharray="6,3"
          fill="none"
          marker-end="url(#ar-inhibit)"
        />
        <text
          x="405"
          y="292"
          font-size="10"
          font-family="Inter,sans-serif"
          fill="#dc2626"
          font-weight="bold">&#8869; INHIBIT</text
        >
        <text
          x="400"
          y="350"
          text-anchor="middle"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#dc2626">represses transcription</text
        >
      </g>

      <!-- STEP 7: ROR&#945; / REV-ERB&#945; secondary loop -->
      <g id="mol-ror" class="mol-group" opacity="0.1">
        <rect x="60" y="315" width="70" height="28" rx="5" fill="#0073cf" />
        <text
          x="95"
          y="333"
          text-anchor="middle"
          fill="white"
          font-size="12"
          font-weight="bold"
          font-family="Inter,sans-serif">ROR&#945;</text
        >
        <rect x="60" y="355" width="80" height="28" rx="5" fill="#7c3aed" />
        <text
          x="100"
          y="373"
          text-anchor="middle"
          fill="white"
          font-size="10.5"
          font-weight="bold"
          font-family="Inter,sans-serif">REV-ERB&#945;</text
        >
        <line
          x1="130"
          y1="329"
          x2="258"
          y2="335"
          stroke="#0073cf"
          stroke-width="1.5"
          marker-end="url(#ar-blue)"
        />
        <text
          x="195"
          y="327"
          text-anchor="middle"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#0073cf">activates</text
        >
        <line
          x1="140"
          y1="369"
          x2="258"
          y2="355"
          stroke="#7c3aed"
          stroke-width="1.5"
          marker-end="url(#ar-inhibit)"
        />
        <text
          x="200"
          y="375"
          text-anchor="middle"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#7c3aed">represses</text
        >
        <text
          x="95"
          y="305"
          text-anchor="middle"
          font-size="11"
          font-family="Inter,sans-serif"
          fill="#6b7280">secondary loop</text
        >
      </g>
    </svg>
  </div>

  <div class="mol-step-text" bind:this={stepText}></div>

  <div class="mol-nav">
    <button class="mol-step-btn" onclick={molPrev}>&larr; Prev</button>
    <div class="step-indicator" bind:this={stepInd}>Step 1 / 8</div>
    <button class="mol-step-btn" onclick={molNext}>Next &rarr;</button>
  </div>

  <div
    class="controls"
    style="justify-content: center; gap: 0.75rem; margin-top: 0.5rem"
  >
    <button class="btn" bind:this={btnAuto} onclick={() => molAutoToggle()}
      >&#9654; Auto-advance</button
    >
    <button class="btn secondary" onclick={molReset}>&#8634; Reset</button>
  </div>
</div>

<style>
  #mol-wrap {
    position: relative;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
  }
  #mol-svg {
    width: 100%;
    height: auto;
    display: block;
  }
  :global(.mol-group) {
    transition: opacity 0.6s ease;
  }
</style>
