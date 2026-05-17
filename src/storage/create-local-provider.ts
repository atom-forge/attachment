import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { StorageProvider } from '../types.js';

export function createLocalProvider(uploadDir: string): StorageProvider {
	const root = path.resolve(uploadDir);

	function fullPath(logicalPath: string): string {
		return path.join(root, logicalPath);
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
			await fs.unlink(full);
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
