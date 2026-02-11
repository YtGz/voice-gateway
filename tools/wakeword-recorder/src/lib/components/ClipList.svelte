<script lang="ts">
	import type { Clip } from '$lib/stores/clips';
	import ClipItem from './ClipItem.svelte';
	
	interface Props {
		clips: Clip[];
		sampleRate: number;
		onDelete: (id: string) => void;
	}
	
	let { clips, sampleRate, onDelete }: Props = $props();
</script>

<div class="space-y-2 max-h-96 overflow-y-auto pr-2">
	{#each clips.toReversed() as clip, i (clip.id)}
		<ClipItem 
			{clip} 
			index={clips.length - 1 - i}
			{sampleRate}
			{onDelete}
		/>
	{/each}
	
	{#if clips.length === 0}
		<div class="text-center py-8 text-gray-500">
			<p>No clips recorded yet</p>
			<p class="text-sm mt-1">Start recording and speak your wake word</p>
		</div>
	{/if}
</div>
