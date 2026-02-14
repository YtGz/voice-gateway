/**
 * OpenWakeWord detector for browser using ONNX Runtime Web.
 * 
 * Pipeline:
 * 1. Audio (16kHz, 80ms chunks) → melspectrogram.onnx → mel frames
 * 2. 76 mel frames → embedding_model.onnx → 96-dim embedding
 * 3. 16 embeddings → wakeword.onnx → detection score
 */

import * as ort from 'onnxruntime-web';

// Constants from openWakeWord
const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 1280; // 80ms at 16kHz
const MEL_FRAMES_PER_CHUNK = 5;
const MEL_WINDOW_SIZE = 76;
const MEL_STRIDE = 8;
const EMBEDDING_SIZE = 96;
const EMBEDDING_WINDOW_SIZE = 16;

export interface WakewordDetectorOptions {
	melModelPath: string;
	embeddingModelPath: string;
	wakewordModelPath: string;
	threshold?: number;
	onDetection?: (score: number) => void;
	onScoreUpdate?: (score: number) => void;
}

export interface DetectionResult {
	detected: boolean;
	score: number;
	timestamp: number;
}

export class WakewordDetector {
	private melSession: ort.InferenceSession | null = null;
	private embeddingSession: ort.InferenceSession | null = null;
	private wakewordSession: ort.InferenceSession | null = null;
	
	private melBuffer: number[][] = [];
	private embeddingBuffer: number[][] = [];
	
	private threshold: number;
	private onDetection?: (score: number) => void;
	private onScoreUpdate?: (score: number) => void;
	
	private isReady = false;
	private lastScore = 0;
	
	constructor(private options: WakewordDetectorOptions) {
		this.threshold = options.threshold ?? 0.5;
		this.onDetection = options.onDetection;
		this.onScoreUpdate = options.onScoreUpdate;
	}
	
	async initialize(): Promise<void> {
		// Set ONNX Runtime Web to use WASM backend (must match installed version)
		ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/';
		
		try {
			// Load all models in parallel
			const [melSession, embeddingSession, wakewordSession] = await Promise.all([
				ort.InferenceSession.create(this.options.melModelPath, {
					executionProviders: ['wasm'],
				}),
				ort.InferenceSession.create(this.options.embeddingModelPath, {
					executionProviders: ['wasm'],
				}),
				ort.InferenceSession.create(this.options.wakewordModelPath, {
					executionProviders: ['wasm'],
				}),
			]);
			
			this.melSession = melSession;
			this.embeddingSession = embeddingSession;
			this.wakewordSession = wakewordSession;
			this.isReady = true;
			
			console.log('WakewordDetector initialized');
			console.log('Mel model inputs:', this.melSession.inputNames, 'outputs:', this.melSession.outputNames);
			console.log('Embedding model inputs:', this.embeddingSession.inputNames, 'outputs:', this.embeddingSession.outputNames);
			console.log('Wakeword model inputs:', this.wakewordSession.inputNames, 'outputs:', this.wakewordSession.outputNames);
		} catch (error) {
			console.error('Failed to initialize WakewordDetector:', error);
			throw error;
		}
	}
	
	/**
	 * Process an audio chunk (80ms = 1280 samples at 16kHz).
	 * Returns detection result if enough data has accumulated.
	 */
	async processAudioChunk(audioData: Float32Array): Promise<DetectionResult | null> {
		if (!this.isReady || !this.melSession || !this.embeddingSession || !this.wakewordSession) {
			throw new Error('Detector not initialized');
		}
		
		// Ensure correct chunk size
		if (audioData.length !== CHUNK_SAMPLES) {
			console.warn(`Expected ${CHUNK_SAMPLES} samples, got ${audioData.length}`);
			// Pad or truncate
			const adjusted = new Float32Array(CHUNK_SAMPLES);
			adjusted.set(audioData.slice(0, CHUNK_SAMPLES));
			audioData = adjusted;
		}
		
		// Step 1: Compute mel spectrogram
		const melFrames = await this.computeMelSpectrogram(audioData);
		
		// Add to mel buffer
		for (const frame of melFrames) {
			this.melBuffer.push(frame);
		}
		
		// Step 2: If we have enough mel frames, compute embedding
		while (this.melBuffer.length >= MEL_WINDOW_SIZE) {
			const melWindow = this.melBuffer.slice(0, MEL_WINDOW_SIZE);
			const embedding = await this.computeEmbedding(melWindow);
			this.embeddingBuffer.push(embedding);
			
			// Slide mel buffer forward
			this.melBuffer.splice(0, MEL_STRIDE);
		}
		
		// Step 3: If we have enough embeddings, run wakeword detection
		if (this.embeddingBuffer.length >= EMBEDDING_WINDOW_SIZE) {
			const embeddingWindow = this.embeddingBuffer.slice(0, EMBEDDING_WINDOW_SIZE);
			const score = await this.detectWakeword(embeddingWindow);
			
			// Slide embedding buffer forward (by 1 for smooth detection)
			this.embeddingBuffer.shift();
			
			// Ensure score is a valid number
			const safeScore = typeof score === 'number' && !isNaN(score) ? score : 0;
			
			this.lastScore = safeScore;
			this.onScoreUpdate?.(safeScore);
			
			const detected = safeScore >= this.threshold;
			if (detected) {
				this.onDetection?.(safeScore);
			}
			
			return {
				detected,
				score: safeScore,
				timestamp: Date.now(),
			};
		}
		
		return null;
	}
	
	/**
	 * Process continuous Float32Array audio data (any length).
	 * Internally chunks and processes.
	 */
	async processAudio(audioData: Float32Array): Promise<DetectionResult | null> {
		let lastResult: DetectionResult | null = null;
		
		// Process in 80ms chunks
		for (let i = 0; i + CHUNK_SAMPLES <= audioData.length; i += CHUNK_SAMPLES) {
			const chunk = audioData.slice(i, i + CHUNK_SAMPLES);
			const result = await this.processAudioChunk(chunk);
			if (result) {
				lastResult = result;
			}
		}
		
		return lastResult;
	}
	
	private async computeMelSpectrogram(audioData: Float32Array): Promise<number[][]> {
		if (!this.melSession) throw new Error('Mel session not initialized');
		
		// Convert float32 [-1, 1] to int16 range [-32768, 32767] as expected by openWakeWord
		const int16Audio = new Float32Array(audioData.length);
		for (let i = 0; i < audioData.length; i++) {
			int16Audio[i] = Math.max(-32768, Math.min(32767, audioData[i] * 32767));
		}
		
		// Input tensor: [1, 1280]
		const inputTensor = new ort.Tensor('float32', int16Audio, [1, CHUNK_SAMPLES]);
		
		const feeds: Record<string, ort.Tensor> = {};
		feeds[this.melSession.inputNames[0]] = inputTensor;
		
		const results = await this.melSession.run(feeds);
		const output = results[this.melSession.outputNames[0]];
		
		// Handle both ORT tensor formats
		let melData: Float32Array;
		if (output.data && (output.data as Float32Array).length > 0) {
			melData = output.data as Float32Array;
		} else if ((output as any).cpuData) {
			melData = (output as any).cpuData;
		} else {
			melData = new Float32Array(0);
		}
		
		// Apply transformation: (value / 10.0) + 2.0
		const transformedData = new Float32Array(melData.length);
		for (let i = 0; i < melData.length; i++) {
			transformedData[i] = (melData[i] / 10.0) + 2.0;
		}
		
		// Output shape is [1, 1, 5, 32] = [batch, channel, frames, mel_bins]
		const dims = output.dims as number[];
		const numFrames = dims[2] || MEL_FRAMES_PER_CHUNK;
		const melBins = dims[3] || 32;
		
		// Reshape: data is in [frame][mel_bin] order (row-major for last two dims)
		const frames: number[][] = [];
		for (let f = 0; f < numFrames; f++) {
			const frame: number[] = [];
			for (let b = 0; b < melBins; b++) {
				frame.push(transformedData[f * melBins + b]);
			}
			frames.push(frame);
		}
		
		return frames;
	}
	
	private async computeEmbedding(melFrames: number[][]): Promise<number[]> {
		if (!this.embeddingSession) throw new Error('Embedding session not initialized');
		
		// Input shape: [1, 76, 32, 1] (batch, frames, mel_bins, channel)
		const MEL_BINS = 32;
		const flatData = new Float32Array(MEL_WINDOW_SIZE * MEL_BINS);
		
		for (let f = 0; f < MEL_WINDOW_SIZE; f++) {
			for (let b = 0; b < MEL_BINS; b++) {
				flatData[f * MEL_BINS + b] = melFrames[f]?.[b] ?? 0;
			}
		}
		
		const inputTensor = new ort.Tensor('float32', flatData, [1, MEL_WINDOW_SIZE, MEL_BINS, 1]);
		
		const feeds: Record<string, ort.Tensor> = {};
		feeds[this.embeddingSession.inputNames[0]] = inputTensor;
		
		const results = await this.embeddingSession.run(feeds);
		const output = results[this.embeddingSession.outputNames[0]];
		// Handle both ORT tensor formats
		let data: Float32Array;
		if (output.data && (output.data as Float32Array).length > 0) {
			data = output.data as Float32Array;
		} else if ((output as any).cpuData) {
			data = (output as any).cpuData;
		} else {
			data = new Float32Array(0);
		}
		
		return Array.from(data);
	}
	
	private async detectWakeword(embeddings: number[][]): Promise<number> {
		if (!this.wakewordSession) throw new Error('Wakeword session not initialized');
		
		// Get actual embedding size from first embedding
		const actualEmbeddingSize = embeddings[0]?.length || EMBEDDING_SIZE;
		
		// Flatten embeddings - use actual size from embeddings
		const flatData = new Float32Array(EMBEDDING_WINDOW_SIZE * actualEmbeddingSize);
		
		for (let e = 0; e < EMBEDDING_WINDOW_SIZE; e++) {
			for (let i = 0; i < actualEmbeddingSize; i++) {
				flatData[e * actualEmbeddingSize + i] = embeddings[e]?.[i] ?? 0;
			}
		}
		
		// Model expects 3D input [1, 16, 96] based on error "Expected: 3"
		const inputTensor = new ort.Tensor('float32', flatData, [1, EMBEDDING_WINDOW_SIZE, actualEmbeddingSize]);
		
		const feeds: Record<string, ort.Tensor> = {};
		feeds[this.wakewordSession.inputNames[0]] = inputTensor;
		
		const results = await this.wakewordSession.run(feeds);
		const output = results[this.wakewordSession.outputNames[0]];
		
		// Try multiple ways to access the data (ORT versions differ)
		let rawScore = 0;
		if (output.data && (output.data as Float32Array).length > 0) {
			rawScore = (output.data as Float32Array)[0];
		} else if ((output as any).cpuData && (output as any).cpuData.length > 0) {
			rawScore = (output as any).cpuData[0];
		} else if (typeof output.getData === 'function') {
			const data = output.getData();
			if (data && data.length > 0) {
				rawScore = data[0];
			}
		}
		
		// Apply sigmoid to convert logits to probability
		const sigmoid = 1 / (1 + Math.exp(-rawScore));
		
		return typeof sigmoid === 'number' && !isNaN(sigmoid) ? sigmoid : 0;
	}
	
	setThreshold(threshold: number): void {
		this.threshold = Math.max(0, Math.min(1, threshold));
	}
	
	getLastScore(): number {
		return this.lastScore;
	}
	
	reset(): void {
		this.melBuffer = [];
		this.embeddingBuffer = [];
		this.lastScore = 0;
	}
	
	destroy(): void {
		this.melSession?.release();
		this.embeddingSession?.release();
		this.wakewordSession?.release();
		this.melSession = null;
		this.embeddingSession = null;
		this.wakewordSession = null;
		this.isReady = false;
	}
}

export { SAMPLE_RATE, CHUNK_SAMPLES };
