import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defineAttachments } from '../src/define-attachments.ts';
import { createLocalProvider } from '../src/storage/create-local-provider.ts';
import { count } from '../src/middlewares/count.ts';
import { sumSize } from '../src/middlewares/sumSize.ts';
import { AttachmentValidationError, type AtomicFn, type StorageProvider, type UploadMiddleware } from '../src/types.ts';

// ---------------------------------------------------------------------------
// A fake database: rows in memory, `atomic` as a compare-and-set loop with
// random delays, so concurrent operations really interleave. Every request
// loads its own entity object, like separate requests or separate instances.
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => delay(Math.random() * 5);

function makeDb() {
	const rows = new Map<string, { id: number; attachments: unknown }>();
	let failNextWriteAfterSave = false;
	const atomic: AtomicFn = async ({ entityId }, mutate) => {
		for (;;) {
			const row = rows.get(entityId)!;
			const before = JSON.stringify(row.attachments ?? null);
			await jitter();
			const next = mutate(structuredClone(row.attachments ?? null));
			await jitter();
			if (JSON.stringify(rows.get(entityId)!.attachments ?? null) === before) {
				row.attachments = structuredClone(next);
				if (failNextWriteAfterSave) {
					failNextWriteAfterSave = false;
					throw new Error('connection lost after commit');
				}
				return structuredClone(next);
			}
		}
	};
	return {
		rows,
		atomic,
		insert(id: number) {
			rows.set(String(id), { id, attachments: null });
		},
		load(id: number) {
			return structuredClone(rows.get(String(id))!) as { id: number; attachments: unknown } & Record<string, unknown>;
		},
		store(id: number) {
			return (rows.get(String(id))!.attachments ?? {}) as Record<string, { i: string; v: number; f: { n: string; s: number }[] }>;
		},
		failAfterSave() {
			failNextWriteAfterSave = true;
		},
	};
}

const file = (name: string, content: string) => new File([content], name, { type: 'text/plain' });

const slow = (ms: number): UploadMiddleware => async (f, meta) => {
	await delay(ms);
	return { file: f, meta };
};

let dir: string;
let provider: StorageProvider;
let db: ReturnType<typeof makeDb>;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-atomic-'));
	provider = createLocalProvider(dir);
	db = makeDb();
	db.insert(1);
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

function define(categories: Record<string, { code: string; middlewares?: UploadMiddleware[] }>, extra: { orphanAge?: number; provider?: StorageProvider } = {}) {
	return defineAttachments(
		{ user: defineAttachments.entity(categories) },
		{ provider: extra.provider ?? provider, atomic: db.atomic, orphanAge: extra.orphanAge },
	);
}

async function filesOnDisk(): Promise<string[]> {
	const out: string[] = [];
	async function walk(d: string) {
		for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) await walk(p);
			else out.push(path.relative(dir, p));
		}
	}
	await walk(dir);
	return out.sort();
}

async function read(groupId: string, name: string): Promise<string> {
	return fs.readFile(path.join(dir, groupId.slice(0, 2), groupId, name), 'utf8');
}

describe('atomic mode — acceptance', () => {
	test('parallel uploads from separate requests: every file is kept', async () => {
		const a = define({ docs: { code: 'DC', middlewares: [slow(5)] } });
		await Promise.all(Array.from({ length: 10 }, (_, i) => a.user(db.load(1)).docs.add(file(`f${i}.txt`, `content ${i}`), {})));
		const store = db.store(1).docs;
		expect(store.f.map((f) => f.n).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `f${i}.txt`).sort());
		expect((await filesOnDisk()).length).toBe(10);
	});

	test('parallel uploads with the same name: separate, intact files', async () => {
		const a = define({ docs: { code: 'DC' } });
		await Promise.all(Array.from({ length: 5 }, (_, i) => a.user(db.load(1)).docs.add(file('photo.txt', `content ${i}`), {})));
		const store = db.store(1).docs;
		const names = store.f.map((f) => f.n);
		expect(new Set(names).size).toBe(5);
		const contents = await Promise.all(names.map((n) => read(store.i, n)));
		expect(new Set(contents).size).toBe(5);
		expect(contents.sort()).toEqual(Array.from({ length: 5 }, (_, i) => `content ${i}`));
	});

	test('parallel first uploads: a single group', async () => {
		const a = define({ docs: { code: 'DC' } });
		const results = await Promise.all(Array.from({ length: 6 }, (_, i) => a.user(db.load(1)).docs.add(file(`f${i}.txt`, 'x'), {})));
		expect(new Set(results.map((r) => r.groupId)).size).toBe(1);
		expect(db.store(1).docs.f.length).toBe(6);
	});

	test('single-file category: parallel uploads, only one accepted', async () => {
		const a = define({ avatar: { code: 'AV', middlewares: [count(1)] } });
		const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => a.user(db.load(1)).avatar.add(file(`a${i}.txt`, 'x'), {})));
		expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
		for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(AttachmentValidationError);
		expect(db.store(1).avatar.f.length).toBe(1);
		expect((await filesOnDisk()).length).toBe(1);  // rejected uploads leave nothing
	});

	test('total size limit holds under parallel uploads', async () => {
		const a = define({ docs: { code: 'DC', middlewares: [sumSize(25)] } });
		await Promise.allSettled(Array.from({ length: 6 }, (_, i) => a.user(db.load(1)).docs.add(file(`f${i}.txt`, '0123456789'), {})));
		const total = db.store(1).docs.f.reduce((s, f) => s + f.s, 0);
		expect(total).toBeLessThanOrEqual(25);
		expect(db.store(1).docs.f.length).toBe(2);
		expect((await filesOnDisk()).length).toBe(2);
	});

	test('failed upload: no entry, and the name can be used again', async () => {
		const failing: StorageProvider = { ...provider, create: async () => { throw new Error('disk full'); } };
		const a = define({ docs: { code: 'DC' } }, { provider: failing });
		await expect(a.user(db.load(1)).docs.add(file('photo.txt', 'x'), {})).rejects.toThrow('disk full');
		expect(db.store(1).docs?.f ?? []).toEqual([]);

		const b = define({ docs: { code: 'DC' } });
		const ok = await b.user(db.load(1)).docs.add(file('photo.txt', 'y'), {});
		expect(ok.filename).toBe('photo.txt');
	});

	test('crash between upload and save: only an orphan file, removed by the next change', async () => {
		const a = define({ docs: { code: 'DC' } }, { orphanAge: 0 });
		await a.user(db.load(1)).docs.add(file('keep.txt', 'keep'), {});

		// Simulated crash: the file is created, but the save never happens.
		const groupId = db.store(1).docs.i;
		await provider.create!(`${groupId.slice(0, 2)}/${groupId}/orphan.txt`, file('orphan.txt', 'lost'));
		expect((await filesOnDisk()).length).toBe(2);
		expect(db.store(1).docs.f.map((f) => f.n)).toEqual(['keep.txt']);

		await delay(5);
		await a.user(db.load(1)).docs.add(file('next.txt', 'n'), {});
		const disk = await filesOnDisk();
		expect(disk.some((f) => f.endsWith('orphan.txt'))).toBe(false);
		expect(disk.length).toBe(2);
	});

	test('database fails after writing: the file is kept (listed), not deleted', async () => {
		const a = define({ docs: { code: 'DC' } });
		await a.user(db.load(1)).docs.add(file('first.txt', '1'), {});  // group exists
		db.failAfterSave();
		await expect(a.user(db.load(1)).docs.add(file('photo.txt', 'x'), {})).rejects.toThrow('connection lost');
		expect(db.store(1).docs.f.map((f) => f.n)).toContain('photo.txt');
		expect(await read(db.store(1).docs.i, 'photo.txt')).toBe('x');
	});

	test('orphans younger than orphanAge are kept (uploads in progress)', async () => {
		const a = define({ docs: { code: 'DC' } });  // default: one day
		await a.user(db.load(1)).docs.add(file('keep.txt', 'keep'), {});
		const groupId = db.store(1).docs.i;
		await provider.create!(`${groupId.slice(0, 2)}/${groupId}/inflight.txt`, file('inflight.txt', '...'));
		await a.user(db.load(1)).docs.add(file('next.txt', 'n'), {});
		expect((await filesOnDisk()).some((f) => f.endsWith('inflight.txt'))).toBe(true);
	});

	test('file deleted during replace: replace fails and leaves nothing', async () => {
		const a = define({ docs: { code: 'DC', middlewares: [slow(30)] } });
		await a.user(db.load(1)).docs.add(file('photo.txt', 'old'), {});
		const replacing = a.user(db.load(1)).docs.replace('photo.txt', file('photo.txt', 'new'), {});
		await delay(5);
		await a.user(db.load(1)).docs.delete('photo.txt');
		await expect(replacing).rejects.toBeInstanceOf(AttachmentValidationError);
		expect(db.store(1).docs.f).toEqual([]);
		expect(await filesOnDisk()).toEqual([]);
	});

	test('a deleted file does not come back (concurrent updateMeta)', async () => {
		const a = define({ docs: { code: 'DC' } });
		await a.user(db.load(1)).docs.add(file('photo.txt', 'x'), {});
		const results = await Promise.allSettled([
			a.user(db.load(1)).docs.updateMeta('photo.txt', { title: 'new' }),
			a.user(db.load(1)).docs.delete('photo.txt'),
		]);
		expect(results[1].status).toBe('fulfilled');
		expect(db.store(1).docs.f).toEqual([]);
	});

	test('concurrent replaces: one wins, the list matches the file', async () => {
		const a = define({ docs: { code: 'DC' } });
		await a.user(db.load(1)).docs.add(file('photo.txt', 'old'), {});
		const results = await Promise.allSettled([
			a.user(db.load(1)).docs.replace('photo.txt', file('photo.txt', 'AAAA'), {}),
			a.user(db.load(1)).docs.replace('photo.txt', file('photo.txt', 'BBBBBB'), {}),
		]);
		expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
		const store = db.store(1).docs;
		const content = await read(store.i, 'photo.txt');
		expect(store.f[0].s).toBe(content.length);
	});

	test('concurrent renames to the same name: one fails, no file lost', async () => {
		const a = define({ docs: { code: 'DC' } });
		await a.user(db.load(1)).docs.add(file('a.txt', 'A'), {});
		await a.user(db.load(1)).docs.add(file('b.txt', 'B'), {});
		const results = await Promise.allSettled([
			a.user(db.load(1)).docs.rename('a.txt', 'c.txt'),
			a.user(db.load(1)).docs.rename('b.txt', 'c.txt'),
		]);
		expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
		const store = db.store(1).docs;
		expect(store.f.map((f) => f.n).sort()).toHaveLength(2);
		for (const f of store.f) expect(await read(store.i, f.n)).toBeTruthy();
		expect((await filesOnDisk()).length).toBe(2);
	});

	test('updateMeta and reorder save themselves', async () => {
		const a = define({ docs: { code: 'DC' } });
		await a.user(db.load(1)).docs.add(file('a.txt', 'A'), {});
		await a.user(db.load(1)).docs.add(file('b.txt', 'B'), {});
		const entity = db.load(1);
		const updated = await a.user(entity).docs.updateMeta('a.txt', { title: 'x' });
		expect(updated.meta).toEqual({ title: 'x' });
		await a.user(entity).docs.reorder(['b.txt', 'a.txt']);
		expect(db.store(1).docs.f.map((f) => f.n)).toEqual(['b.txt', 'a.txt']);
		expect(a.user(entity).docs.list().map((f) => f.filename)).toEqual(['b.txt', 'a.txt']);  // entity refreshed
		await expect(a.user(db.load(1)).docs.reorder(['a.txt'])).rejects.toBeInstanceOf(AttachmentValidationError);
	});

	test('purge removes listed files and orphans', async () => {
		const a = define({ docs: { code: 'DC' }, other: { code: 'OT' } });
		await a.user(db.load(1)).docs.add(file('a.txt', 'A'), {});
		await a.user(db.load(1)).other.add(file('b.txt', 'B'), {});
		const groupId = db.store(1).docs.i;
		await provider.create!(`${groupId.slice(0, 2)}/${groupId}/orphan.txt`, file('orphan.txt', 'x'));
		await a.user(db.load(1)).purge();
		expect(await filesOnDisk()).toEqual([]);
	});

	test('the JSON format is unchanged', async () => {
		const a = define({ docs: { code: 'DC' } });
		await a.user(db.load(1)).docs.add(file('a.txt', 'A'), { k: 1 });
		const store = db.store(1).docs as unknown as Record<string, unknown>;
		expect(Object.keys(store).sort()).toEqual(['f', 'i', 'v']);
		expect(Object.keys((store.f as object[])[0]).sort()).toEqual(['n', 's', 't', 'v', 'x']);
	});

	test('a provider without the atomic capabilities is refused at startup', () => {
		const basic: StorageProvider = { ...provider, create: undefined, list: undefined };
		expect(() => define({ docs: { code: 'DC' } }, { provider: basic })).toThrow('create, list');
	});
});

describe('atomic mode — per entity', () => {
	test('entity option enables it only for that entity', async () => {
		db.insert(2);
		const a = defineAttachments({
			user:   defineAttachments.entity({ docs: { code: 'DC' } }, { atomic: db.atomic }),
			course: defineAttachments.entity({ cover: { code: 'CV' } }),
		}, { provider });
		const atomicDoc = await a.user(db.load(1)).docs.add(file('a.txt', 'A'), {});
		expect(atomicDoc.filename).toBe('a.txt');
		expect(db.store(1).docs.f.length).toBe(1);  // saved by the package

		const course = { id: 2, attachments: null } as { id: number; attachments: unknown };
		const classic = await a.course(course).cover.add(file('c.txt', 'C'), {});
		expect(typeof classic.rollback).toBe('function');
		expect(db.store(2)).toEqual({});  // classic mode: the app saves
	});
});
