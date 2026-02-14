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
			
			this.lastScore = score;
			this.onScoreUpdate?.(score);
			
			const detected = score >= this.threshold;
			if (detected) {
				this.onDetection?.(score);
			}
			
			return {
				detected,
				score,
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
		
		// Input tensor: [1, 1280]
		const inputTensor = new ort.Tensor('float32', audioData, [1, CHUNK_SAMPLES]);
		
		const feeds: Record<string, ort.Tensor> = {};
		feeds[this.melSession.inputNames[0]] = inputTensor;
		
		const results = await this.melSession.run(feeds);
		const output = results[this.melSession.outputNames[0]];
		// Handle both ORT tensor formats (older uses getData(), newer uses .data)
		const melData = (typeof output.getData === 'function' ? output.getData() : output.data) as Float32Array;
		
		// Apply transformation: (value / 10.0) + 2.0
		const transformedData = new Float32Array(melData.length);
		for (let i = 0; i < melData.length; i++) {
			transformedData[i] = (melData[i] / 10.0) + 2.0;
		}
		
		// Reshape into frames (5 frames x 32 mel bins typically)
		// Output shape is [1, 5, N] where N is mel bins
		const dims = output.dims as number[];
		const numFrames = dims[1] || MEL_FRAMES_PER_CHUNK;
		const melBins = dims[2] || Math.floor(transformedData.length / numFrames);
		
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
		
		// Flatten mel frames into tensor
		// Input shape: [1, 76, mel_bins]
		const melBins = melFrames[0].length;
		const flatData = new Float32Array(MEL_WINDOW_SIZE * melBins);
		
		for (let f = 0; f < MEL_WINDOW_SIZE; f++) {
			for (let b = 0; b < melBins; b++) {
				flatData[f * melBins + b] = melFrames[f][b];
			}
		}
		
		const inputTensor = new ort.Tensor('float32', flatData, [1, MEL_WINDOW_SIZE, melBins]);
		
		const feeds: Record<string, ort.Tensor> = {};
		feeds[this.embeddingSession.inputNames[0]] = inputTensor;
		
		const results = await this.embeddingSession.run(feeds);
		const output = results[this.embeddingSession.outputNames[0]];
		// Handle both ORT tensor formats
		const data = (typeof output.getData === 'function' ? output.getData() : output.data) as Float32Array;
		
		return Array.from(data);
	}
	
	private async detectWakeword(embeddings: number[][]): Promise<number> {
		if (!this.wakewordSession) throw new Error('Wakeword session not initialized');
		
		// Flatten embeddings into tensor
		// Input shape: [1, 16, 96] or [1, 16 * 96]
		const flatData = new Float32Array(EMBEDDING_WINDOW_SIZE * EMBEDDING_SIZE);
		
		for (let e = 0; e < EMBEDDING_WINDOW_SIZE; e++) {
			for (let i = 0; i < EMBEDDING_SIZE; i++) {
				flatData[e * EMBEDDING_SIZE + i] = embeddings[e]?.[i] ?? 0;
			}
		}
		
		// Try different input shapes based on model requirements
		let inputTensor: ort.Tensor;
		try {
			inputTensor = new ort.Tensor('float32', flatData, [1, EMBEDDING_WINDOW_SIZE, EMBEDDING_SIZE]);
		} catch {
			// Fall back to flattened shape
			inputTensor = new ort.Tensor('float32', flatData, [1, EMBEDDING_WINDOW_SIZE * EMBEDDING_SIZE]);
		}
		
		const feeds: Record<string, ort.Tensor> = {};
		feeds[this.wakewordSession.inputNames[0]] = inputTensor;
		
		const results = await this.wakewordSession.run(feeds);
		const output = results[this.wakewordSession.outputNames[0]];
		// Handle both ORT tensor formats
		const scores = (typeof output.getData === 'function' ? output.getData() : output.data) as Float32Array;
		
		// Return the wakeword score (usually first or max value)
		return scores[0];
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
