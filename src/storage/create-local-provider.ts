import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { StorageProvider } from '../types.js';

export function createLocalProvider(uploadDir: string): StorageProvider {
	const root = path.resolve(uploadDir);

	function fullPath(logicalPath: string): string {
		const full = path.resolve(root, logicalPath);
		if (full !== root && !full.startsWith(root + path.sep)) {
			throw new Error(`Path "${logicalPath}" points outside the upload directory.`);
		}
		return full;
	}

	return {
		async save(logicalPath, file) {
			const dest = fullPath(logicalPath);
			await fs.mkdir(path.dirname(dest), { recursive: true });
			await fs.writeFile(dest, new Uint8Array(await file.arrayBuffer()));
		},
		async read(logicalPath) {
			return fs.readFile(fullPath(logicalPath));
		},
		stream(logicalPath) {
			return Readable.toWeb(createReadStream(fullPath(logicalPath))) as ReadableStream<Uint8Array>;
		},
		async delete(logicalPath) {
			const full = fullPath(logicalPath);
			try {
				await fs.unlink(full);
			} catch (err) {
				// Already gone is fine: the goal (no file) is reached, and the record can still be removed.
				if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
			}
			try {
				await fs.rmdir(path.dirname(full));
			} catch {
				// not empty or already gone — ignore
			}
		},
		async exists(logicalPath) {
			try {
				await fs.access(fullPath(logicalPath));
				return true;
			} catch {
				return false;
			}
		},
		async rename(oldLogicalPath, newLogicalPath) {
			await fs.rename(fullPath(oldLogicalPath), fullPath(newLogicalPath));
		},
	};
}

export type LocalStorageProvider = ReturnType<typeof createLocalProvider>;
