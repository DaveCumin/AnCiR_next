<script>
    import { AddIcon, SearchIcon } from '$lib/icons'

    import { DateTime } from 'luxon';
    import { generateData } from '$lib/data/simulate';
    import { data } from '$lib/store';
    
    // import { Draggable } from '@shopify/draggable';
    // import CollapsibleSection from '$lib/ui/CollapsibleSection.svelte';

    function simulateData() {
        const newDataEntry = generateData(
        28,
        15,
        DateTime.now()
          .set({
            hour: 0,
            minute: 0,
            second: 0,
            millisecond: 0,
          })
          .toJSDate(),
        [24, 28],
        [100, 150],
        $data.length
      );

      $data = [...$data, newDataEntry];
      console.log($data);
    }
</script>


<div class="container">
    <div class="heading">
        <p>Data Sources</p>
    </div>

    <div class="functions">
        <div class="search">
            <SearchIcon />
            <p>Search</p>
        </div>

        <div class="add">
            <button on:click={simulateData}>
                <AddIcon />
            </button>
        </div>

        
    </div>

    <div class="data-list">
        {#each $data as entry (entry.id)}
            <details>
                <summary>{entry.displayName}</summary>
                    <!-- here you can render whatever fields you like; for example: -->
                    <p><strong>ID:</strong> {entry.id}</p>
                    <p><strong>Length:</strong> {entry.datalength}</p>
    
                    <details>
                    <summary>time</summary>
                    <ul>
                        {#each entry.data.time.data.slice(0,5) as ts}
                        <li>{ts}</li>
                        {/each}
                    </ul>
                    </details>
    
                    <details>
                    <summary>values</summary>
                    {#each Object.entries(entry.data) as [key, info]}
                        {#if info.type === 'value'}
                        <p><em>{info.name}</em>: [{info.data.slice(0,5).join(', ')} …]</p>
                        {/if}
                    {/each}
                    </details>
                
            </details>
            
        {/each}
    </div>

    
</div>

<style>
    .container {
        width: 16vw;
        height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: start;
        align-items: start;

        position: fixed;
        top: 0;
        left: 4vw;

        border-right: 1px solid #D9D9D9;
    }

    .heading {
        width: 16vw;
        height: 4vh;
        border-bottom: 1px solid #D9D9D9;
    }

    .heading p {
        margin-top: 0.6rem;
        margin-left: 0.6rem;
        font-weight: bold;
    }

    .functions {
        display: flex;
        flex-direction: row;
        align-items: center;
        margin: 0.5rem; 
    }

    .search {
        width: 13.5vw;
        height: 3vh;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: start;

        border-radius: 5px;
        background-color: var(--color-lightness-95, blue);
    }

    .search :global(svg) {
        margin-left: 0.5rem;
        margin-right: 0.5rem;
        color: var(--color-lightness-75)
    }

    .search p {
        font-weight: 400;
        font-size: small;
        color: var(--color-lightness-75, blue);
    }

    button {
        background-color: transparent;
        border: none;
        margin: 0;
        padding: 0;
        text-align: inherit;
        font: inherit;
        border-radius: 0;
        appearance: none;
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .add :global(svg){
        vertical-align: middle;
        margin-left: 0.45rem;
        color: var(--color-icon-unselected, blue);
    }
</style>