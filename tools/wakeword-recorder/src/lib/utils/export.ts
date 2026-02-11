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
