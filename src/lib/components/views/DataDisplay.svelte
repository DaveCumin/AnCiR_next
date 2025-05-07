<script>
    // import CollapsibleSection from '$lib/ui/CollapsibleSection.svelte';
    import Icon from '$lib/icon/Icon.svelte';
    import { DateTime } from 'luxon';

    // import { generateData } from '$lib/data/simulate';
    import { data } from '$lib/store';
    import { DataItem } from '$lib/models/dataItem.svelte';

    
    function simulateData() {
        const newDataEntry = new DataItem(
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

        <div class="add">
            <!-- <button> -->
            <button on:click={simulateData}>
                <Icon name="add" width={16} height={16}/>
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
                    <ul>
                        {#each entry.data.value.data.slice(0,5) as ts}
                        <li>{ts}</li>
                        {/each}
                    </ul>
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
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
    
        border-bottom: 1px solid #D9D9D9;
    }

    .heading p {
        margin-left: 0.6rem;
        font-weight: bold;
    }

    button {
        background-color: transparent;
        border: none;
        margin-right: 0.6rem;
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
        color: var(--color-icon-unselected, blue);
    }
</style>