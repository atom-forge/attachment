import type { FileServerDriver } from './create-file-server.js';

declare const Bun: {
	file(path: string): { exists(): Promise<boolean> } & Blob;
};

/**
 * Bun driver — uses `Bun.file()` for lazy, streaming file serving.
 * Import this in `hooks.server.ts` when running on Bun.
 */
export const bunDriver: FileServerDriver = {
	async exists(fullPath) {
		return Bun.file(fullPath).exists();
	},
	async serve(fullPath, contentType) {
		return new Response(Bun.file(fullPath), {
			headers: {
				'Content-Type':  contentType,
				'Cache-Control': 'public, max-age=31536000, immutable',
			},
		});
	},
};
