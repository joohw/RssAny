<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => {
    goto('/feeds?channel=all', { replaceState: true });
  });
</script>
