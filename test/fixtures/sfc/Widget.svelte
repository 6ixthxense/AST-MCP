<script lang="ts">
  import { onMount } from "svelte";
  import { formatLabel } from "./helpers";

  export let title: string;
  let visible = false;

  function toggle(): void {
    visible = !visible;
  }

  onMount(() => { visible = true; });
</script>

<h1>{title}</h1>
{#if visible}
  <p>{formatLabel(1)}</p>
{/if}

<style>h1 { font-weight: bold; }</style>
