<script lang="ts">
	import '../app.css';
	import { onMount, onDestroy } from 'svelte';
	import { MicVAD } from '@ricky0123/vad-web';
	import { clips, type Clip } from '$lib/stores/clips';
	import { exportClipsAsZip, downloadBlob } from '$lib/utils/export';
	import { createWavBase64 } from '$lib/utils/audio';
	import AudioMeter from '$lib/components/AudioMeter.svelte';
	import ClipList from '$lib/components/ClipList.svelte';
	
	let isRecording = $state(false);
	let isLoading = $state(false);
	let isSpeaking = $state(false);
	let isSaving = $state(false);
	let audioLevel = $state(0);
	let error = $state<string | null>(null);
	let saveMessage = $state<string | null>(null);
	let vad: MicVAD | null = $state(null);
	let clipsList = $state<Clip[]>([]);
	let sampleRate = $state(16000);
	let wakeword = $state('Seraphina');
	
	clips.subscribe(value => {
		clipsList = value;
	});
	
	onMount(async () => {
		isLoading = false;
	});
	
	onDestroy(() => {
		if (vad) {
			vad.destroy();
		}
	});
	
	async function startRecording() {
		if (isRecording) return;
		
		isLoading = true;
		error = null;
		saveMessage = null;
		
		try {
			vad = await MicVAD.new({
				onSpeechStart: () => {
					isSpeaking = true;
				},
				onSpeechEnd: (audio: Float32Array) => {
					isSpeaking = false;
					clips.add(audio, sampleRate);
				},
				onVADMisfire: () => {
					isSpeaking = false;
				},
				onFrameProcessed: (probs: { isSpeech: number }) => {
					audioLevel = probs.isSpeech;
				},
				positiveSpeechThreshold: 0.5,
				negativeSpeechThreshold: 0.35,
				redemptionFrames: 8,
				preSpeechPadFrames: 5,
				minSpeechFrames: 3,
			});
			
			vad.start();
			isRecording = true;
		} catch (e) {
			console.error('Failed to start VAD:', e);
			error = e instanceof Error ? e.message : 'Failed to start recording';
		} finally {
			isLoading = false;
		}
	}
	
	function stopRecording() {
		if (vad) {
			vad.pause();
			vad.destroy();
			vad = null;
		}
		isRecording = false;
		isSpeaking = false;
		audioLevel = 0;
	}
	
	function deleteClip(id: string) {
		clips.remove(id);
	}
	
	function clearAllClips() {
		if (confirm('Delete all recorded clips?')) {
			clips.clear();
		}
	}
	
	async function exportAll() {
		if (clipsList.length === 0) return;
		
		const zip = await exportClipsAsZip(clipsList, sampleRate);
		const timestamp = new Date().toISOString().slice(0, 10);
		downloadBlob(zip, `wakeword-samples-${timestamp}.zip`);
	}
	
	async function saveToTraining() {
		if (clipsList.length === 0 || !wakeword.trim()) return;
		
		isSaving = true;
		error = null;
		saveMessage = null;
		
		try {
			const clipsData = clipsList.map(clip => ({
				wavData: createWavBase64(clip.audio, sampleRate)
			}));
			
			const response = await fetch('/api/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					clips: clipsData,
					wakeword: wakeword.trim(),
					testRatio: 0.2
				})
			});
			
			const result = await response.json();
			
			if (!response.ok) {
				throw new Error(result.error || 'Failed to save');
			}
			
			saveMessage = `Saved ${result.trainCount} train + ${result.testCount} test clips`;
			clips.clear();
		} catch (e) {
			console.error('Failed to save:', e);
			error = e instanceof Error ? e.message : 'Failed to save clips';
		} finally {
			isSaving = false;
		}
	}
</script>

<div class="min-h-screen bg-gray-900 text-white">
	<div class="max-w-2xl mx-auto px-4 py-8">
		<!-- Header -->
		<header class="text-center mb-8">
			<h1 class="text-3xl font-bold mb-2">🎙️ Wakeword Recorder</h1>
			<p class="text-gray-400">Record wake word samples with automatic voice detection</p>
			<a href="/test" class="text-blue-400 hover:text-blue-300 text-sm">→ Test trained model</a>
		</header>
		
		<!-- Wakeword Input -->
		<div class="bg-gray-800 rounded-2xl p-6 mb-6">
			<label class="block text-sm text-gray-400 mb-2">Target Wake Word</label>
			<input
				type="text"
				bind:value={wakeword}
				placeholder="e.g., Seraphina"
				class="w-full px-4 py-3 bg-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
			/>
		</div>
		
		<!-- Main Recording Area -->
		<div class="bg-gray-800 rounded-2xl p-6 mb-6">
			<!-- Status -->
			<div class="text-center mb-6">
				{#if isLoading}
					<div class="flex items-center justify-center gap-2 text-blue-400">
						<svg class="animate-spin w-5 h-5" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<span>Loading VAD model...</span>
					</div>
				{:else if error}
					<div class="text-red-400">
						<p>⚠️ {error}</p>
						<p class="text-sm mt-1">Please ensure microphone access is allowed</p>
					</div>
				{:else if saveMessage}
					<div class="text-green-400">
						<p>✓ {saveMessage}</p>
					</div>
				{:else if isRecording}
					<div class="space-y-2">
						{#if isSpeaking}
							<div class="flex items-center justify-center gap-2 text-green-400">
								<span class="relative flex h-3 w-3">
									<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
									<span class="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
								</span>
								<span class="font-medium">Speech detected!</span>
							</div>
						{:else}
							<div class="text-gray-400">
								<span>🎤 Listening... say "<span class="text-white font-medium">{wakeword}</span>"</span>
							</div>
						{/if}
					</div>
				{:else}
					<p class="text-gray-400">Click Start to begin recording</p>
				{/if}
			</div>
			
			<!-- Audio Level Meter -->
			<div class="mb-6">
				<AudioMeter level={audioLevel} isActive={isSpeaking} />
			</div>
			
			<!-- Controls -->
			<div class="flex justify-center gap-4">
				{#if !isRecording}
					<button
						onclick={startRecording}
						disabled={isLoading}
						class="px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-full font-medium transition-colors flex items-center gap-2"
					>
						<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
							<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"></path>
							<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"></path>
						</svg>
						Start Recording
					</button>
				{:else}
					<button
						onclick={stopRecording}
						class="px-8 py-3 bg-red-600 hover:bg-red-500 rounded-full font-medium transition-colors flex items-center gap-2"
					>
						<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
							<rect x="6" y="6" width="12" height="12"></rect>
						</svg>
						Stop Recording
					</button>
				{/if}
			</div>
		</div>
		
		<!-- Clips Section -->
		<div class="bg-gray-800 rounded-2xl p-6">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-xl font-semibold">
					Recorded Clips 
					<span class="text-gray-400 font-normal text-base">({clipsList.length})</span>
				</h2>
				
				<div class="flex gap-2">
					{#if clipsList.length > 0}
						<button
							onclick={clearAllClips}
							class="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
						>
							Clear All
						</button>
					{/if}
				</div>
			</div>
			
			<ClipList 
				clips={clipsList}
				{sampleRate}
				onDelete={deleteClip}
			/>
			
			<!-- Export Actions -->
			{#if clipsList.length > 0}
				<div class="mt-6 pt-6 border-t border-gray-700">
					<div class="flex flex-col sm:flex-row gap-3">
						<button
							onclick={saveToTraining}
							disabled={isSaving || !wakeword.trim()}
							class="flex-1 px-4 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
						>
							{#if isSaving}
								<svg class="animate-spin w-5 h-5" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
								Saving...
							{:else}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
								</svg>
								Save to Training Folder
							{/if}
						</button>
						<button
							onclick={exportAll}
							class="px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center justify-center gap-2"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
							</svg>
							Export ZIP
						</button>
					</div>
					<p class="text-xs text-gray-500 mt-2 text-center">
						Save splits clips 80/20 into positive_train and positive_test folders
					</p>
				</div>
			{/if}
		</div>
		
		<!-- Tips -->
		<div class="mt-6 text-sm text-gray-500 text-center">
			<p>💡 Tips: Vary your distance, tone, and speed. Record in different rooms for best results.</p>
		</div>
	</div>
</div>
