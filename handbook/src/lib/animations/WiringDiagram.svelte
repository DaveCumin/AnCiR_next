<script>
  // A small, self-contained illustration of "wiring": drag from a node's
  // output port to the next node's input port to connect them. Pure SVG so it
  // is crisp, theme-aware (CSS variables), and prints as a complete connection.
  // Motion is an enhancement only — with reduced-motion, or on paper, the wire
  // shows fully drawn.
  let { height = "220px" } = $props();

  // Single source of the wire geometry: used both for the drawn <path> and for
  // the travelling "data" dot's offset-path, so they can never drift apart.
  const WIRE = "M 176 96 C 250 96, 276 96, 350 96";
</script>

<figure class="wire-fig" style="--h:{height}">
  <svg viewBox="0 0 520 200" role="img" aria-label="Two nodes on the canvas: an Import file source node whose output port is wired to the input port of an Actogram plot node.">
    <!-- connecting wire -->
    <path d={WIRE} class="wire" fill="none" />
    <circle r="4.5" class="spark" style="offset-path: path('{WIRE}');" />

    <!-- Source node -->
    <g class="node">
      <rect x="26" y="56" width="150" height="80" rx="10" class="node-body" />
      <rect x="26" y="56" width="150" height="26" rx="10" class="node-head" />
      <rect x="26" y="70" width="150" height="12" class="node-head-fill" />
      <text x="38" y="73" class="node-tag">SOURCES</text>
      <text x="38" y="108" class="node-title">Import file</text>
      <text x="38" y="126" class="node-sub">your data</text>
    </g>
    <!-- output port -->
    <circle cx="176" cy="96" r="7" class="port port-out" />
    <text x="176" y="150" class="port-label">output port</text>

    <!-- Plot node -->
    <g class="node">
      <rect x="350" y="56" width="150" height="80" rx="10" class="node-body" />
      <rect x="350" y="56" width="150" height="26" rx="10" class="node-head" />
      <rect x="350" y="70" width="150" height="12" class="node-head-fill" />
      <text x="362" y="73" class="node-tag">PLOTS</text>
      <text x="362" y="108" class="node-title">Actogram</text>
      <text x="362" y="126" class="node-sub">a picture</text>
    </g>
    <!-- input port -->
    <circle cx="350" cy="96" r="7" class="port port-in" />
    <text x="350" y="150" class="port-label">input port</text>
  </svg>
  <figcaption>
    Drag from a node's <strong>output port</strong> (right) to the next node's
    <strong>input port</strong> (left) to connect them. Data flows left to right;
    change a setting upstream and everything downstream re-runs.
  </figcaption>
</figure>

<style>
  .wire-fig {
    margin: 1.1rem auto 0.4rem;
    max-width: 560px;
  }
  .wire-fig svg {
    width: 100%;
    height: var(--h);
    display: block;
  }
  .node-body {
    fill: var(--surface);
    stroke: var(--border);
    stroke-width: 1.5;
  }
  .node-head,
  .node-head-fill {
    fill: var(--panel-bg);
  }
  .node-tag {
    fill: var(--muted);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    font-family: "Inter", system-ui, sans-serif;
  }
  .node-title {
    fill: var(--text);
    font-size: 15px;
    font-weight: 600;
    font-family: "Inter", system-ui, sans-serif;
  }
  .node-sub {
    fill: var(--muted);
    font-size: 11px;
    font-family: "Inter", system-ui, sans-serif;
  }
  .port {
    fill: var(--surface);
    stroke: var(--blue);
    stroke-width: 2.5;
  }
  .port-out {
    fill: var(--blue);
  }
  .port-label {
    fill: var(--muted);
    font-size: 10px;
    font-weight: 600;
    text-anchor: middle;
    font-family: "Inter", system-ui, sans-serif;
  }
  .wire {
    stroke: var(--blue);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .spark {
    fill: var(--gold);
    opacity: 0;
  }
  figcaption {
    font-size: 0.82rem;
    color: var(--muted);
    text-align: center;
    line-height: 1.5;
    max-width: 460px;
    margin: 0 auto;
  }

  @media (prefers-reduced-motion: no-preference) {
    /* Draw the wire, then send a data pulse along it, on a gentle loop. */
    .wire {
      stroke-dasharray: 180;
      stroke-dashoffset: 180;
      animation: draw 4s ease-in-out infinite;
    }
    .spark {
      animation: flow 4s ease-in-out infinite;
    }
    @keyframes draw {
      0% { stroke-dashoffset: 180; }
      25%, 100% { stroke-dashoffset: 0; }
    }
    @keyframes flow {
      0%, 30% { offset-distance: 0%; opacity: 0; }
      35% { opacity: 1; }
      70% { offset-distance: 100%; opacity: 1; }
      75%, 100% { offset-distance: 100%; opacity: 0; }
    }
  }

  @media print {
    .wire-fig { break-inside: avoid; }
  }
</style>
