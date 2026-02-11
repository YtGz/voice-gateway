import { writable } from 'svelte/store';

export interface Clip {
	id: string;
	audio: Float32Array;
	duration: number;
	timestamp: Date;
}

function createClipsStore() {
	const { subscribe, update, set } = writable<Clip[]>([]);

	return {
		subscribe,
		add: (audio: Float32Array, sampleRate: number) => {
			const clip: Clip = {
				id: crypto.randomUUID(),
				audio,
				duration: audio.length / sampleRate,
				timestamp: new Date()
			};
			update(clips => [...clips, clip]);
			return clip;
		},
		remove: (id: string) => {
			update(clips => clips.filter(c => c.id !== id));
		},
		clear: () => set([])
	};
}

export const clips = createClipsStore();
