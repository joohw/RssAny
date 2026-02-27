<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => {
    goto('/channels', { replaceState: true });
  });
</script>

<svelte:head>
  <title>重定向 - RssAny</title>
</svelte:head>

<p>正在跳转到频道管理…</p>
