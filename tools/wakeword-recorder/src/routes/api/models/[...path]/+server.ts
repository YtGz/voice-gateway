import type { RequestHandler } from './$types';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Paths relative to the wakeword-recorder directory
const WAKEWORDS_DIR = '../../../../scripts/wakewords';
// Look in the cloned openwakeword repo's resources folder (where training notebook downloads them)
const OPENWAKEWORD_MODELS_DIR = '../../../../scripts/wakeword_training/openwakeword/openwakeword/resources/models';

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
	let filePath = join(process.cwd(), WAKEWORDS_DIR, requestedPath);
	
	// If not found, check in openwakeword resources directory (for melspectrogram.onnx and embedding_model.onnx)
	if (!existsSync(filePath)) {
		filePath = join(process.cwd(), OPENWAKEWORD_MODELS_DIR, requestedPath);
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
