import fs from 'node:fs/promises';
import { createReadStream, constants as fsConstants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { StorageProvider, StoredFile } from '../types.js';

async function writeTemp(dest: string, file: File): Promise<string> {
	const data = new Uint8Array(await file.arrayBuffer());
	const temp = path.join(path.dirname(dest), `.${path.basename(dest)}.${randomBytes(6).toString('hex')}.part`);
	for (let attempt = 0; ; attempt++) {
		await fs.mkdir(path.dirname(dest), { recursive: true });
		try {
			await fs.writeFile(temp, data, { flag: 'wx' });
			return temp;
		} catch (err) {
			// delete() removes an emptied folder; a concurrent write may lose its folder once
			if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || attempt >= 2) throw err;
		}
	}
}

const pathLocks = new Map<string, Promise<unknown>>();

async function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = pathLocks.get(key) ?? Promise.resolve();
	const run = previous.then(fn, fn);
	const tail = run.catch(() => {});
	pathLocks.set(key, tail);
	try {
		return await run;
	} finally {
		if (pathLocks.get(key) === tail) pathLocks.delete(key);
	}
}

function statToken(st: { ino: number; mtimeMs: number; size: number }): string {
	return `${st.ino}-${st.mtimeMs}-${st.size}`;
}

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

		// --- atomic mode ---

		async create(logicalPath, file) {
			// Written under a temporary name and linked into place: link() fails when the
			// target exists, and readers never see a half-written file under the real name.
			const dest = fullPath(logicalPath);
			const temp = await writeTemp(dest, file);
			try {
				await fs.link(temp, dest);
				return true;
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
				throw err;
			} finally {
				await fs.unlink(temp).catch(() => {});
			}
		},
		async copy(fromLogicalPath, toLogicalPath) {
			try {
				await fs.copyFile(fullPath(fromLogicalPath), fullPath(toLogicalPath), fsConstants.COPYFILE_EXCL);
				return true;
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
				throw err;
			}
		},
		async list(logicalFolder) {
			const dir = fullPath(logicalFolder);
			let names: string[];
			try {
				names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
				throw err;
			}
			const files: StoredFile[] = [];
			for (const name of names) {
				try {
					files.push({ name, modified: (await fs.stat(path.join(dir, name))).mtimeMs });
				} catch {
					// deleted meanwhile
				}
			}
			return files;
		},
		async etag(logicalPath) {
			try {
				return statToken(await fs.stat(fullPath(logicalPath)));
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
				throw err;
			}
		},
		async replaceIf(logicalPath, file, etag) {
			// The file system has no conditional overwrite: the check and the rename are two
			// steps. They run under a per-path lock, which makes them exact within one process;
			// processes sharing the folder (e.g. over NFS) keep a window of microseconds.
			const dest = fullPath(logicalPath);
			const temp = await writeTemp(dest, file);
			try {
				return await withPathLock(dest, async () => {
					const current = await fs.stat(dest).then(statToken, () => null);
					if (current !== etag) return false;
					await fs.rename(temp, dest);
					return true;
				});
			} finally {
				await fs.unlink(temp).catch(() => {});
			}
		},
	};
}

export type LocalStorageProvider = ReturnType<typeof createLocalProvider>;
