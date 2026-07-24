<script>
    import NoteBox from "$lib/components/NoteBox.svelte";
    import { VERSION } from "$lib/version.js";
</script>

<section id="home">
    <h1 class="handbook-title">
        A Handbook of Chronobiological Data Analysis <span
            class="handbook-version">version {VERSION}</span
        >
    </h1>
    <p class="handbook-subtitle">
        A practical guide to analysis techniques, integrated with
        <a href="https://ancir.pages.dev" target="_blank">AnCiR</a>
    </p>

    <div class="box box-history">
        <p class="chapter-intro">
            Note, this handbook is a work in progress. It is currently a draft!
            Please email <a
                href="mailto:d.cumin@auckland.ac.nz?subject=AnCiR Handbook"
                >d.cumin@auckland.ac.nz</a
            > for any errors, omissions, or feedback.
        </p>
    </div>

    <p class="chapter-intro">
        Chronobiology (the study of biological rhythms) has generated a rich
        ecosystem of analytical methods spanning simple visual inspection to
        sophisticated statistical modelling. This handbook is a practical
        companion: clear enough for beginners, detailed enough for researchers,
        and directly tied to real analysis workflows in <strong
            ><a href="https://ancir.pages.dev" target="_blank">AnCiR</a></strong
        >, a free, browser-based platform requiring no installation.
    </p>

    <NoteBox title="How to Use This Handbook">
        <ul style="font-size: 0.9rem;">
            <li>
                Chapters are largely <strong>self-contained</strong> so you should
                be able to easily jump to the method you need.
            </li>
            <li>
                Each chapter opens with <strong>Historical Context</strong>,
                then concept, mathematics, and a step-by-step
                <strong>AnCiR workflow</strong>.
            </li>
        </ul>
    </NoteBox>

    <div class="toc-grid">
        <a class="toc-card" href="#ch1">
            <div class="card-num">Chapter 1</div>
            <div class="card-title">Introduction to Chronobiology</div>
        </a>
        <a class="toc-card" href="#ch2">
            <div class="card-num">Chapter 2</div>
            <div class="card-title">Data Collection</div>
        </a>
        <a class="toc-card" href="#ch3">
            <div class="card-num">Chapter 3</div>
            <div class="card-title">Simulating Data</div>
        </a>
        <a class="toc-card" href="#ch4">
            <div class="card-num">Chapter 4</div>
            <div class="card-title">Preprocessing</div>
        </a>
        <a class="toc-card" href="#ch5">
            <div class="card-num">Chapter 5</div>
            <div class="card-title">Actograms</div>
        </a>
        <a class="toc-card" href="#ch6">
            <div class="card-num">Chapter 6</div>
            <div class="card-title">Periodograms</div>
        </a>
        <a class="toc-card" href="#ch7">
            <div class="card-num">Chapter 7</div>
            <div class="card-title">Cosinor Analysis</div>
        </a>
        <a class="toc-card" href="#ch8">
            <div class="card-num">Chapter 8</div>
            <div class="card-title">Fourier Analysis</div>
        </a>
        <a class="toc-card" href="#ch9">
            <div class="card-num">Chapter 9</div>
            <div class="card-title">Correlograms</div>
        </a>
        <a class="toc-card" href="#ch10">
            <div class="card-num">Chapter 10</div>
            <div class="card-title">Phase Response Curves</div>
        </a>
        <a class="toc-card" href="#ch11">
            <div class="card-num">Chapter 11</div>
            <div class="card-title">Linear & Additive Models</div>
        </a>
        <a class="toc-card" href="#ch12">
            <div class="card-num">Chapter 12</div>
            <div class="card-title">Circular Statistics</div>
        </a>
        <a class="toc-card" href="#ch13">
            <div class="card-num">Chapter 13</div>
            <div class="card-title">Best Practices & Reporting</div>
        </a>
    </div>
</section>

<style>
    section {
        scroll-margin-top: var(--header-h);
        padding-top: 0;
    }

    :global(.handbook-title) {
        margin-top: 0;
    }
</style>
