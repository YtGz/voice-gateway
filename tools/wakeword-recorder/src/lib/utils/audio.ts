const TARGET_SAMPLE_RATE = 16000;

export function resampleAudio(audioData: Float32Array, originalSampleRate: number): Float32Array {
	if (originalSampleRate === TARGET_SAMPLE_RATE) {
		return audioData;
	}

	const ratio = originalSampleRate / TARGET_SAMPLE_RATE;
	const newLength = Math.round(audioData.length / ratio);
	const result = new Float32Array(newLength);

	for (let i = 0; i < newLength; i++) {
		const srcIndex = i * ratio;
		const srcIndexFloor = Math.floor(srcIndex);
		const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
		const t = srcIndex - srcIndexFloor;
		result[i] = audioData[srcIndexFloor] * (1 - t) + audioData[srcIndexCeil] * t;
	}

	return result;
}

export function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
	const int16Array = new Int16Array(float32Array.length);
	for (let i = 0; i < float32Array.length; i++) {
		const s = Math.max(-1, Math.min(1, float32Array[i]));
		int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
	}
	return int16Array;
}

export function createWavBlob(audioData: Float32Array, sampleRate: number = TARGET_SAMPLE_RATE): Blob {
	const resampled = resampleAudio(audioData, sampleRate);
	const pcmData = floatTo16BitPCM(resampled);
	
	const wavHeader = new ArrayBuffer(44);
	const view = new DataView(wavHeader);
	
	const writeString = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) {
			view.setUint8(offset + i, str.charCodeAt(i));
		}
	};
	
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = TARGET_SAMPLE_RATE * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = pcmData.length * (bitsPerSample / 8);
	
	writeString(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, TARGET_SAMPLE_RATE, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	writeString(36, 'data');
	view.setUint32(40, dataSize, true);
	
	return new Blob([wavHeader, pcmData.buffer], { type: 'audio/wav' });
}

export function createAudioUrl(audioData: Float32Array, sampleRate: number): string {
	const blob = createWavBlob(audioData, sampleRate);
	return URL.createObjectURL(blob);
}
