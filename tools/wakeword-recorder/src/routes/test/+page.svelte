<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { WakewordDetector, SAMPLE_RATE, CHUNK_SAMPLES } from '$lib/utils/wakeword-detector';

	// State
	let isListening = $state(false);
	let isLoading = $state(false);
	let isTesting = $state(false);
	let testResult = $state<string | null>(null);
	let error = $state<string | null>(null);
	let currentScore = $state(0);
	let threshold = $state(0.5);
	let detections = $state<{ score: number; timestamp: Date }[]>([]);
	let availableModels = $state<{ name: string; path: string }[]>([]);
	let selectedModel = $state<string | null>(null);
	let hasBaseModels = $state(false);
	let isCheckingModels = $state(true);
	
	// Audio context and worklet
	let audioContext: AudioContext | null = null;
	let mediaStream: MediaStream | null = null;
	let workletNode: AudioWorkletNode | null = null;
	let detector: WakewordDetector | null = null;
	let resampleRatio = 1;
	
	// Audio buffer for accumulating samples (at target 16kHz rate)
	let audioBuffer: Float32Array = new Float32Array(0);
	let resampleBuffer: Float32Array = new Float32Array(0);
	
	// Score history for visualization
	let scoreHistory = $state<number[]>(new Array(100).fill(0));
	
	onMount(async () => {
		// Fetch available models
		try {
			const response = await fetch('/api/models');
			const data = await response.json();
			availableModels = data.models || [];
			hasBaseModels = data.hasBaseModels ?? false;
			if (availableModels.length > 0) {
				selectedModel = availableModels[0].name;
			}
		} catch (e) {
			console.error('Failed to fetch models:', e);
		} finally {
			isCheckingModels = false;
		}
	});
	
	onDestroy(() => {
		stopListening();
	});
	
	async function startListening() {
		if (isListening || !selectedModel) return;
		
		isLoading = true;
		error = null;
		detections = [];
		scoreHistory = new Array(100).fill(0);
		
		try {
			// Initialize detector with models
			const modelInfo = availableModels.find(m => m.name === selectedModel);
			if (!modelInfo) throw new Error('Model not found');
			
			detector = new WakewordDetector({
				melModelPath: '/api/models/melspectrogram.onnx',
				embeddingModelPath: '/api/models/embedding_model.onnx',
				wakewordModelPath: modelInfo.path,
				threshold,
				onDetection: (score) => {
					detections = [...detections.slice(-9), { score, timestamp: new Date() }];
				},
				onScoreUpdate: (score) => {
					currentScore = score;
					scoreHistory = [...scoreHistory.slice(1), score];
				},
			});
			
			await detector.initialize();
			
			// Request microphone access first
			mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: false,
					noiseSuppression: false,
					autoGainControl: false,
				},
			});
			
			// Create AudioContext matching the stream's sample rate, then resample if needed
			const track = mediaStream.getAudioTracks()[0];
			const streamSampleRate = track.getSettings().sampleRate || 48000;
			audioContext = new AudioContext({ sampleRate: streamSampleRate });
			resampleRatio = streamSampleRate / SAMPLE_RATE;
			
			// Create audio worklet for processing
			await audioContext.audioWorklet.addModule(createProcessorScript());
			
			const source = audioContext.createMediaStreamSource(mediaStream);
			workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
			
			workletNode.port.onmessage = async (event) => {
				if (!detector) return;
				
				const inputData = event.data as Float32Array;
				
				// Resample to 16kHz if needed
				let resampled: Float32Array;
				if (resampleRatio > 1) {
					const outputLength = Math.floor(inputData.length / resampleRatio);
					resampled = new Float32Array(outputLength);
					for (let i = 0; i < outputLength; i++) {
						const srcIndex = Math.floor(i * resampleRatio);
						resampled[i] = inputData[srcIndex];
					}
				} else {
					resampled = inputData;
				}
				
				// Accumulate resampled samples
				const newBuffer = new Float32Array(audioBuffer.length + resampled.length);
				newBuffer.set(audioBuffer);
				newBuffer.set(resampled, audioBuffer.length);
				audioBuffer = newBuffer;
				
				// Process complete chunks
				while (audioBuffer.length >= CHUNK_SAMPLES) {
					const chunk = audioBuffer.slice(0, CHUNK_SAMPLES);
					audioBuffer = audioBuffer.slice(CHUNK_SAMPLES);
					
					try {
						await detector.processAudioChunk(chunk);
					} catch (e) {
						console.error('Processing error:', e);
					}
				}
			};
			
			source.connect(workletNode);
			// Don't connect to destination to avoid feedback
			
			isListening = true;
		} catch (e) {
			console.error('Failed to start listening:', e);
			error = e instanceof Error ? e.message : 'Failed to start';
			stopListening();
		} finally {
			isLoading = false;
		}
	}
	
	function stopListening() {
		if (workletNode) {
			workletNode.disconnect();
			workletNode = null;
		}
		
		if (mediaStream) {
			mediaStream.getTracks().forEach(track => track.stop());
			mediaStream = null;
		}
		
		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}
		
		if (detector) {
			detector.destroy();
			detector = null;
		}
		
		audioBuffer = new Float32Array(0);
		resampleBuffer = new Float32Array(0);
		resampleRatio = 1;
		isListening = false;
	}
	
	function updateThreshold(newThreshold: number) {
		threshold = newThreshold;
		if (detector) {
			detector.setThreshold(newThreshold);
		}
	}
	
	function clearDetections() {
		detections = [];
	}
	
	async function testWithSample(type: 'positive_test' | 'negative_test') {
		if (isTesting || !selectedModel) return;
		
		isTesting = true;
		testResult = null;
		error = null;
		
		try {
			// Load a random sample
			const sampleIndex = Math.floor(Math.random() * 200);
			const response = await fetch(`/api/test-sample?wakeword=${selectedModel}&type=${type}&index=${sampleIndex}`);
			const data = await response.json();
			
			if (data.error) {
				throw new Error(data.error);
			}
			
			// Decode audio data
			const audioBytes = Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0));
			let audioData = new Float32Array(audioBytes.buffer);
			
			console.log(`Testing ${type} sample: ${data.file}, ${audioData.length} samples, ${data.sampleRate}Hz`);
			
			// Resample to 16kHz if needed
			if (data.sampleRate !== SAMPLE_RATE) {
				const ratio = data.sampleRate / SAMPLE_RATE;
				const newLength = Math.floor(audioData.length / ratio);
				const resampled = new Float32Array(newLength);
				for (let i = 0; i < newLength; i++) {
					resampled[i] = audioData[Math.floor(i * ratio)];
				}
				audioData = resampled;
				console.log(`Resampled to ${audioData.length} samples at ${SAMPLE_RATE}Hz`);
			}
			
			// Pad audio to ensure we have enough for the pipeline
			// Need at least: 76 mel frames * 8 stride * 80ms chunks + 16 embeddings
			const minSamples = SAMPLE_RATE * 5; // At least 5 seconds
			if (audioData.length < minSamples) {
				const padded = new Float32Array(minSamples);
				// Center the audio
				const offset = Math.floor((minSamples - audioData.length) / 2);
				padded.set(audioData, offset);
				audioData = padded;
				console.log(`Padded to ${audioData.length} samples`);
			}
			
			// Create detector
			const modelInfo = availableModels.find(m => m.name === selectedModel);
			if (!modelInfo) throw new Error('Model not found');
			
			const testDetector = new WakewordDetector({
				melModelPath: '/api/models/melspectrogram.onnx',
				embeddingModelPath: '/api/models/embedding_model.onnx',
				wakewordModelPath: modelInfo.path,
				threshold: 0.5,
				onScoreUpdate: (score) => {
					currentScore = score;
					scoreHistory = [...scoreHistory.slice(1), score];
				},
			});
			
			await testDetector.initialize();
			
			// Process audio in chunks
			let maxScore = 0;
			const scores: number[] = [];
			
			for (let i = 0; i + CHUNK_SAMPLES <= audioData.length; i += CHUNK_SAMPLES) {
				const chunk = audioData.slice(i, i + CHUNK_SAMPLES);
				const result = await testDetector.processAudioChunk(chunk);
				if (result) {
					scores.push(result.score);
					maxScore = Math.max(maxScore, result.score);
				}
			}
			
			testDetector.destroy();
			
			const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
			testResult = `${type}: ${data.file}\nMax score: ${maxScore.toFixed(4)}, Avg: ${avgScore.toFixed(4)}, Samples: ${scores.length}`;
			console.log(testResult);
			
		} catch (e) {
			console.error('Test failed:', e);
			error = e instanceof Error ? e.message : 'Test failed';
		} finally {
			isTesting = false;
		}
	}

	// Create audio worklet processor as a blob URL
	function createProcessorScript(): string {
		const processorCode = `
			class AudioProcessor extends AudioWorkletProcessor {
				constructor() {
					super();
					this.buffer = [];
				}
				
				process(inputs, outputs, parameters) {
					const input = inputs[0];
					if (input && input[0]) {
						// Send audio data to main thread
						this.port.postMessage(new Float32Array(input[0]));
					}
					return true;
				}
			}
			
			registerProcessor('audio-processor', AudioProcessor);
		`;
		
		const blob = new Blob([processorCode], { type: 'application/javascript' });
		return URL.createObjectURL(blob);
	}
	
	function formatTime(date: Date): string {
		return date.toLocaleTimeString('en-US', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		});
	}
	
	function getScoreColor(score: number): string {
		if (score >= threshold) return 'text-green-400';
		if (score >= threshold * 0.7) return 'text-yellow-400';
		return 'text-gray-400';
	}
	
	function getBarColor(score: number): string {
		if (score >= threshold) return 'bg-green-500';
		if (score >= threshold * 0.7) return 'bg-yellow-500';
		return 'bg-blue-500';
	}
</script>

<div class="min-h-screen bg-gray-900 text-white">
	<div class="max-w-3xl mx-auto px-4 py-8">
		<!-- Header -->
		<header class="text-center mb-8">
			<h1 class="text-3xl font-bold mb-2">🎯 Wakeword Tester</h1>
			<p class="text-gray-400">Test trained wakeword detection in real-time</p>
			<a href="/" class="text-blue-400 hover:text-blue-300 text-sm">← Back to Recorder</a>
		</header>
		
		<!-- Base Models Warning -->
		{#if !isCheckingModels && !hasBaseModels}
			<div class="bg-yellow-900/50 border border-yellow-600 rounded-2xl p-6 mb-6">
				<h3 class="text-yellow-400 font-semibold mb-2">⚠️ Base Models Required</h3>
				<p class="text-gray-300 text-sm mb-3">
					The openWakeWord base models (melspectrogram.onnx and embedding_model.onnx) are not found. 
					These are required for wakeword detection.
				</p>
				<p class="text-gray-400 text-xs">
					Run the training notebook first - it will clone the openWakeWord repository and download the models automatically.
				</p>
			</div>
		{/if}
		
		<!-- Model Selection -->
		<div class="bg-gray-800 rounded-2xl p-6 mb-6">
			<label for="model-select" class="block text-sm text-gray-400 mb-2">Select Wakeword Model</label>
			{#if availableModels.length > 0}
				<select
					id="model-select"
					bind:value={selectedModel}
					disabled={isListening}
					class="w-full px-4 py-3 bg-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
				>
					{#each availableModels as model (model.name)}
						<option value={model.name}>{model.name}</option>
					{/each}
				</select>
			{:else}
				<div class="text-yellow-400 text-sm">
					No trained models found. Train a model first using the training notebook.
				</div>
			{/if}
		</div>
		
		<!-- Threshold Control -->
		<div class="bg-gray-800 rounded-2xl p-6 mb-6">
			<div class="flex items-center justify-between mb-2">
				<label for="threshold-slider" class="text-sm text-gray-400">Detection Threshold</label>
				<span class="text-white font-mono">{threshold.toFixed(2)}</span>
			</div>
			<input
				id="threshold-slider"
				type="range"
				min="0.1"
				max="0.95"
				step="0.05"
				value={threshold}
				oninput={(e) => updateThreshold(parseFloat(e.currentTarget.value))}
				class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
			/>
			<div class="flex justify-between text-xs text-gray-500 mt-1">
				<span>Sensitive (0.1)</span>
				<span>Strict (0.95)</span>
			</div>
		</div>
		
		<!-- Main Detection Area -->
		<div class="bg-gray-800 rounded-2xl p-6 mb-6">
			<!-- Status -->
			<div class="text-center mb-6">
				{#if isLoading}
					<div class="flex items-center justify-center gap-2 text-blue-400">
						<svg class="animate-spin w-5 h-5" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						<span>Loading models...</span>
					</div>
				{:else if error}
					<div class="text-red-400">
						<p>⚠️ {error}</p>
					</div>
				{:else if isListening}
					<div class="space-y-2">
						<div class="flex items-center justify-center gap-2">
							<span class="relative flex h-3 w-3">
								<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
								<span class="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
							</span>
							<span class="text-gray-300">Listening for "<span class="text-white font-medium">{selectedModel}</span>"</span>
						</div>
					</div>
				{:else}
					<p class="text-gray-400">Click Start to begin detection</p>
				{/if}
			</div>
			
			<!-- Current Score Display -->
			<div class="mb-6">
				<div class="text-center mb-2">
					<span class="text-6xl font-bold font-mono {getScoreColor(currentScore)}">
						{currentScore.toFixed(2)}
					</span>
				</div>
				<div class="text-center text-sm text-gray-400">
					{#if currentScore >= threshold}
						<span class="text-green-400 font-medium">✓ DETECTED</span>
					{:else}
						<span>Detection Score</span>
					{/if}
				</div>
			</div>
			
			<!-- Score History Graph -->
			<div class="mb-6">
				<div class="h-24 flex items-end gap-0.5 bg-gray-900 rounded-lg p-2">
					{#each scoreHistory as score, i (i)}
						<div
							class="flex-1 {getBarColor(score)} rounded-t transition-all duration-75"
							style="height: {Math.max(2, score * 100)}%"
						></div>
					{/each}
				</div>
				<!-- Threshold line indicator -->
				<div class="relative -mt-24 h-24 pointer-events-none">
					<div
						class="absolute w-full border-t-2 border-dashed border-red-500/50"
						style="top: {100 - threshold * 100}%"
					></div>
				</div>
				<div class="text-xs text-gray-500 mt-2 text-center">
					Score history (threshold shown as dashed line)
				</div>
			</div>
			
			<!-- Controls -->
			<div class="flex justify-center gap-4 flex-wrap">
				{#if !isListening}
					<button
						onclick={startListening}
						disabled={isLoading || !selectedModel || availableModels.length === 0 || !hasBaseModels}
						class="px-8 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-full font-medium transition-colors flex items-center gap-2"
					>
						<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
							<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"></path>
							<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"></path>
						</svg>
						Start Testing
					</button>
				{:else}
					<button
						onclick={stopListening}
						class="px-8 py-3 bg-red-600 hover:bg-red-500 rounded-full font-medium transition-colors flex items-center gap-2"
					>
						<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
							<rect x="6" y="6" width="12" height="12"></rect>
						</svg>
						Stop Testing
					</button>
				{/if}
			</div>
			
			<!-- Sample Test Buttons -->
			<div class="mt-4 pt-4 border-t border-gray-700">
				<p class="text-sm text-gray-400 text-center mb-3">Test with training samples:</p>
				<div class="flex justify-center gap-4">
					<button
						onclick={() => testWithSample('positive_test')}
						disabled={isTesting || !selectedModel || !hasBaseModels}
						class="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
					>
						{isTesting ? 'Testing...' : 'Test Positive Sample'}
					</button>
					<button
						onclick={() => testWithSample('negative_test')}
						disabled={isTesting || !selectedModel || !hasBaseModels}
						class="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
					>
						{isTesting ? 'Testing...' : 'Test Negative Sample'}
					</button>
				</div>
				{#if testResult}
					<pre class="mt-3 p-3 bg-gray-900 rounded-lg text-xs text-gray-300 whitespace-pre-wrap">{testResult}</pre>
				{/if}
			</div>
		</div>
		
		<!-- Detection Log -->
		<div class="bg-gray-800 rounded-2xl p-6">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-xl font-semibold">
					Detection Log
					<span class="text-gray-400 font-normal text-base">({detections.length})</span>
				</h2>
				{#if detections.length > 0}
					<button
						onclick={clearDetections}
						class="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
					>
						Clear
					</button>
				{/if}
			</div>
			
			{#if detections.length === 0}
				<div class="text-center py-8 text-gray-500">
					<p>No detections yet</p>
					<p class="text-sm mt-1">Say your wakeword when listening is active</p>
				</div>
			{:else}
				<div class="space-y-2 max-h-64 overflow-y-auto">
					{#each detections.slice().reverse() as detection, i (detection.timestamp.getTime())}
						<div class="flex items-center justify-between px-4 py-3 bg-gray-700/50 rounded-lg">
							<div class="flex items-center gap-3">
								<span class="text-green-400 text-lg">✓</span>
								<span class="text-gray-300">{formatTime(detection.timestamp)}</span>
							</div>
							<div class="text-right">
								<span class="font-mono text-green-400 font-medium">{detection.score.toFixed(3)}</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		
		<!-- Tips -->
		<div class="mt-6 text-sm text-gray-500 text-center">
			<p>💡 Adjust the threshold if you get too many false positives or miss real detections.</p>
		</div>
	</div>
</div>

<style>
	input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 20px;
		height: 20px;
		background: #3b82f6;
		border-radius: 50%;
		cursor: pointer;
	}
	
	input[type="range"]::-moz-range-thumb {
		width: 20px;
		height: 20px;
		background: #3b82f6;
		border-radius: 50%;
		cursor: pointer;
		border: none;
	}
</style>
