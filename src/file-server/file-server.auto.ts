import { access, readFile } from 'node:fs/promises';
import type { FileServerDriver } from './create-file-server.js';

const isBun = typeof (globalThis as any).Bun !== 'undefined';

/**
 * Auto-detecting driver — uses Bun's native file API when running under Bun,
 * falls back to Node.js `fs/promises` otherwise.
 * No configuration needed.
 */
export const autoDriver: FileServerDriver = {
	async exists(fullPath) {
		if (isBun) return (globalThis as any).Bun.file(fullPath).exists();
		try {
			await access(fullPath);
			return true;
		} catch {
			return false;
		}
	},
	async serve(fullPath, contentType) {
		const headers = {
			'Content-Type':  contentType,
			'Cache-Control': 'public, max-age=31536000, immutable',
		};
		if (isBun) return new Response((globalThis as any).Bun.file(fullPath), { headers });
		const data = await readFile(fullPath);
		return new Response(data, { headers });
	},
};
