import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Get the project root (voice-gateway) from the current file location
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..');

// Paths relative to voice-gateway root
const WAKEWORDS_DIR = join(PROJECT_ROOT, 'scripts', 'wakewords');
const OPENWAKEWORD_MODELS_DIR = join(PROJECT_ROOT, 'scripts', 'wakeword_training', 'openwakeword', 'openwakeword', 'resources', 'models');

export const GET: RequestHandler = async ({ params }) => {
	const requestedPath = params.path;
	
	if (!requestedPath) {
		return new Response('Not found', { status: 404 });
	}
	
	// Security: prevent directory traversal
	if (requestedPath.includes('..')) {
		return new Response('Forbidden', { status: 403 });
	}
	
	// Only allow .onnx files
	if (!requestedPath.endsWith('.onnx')) {
		return new Response('Only .onnx files are allowed', { status: 400 });
	}
	
	// Check in wakewords directory first
	let filePath = join(WAKEWORDS_DIR, requestedPath);
	
	// If not found, check in openwakeword resources directory (for melspectrogram.onnx and embedding_model.onnx)
	if (!existsSync(filePath)) {
		filePath = join(OPENWAKEWORD_MODELS_DIR, requestedPath);
	}
	
	if (!existsSync(filePath)) {
		return new Response(`Model not found: ${requestedPath}`, { status: 404 });
	}
	
	try {
		const data = await readFile(filePath);
		
		return new Response(data, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': `attachment; filename="${requestedPath.split('/').pop()}"`,
				'Cache-Control': 'public, max-age=3600',
			},
		});
	} catch (error) {
		console.error('Failed to read model file:', error);
		return new Response('Failed to read model', { status: 500 });
	}
};
