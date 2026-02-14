import JSZip from 'jszip';
import type { Clip } from '$lib/stores/clips';
import { createWavBlob } from './audio';

export async function exportClipsAsZip(clips: Clip[], sampleRate: number = 16000): Promise<Blob> {
	const zip = new JSZip();
	
	clips.forEach((clip, index) => {
		const filename = `real_${String(index + 1).padStart(3, '0')}.wav`;
		const wavBlob = createWavBlob(clip.audio, sampleRate);
		zip.file(filename, wavBlob);
	});
	
	return await zip.generateAsync({ type: 'blob' });
}

export interface TrainTestSplit {
	trainZip: Blob;
	testZip: Blob;
	trainCount: number;
	testCount: number;
}

export async function exportClipsForTraining(
	clips: Clip[], 
	sampleRate: number = 16000,
	testRatio: number = 0.2
): Promise<TrainTestSplit> {
	const trainZip = new JSZip();
	const testZip = new JSZip();
	
	// Shuffle clips for random split
	const shuffled = [...clips].sort(() => Math.random() - 0.5);
	const testCount = Math.max(1, Math.floor(shuffled.length * testRatio));
	const trainCount = shuffled.length - testCount;
	
	// Split into train and test
	const testClips = shuffled.slice(0, testCount);
	const trainClips = shuffled.slice(testCount);
	
	// Add to train zip
	trainClips.forEach((clip, index) => {
		const filename = `real_${String(index + 1).padStart(3, '0')}.wav`;
		const wavBlob = createWavBlob(clip.audio, sampleRate);
		trainZip.file(filename, wavBlob);
	});
	
	// Add to test zip
	testClips.forEach((clip, index) => {
		const filename = `real_${String(index + 1).padStart(3, '0')}.wav`;
		const wavBlob = createWavBlob(clip.audio, sampleRate);
		testZip.file(filename, wavBlob);
	});
	
	return {
		trainZip: await trainZip.generateAsync({ type: 'blob' }),
		testZip: await testZip.generateAsync({ type: 'blob' }),
		trainCount,
		testCount
	};
}

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
