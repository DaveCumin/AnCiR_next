<script>
    import Icon from '$lib/icon/Icon.svelte';
</script>

<div class="search">
    <Icon name="search" />
    <p>Search</p>
</div>

<style>
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
</style>

