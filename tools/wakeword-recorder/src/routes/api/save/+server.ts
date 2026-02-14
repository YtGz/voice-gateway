import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRAINING_BASE = join(__dirname, '../../../../../../scripts/wakeword_training');

async function getNextIndex(dir: string): Promise<number> {
	if (!existsSync(dir)) return 1;
	try {
		const files = await readdir(dir);
		const realFiles = files.filter((f: string) => f.startsWith('real_') && f.endsWith('.wav'));
		return realFiles.length + 1;
	} catch {
		return 1;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { clips, wakeword, testRatio = 0.2 } = await request.json();
		
		if (!clips || !Array.isArray(clips) || clips.length === 0) {
			return json({ error: 'No clips provided' }, { status: 400 });
		}
		
		if (!wakeword || typeof wakeword !== 'string') {
			return json({ error: 'Wakeword name required' }, { status: 400 });
		}
		
		const safeName = wakeword.toLowerCase().replace(/[^a-z0-9]/g, '_');
		const trainDir = join(TRAINING_BASE, 'clips', safeName, 'positive_train');
		const testDir = join(TRAINING_BASE, 'clips', safeName, 'positive_test');
		
		// Create directories
		await mkdir(trainDir, { recursive: true });
		await mkdir(testDir, { recursive: true });
		
		// Shuffle and split clips
		const shuffled = [...clips].sort(() => Math.random() - 0.5);
		const testCount = Math.max(1, Math.floor(shuffled.length * testRatio));
		const testClips = shuffled.slice(0, testCount);
		const trainClips = shuffled.slice(testCount);
		
		// Count existing files to continue numbering
		let trainIndex = await getNextIndex(trainDir);
		let testIndex = await getNextIndex(testDir);
		
		// Save train clips
		for (const clip of trainClips) {
			const filename = `real_${String(trainIndex++).padStart(3, '0')}.wav`;
			const filepath = join(trainDir, filename);
			const buffer = Buffer.from(clip.wavData, 'base64');
			await writeFile(filepath, buffer);
		}
		
		// Save test clips
		for (const clip of testClips) {
			const filename = `real_${String(testIndex++).padStart(3, '0')}.wav`;
			const filepath = join(testDir, filename);
			const buffer = Buffer.from(clip.wavData, 'base64');
			await writeFile(filepath, buffer);
		}
		
		return json({
			success: true,
			trainDir,
			testDir,
			trainCount: trainClips.length,
			testCount: testClips.length
		});
	} catch (error) {
		console.error('Failed to save clips:', error);
		return json({ error: String(error) }, { status: 500 });
	}
};
