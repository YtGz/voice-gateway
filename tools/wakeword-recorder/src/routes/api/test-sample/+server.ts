import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Get the project root (voice-gateway) from the current file location
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');

const TRAINING_DIR = join(PROJECT_ROOT, 'scripts', 'wakeword_training', 'my_custom_model');

export const GET: RequestHandler = async ({ url }) => {
	const wakeword = url.searchParams.get('wakeword') || 'Seraphina';
	const type = url.searchParams.get('type') || 'positive_test';
	const index = parseInt(url.searchParams.get('index') || '0');
	
	try {
		const sampleDir = join(TRAINING_DIR, wakeword, type);
		
		if (!existsSync(sampleDir)) {
			return json({ error: `Directory not found: ${sampleDir}` }, { status: 404 });
		}
		
		const files = await readdir(sampleDir);
		const wavFiles = files.filter(f => f.endsWith('.wav')).sort();
		
		if (index >= wavFiles.length) {
			return json({ error: `Index ${index} out of range. Total files: ${wavFiles.length}` }, { status: 400 });
		}
		
		const wavPath = join(sampleDir, wavFiles[index]);
		const wavBuffer = await readFile(wavPath);
		
		// Parse WAV file to get audio samples
		const audioData = parseWav(wavBuffer);
		
		return json({
			file: wavFiles[index],
			sampleRate: audioData.sampleRate,
			samples: audioData.samples.length,
			duration: audioData.samples.length / audioData.sampleRate,
			// Return samples as base64 for the client to decode
			audioBase64: Buffer.from(audioData.samples.buffer).toString('base64'),
			totalFiles: wavFiles.length,
		});
	} catch (error) {
		console.error('Failed to load sample:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};

function parseWav(buffer: Buffer): { sampleRate: number; samples: Float32Array } {
	// Simple WAV parser - assumes 16-bit PCM mono
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	
	// Check RIFF header
	const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
	if (riff !== 'RIFF') {
		throw new Error('Not a valid WAV file');
	}
	
	// Find sample rate (bytes 24-27)
	const sampleRate = view.getUint32(24, true);
	
	// Find bits per sample (bytes 34-35)
	const bitsPerSample = view.getUint16(34, true);
	
	// Find data chunk
	let dataOffset = 44; // Standard position
	for (let i = 12; i < buffer.length - 8; i++) {
		if (buffer[i] === 0x64 && buffer[i+1] === 0x61 && buffer[i+2] === 0x74 && buffer[i+3] === 0x61) {
			dataOffset = i + 8;
			break;
		}
	}
	
	// Read samples
	const numSamples = Math.floor((buffer.length - dataOffset) / (bitsPerSample / 8));
	const samples = new Float32Array(numSamples);
	
	if (bitsPerSample === 16) {
		for (let i = 0; i < numSamples; i++) {
			const sample = view.getInt16(dataOffset + i * 2, true);
			samples[i] = sample / 32768; // Normalize to [-1, 1]
		}
	} else if (bitsPerSample === 32) {
		for (let i = 0; i < numSamples; i++) {
			samples[i] = view.getFloat32(dataOffset + i * 4, true);
		}
	}
	
	return { sampleRate, samples };
}
