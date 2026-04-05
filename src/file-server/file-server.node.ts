import { access, readFile } from 'node:fs/promises';
import type { FileServerDriver } from './create-file-server.js';

/**
 * Node.js driver — uses `fs/promises` for file serving.
 * Import this in `hooks.server.ts` when running on plain Node.js.
 */
export const nodeDriver: FileServerDriver = {
	async exists(fullPath) {
		try {
			await access(fullPath);
			return true;
		} catch {
			return false;
		}
	},
	async serve(fullPath, contentType) {
		const data = await readFile(fullPath);
		return new Response(data, {
			headers: {
				'Content-Type':  contentType,
				'Cache-Control': 'public, max-age=31536000, immutable',
			},
		});
	},
};
