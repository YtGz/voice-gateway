<script lang="ts">
	import type { Clip } from '$lib/stores/clips';
	import { createAudioUrl } from '$lib/utils/audio';
	
	interface Props {
		clip: Clip;
		index: number;
		sampleRate: number;
		onDelete: (id: string) => void;
	}
	
	let { clip, index, sampleRate, onDelete }: Props = $props();
	
	let audioUrl = $derived(createAudioUrl(clip.audio, sampleRate));
	let isPlaying = $state(false);
	let audioElement: HTMLAudioElement | null = $state(null);
	
	function togglePlay() {
		if (!audioElement) return;
		
		if (isPlaying) {
			audioElement.pause();
			audioElement.currentTime = 0;
		} else {
			audioElement.play();
		}
	}
	
	function handleEnded() {
		isPlaying = false;
	}
	
	function handlePlay() {
		isPlaying = true;
	}
	
	function handlePause() {
		isPlaying = false;
	}
</script>

<div class="flex items-center gap-3 bg-gray-800 rounded-lg p-3 hover:bg-gray-750 transition-colors">
	<span class="text-gray-400 font-mono text-sm w-8">#{index + 1}</span>
	
	<span class="text-gray-300 text-sm w-14">{clip.duration.toFixed(2)}s</span>
	
	<button
		onclick={togglePlay}
		class="w-10 h-10 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 transition-colors"
	>
		{#if isPlaying}
			<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
				<rect x="6" y="4" width="4" height="16"></rect>
				<rect x="14" y="4" width="4" height="16"></rect>
			</svg>
		{:else}
			<svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
				<polygon points="5,3 19,12 5,21"></polygon>
			</svg>
		{/if}
	</button>
	
	<div class="flex-1 h-8 bg-gray-700 rounded overflow-hidden">
		<div class="h-full bg-gradient-to-r from-blue-600 to-blue-400 opacity-60" 
			style="width: {Math.min(100, clip.duration / 2 * 100)}%"></div>
	</div>
	
	<button
		onclick={() => onDelete(clip.id)}
		class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-red-600/20 text-gray-400 hover:text-red-400 transition-colors"
	>
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
		</svg>
	</button>
	
	<audio 
		bind:this={audioElement}
		src={audioUrl}
		onended={handleEnded}
		onplay={handlePlay}
		onpause={handlePause}
	></audio>
</div>
