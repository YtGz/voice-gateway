import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Get the project root (voice-gateway) from the current file location
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');

// Paths relative to voice-gateway root
const WAKEWORDS_DIR = join(PROJECT_ROOT, 'scripts', 'wakewords');
const OPENWAKEWORD_MODELS_DIR = join(PROJECT_ROOT, 'scripts', 'wakeword_training', 'openwakeword', 'openwakeword', 'resources', 'models');

export const GET: RequestHandler = async () => {
	try {
		const wakewordsPath = WAKEWORDS_DIR;
		const baseModelsPath = OPENWAKEWORD_MODELS_DIR;
		
		// Check for base models
		const hasMelModel = existsSync(join(baseModelsPath, 'melspectrogram.onnx'));
		const hasEmbeddingModel = existsSync(join(baseModelsPath, 'embedding_model.onnx'));
		const hasBaseModels = hasMelModel && hasEmbeddingModel;
		
		const models: { name: string; path: string }[] = [];
		
		if (existsSync(wakewordsPath)) {
			const entries = await readdir(wakewordsPath, { withFileTypes: true });
			
			for (const entry of entries) {
				if (entry.isDirectory()) {
					// Look for .onnx files in this directory
					const modelDir = join(wakewordsPath, entry.name);
					const files = await readdir(modelDir);
					const onnxFile = files.find(f => f.endsWith('.onnx'));
					
					if (onnxFile) {
						models.push({
							name: entry.name,
							path: `/api/models/${entry.name}/${onnxFile}`,
						});
					}
				}
			}
		}
		
		return json({ 
			models,
			hasBaseModels,
			baseModelsPath: OPENWAKEWORD_MODELS_DIR,
		});
	} catch (error) {
		console.error('Failed to list models:', error);
		return json({ models: [], hasBaseModels: false, error: String(error) });
	}
};
