<script>
  import { onMount } from "svelte";
  import "../app.css";
  import logo from "$lib/logo.svg";

  let { children } = $props();

  let activeSection = $state("home");
  let sidebarOpen = $state(false);
  let showBackToTop = $state(false);

  const navItems = [
    { label: "Overview & How to Use", id: "home", group: "Getting Started" },
    { label: "AnCiR Quick Start", id: "ancir-start" },
    { label: "Choosing a Method", id: "choosing" },
    { label: "Recipes (common tasks)", id: "recipes" },
    { label: "Statistical Foundations", id: "stats" },
    { label: "1. Introduction", id: "ch1", group: "Chapters" },
    { label: "2. Data Collection", id: "ch2" },
    { label: "3. Simulating Data", id: "ch3" },
    { label: "4. Preprocessing", id: "ch4" },
    { label: "5. Actograms", id: "ch5" },
    { label: "6. Periodograms", id: "ch6" },
    { label: "7. Cosinor Analysis", id: "ch7" },
    { label: "8. Fourier Analysis", id: "ch8" },
    { label: "9. Correlograms", id: "ch9" },
    { label: "10. Phase Response Curves", id: "ch10" },
    { label: "11. Linear & Additive Models", id: "ch11" },
    { label: "12. Circular Statistics", id: "ch12" },
    { label: "13. Best Practices", id: "ch13" },
    { label: "Glossary", id: "glossary", group: "Reference" },
    { label: "Software Landscape", id: "software" },
    { label: "Tool Comparison", id: "comparison" },
    { label: "Node Reference (searchable)", id: "node-reference" },
    { label: "Example Gallery", id: "example-gallery" },
    { label: "References", id: "references" },
  ];

  onMount(() => {
    const sections = document.querySelectorAll("section[id]");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) activeSection = e.target.id;
        }
      },
      { rootMargin: "-60px 0px -55% 0px", threshold: 0 },
    );

    sections.forEach((s) => observer.observe(s));

    const onScroll = () => {
      showBackToTop = window.scrollY > 400;
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  });

  function closeSidebar() {
    sidebarOpen = false;
  }
  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
</script>

<svelte:window
  onclick={(e) => {
    if (sidebarOpen && !e.target.closest("#sidebar, #menu-toggle"))
      closeSidebar();
  }}
/>

<header id="top-header">
  <img src={logo} alt="Chronobiology Handbook Logo" class="site-logo" />
  <div class="site-title">
    Chronobiology Handbook
    <span>Student Guide to Data Analysis</span>
  </div>
  <button id="menu-toggle" aria-label="Toggle menu" onclick={toggleSidebar}>
    <svg
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  </button>
</header>

<div
  id="overlay"
  class={sidebarOpen ? "active" : ""}
  role="presentation"
  onclick={closeSidebar}
></div>

<div id="layout">
  <nav
    id="sidebar"
    class={sidebarOpen ? "open" : ""}
    aria-label="Handbook navigation"
  >
    <div class="sidebar-inner">
      {#each navItems as item, idx}
        {#if item.group}
          <span
            class="sidebar-label"
            style={idx > 0 ? "margin-top:14px;display:block" : ""}
            >{item.group}</span
          >
        {/if}
        <a
          class="sidebar-link{activeSection === item.id ? ' active' : ''}"
          href="#{item.id}"
          onclick={closeSidebar}>{item.label}</a
        >
      {/each}
    </div>
  </nav>

  <main id="content">
    {@render children()}
  </main>
</div>

<button
  id="back-top"
  class={showBackToTop ? "visible" : ""}
  title="Back to top"
  aria-label="Back to top"
  onclick={scrollToTop}>↑</button
>

<style>
  :global(section[id]) {
    scroll-margin-top: calc(var(--header-h) + 8px);
  }
  :global(.section-divider) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2rem 0;
  }
</style>
