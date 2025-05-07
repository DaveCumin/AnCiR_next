<script>

</script>


<div class="container">
    <div class="heading">
        <p>Worksheet Layers</p>
    </div>

    <div class="functions">
        <div class="search">
            
            <p>Search</p>
        </div>

        <div class="add">
            
        </div>
    </div>

    <div class="data-list">

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

    .add {
        vertical-align: middle;
        margin-left: 0.45rem;
        color: var(--color-icon-unselected, blue);
    }
</style>