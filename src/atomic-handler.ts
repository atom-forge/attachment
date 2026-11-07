import { AttachmentValidationError } from './types.js';
import type {
	AtomicFn,
	AttachmentData,
	AttachmentItem,
	CategoryStore,
	StorageProvider,
	UploadMiddleware,
} from './types.js';
import type { EventEmitter } from './events/types.js';
import { encodeEntityId, makeGroupId, parseGroupId, type EntityIdType } from './group-id.js';
import {
	asStore,
	assertSafeFilename,
	extensionOf,
	groupFolder,
	makeVersion,
	notFound,
	physicalPath,
	toPublic as toPublicItem,
	type AttachmentsStore,
	type EntityRecord,
} from './handler-utils.js';

// ---------------------------------------------------------------------------
// Atomic (conflict-safe) category handler
//
// Every change of the attachments column goes through the app's `atomic`
// function on a fresh copy of the column, so concurrent requests — in one
// process or in many — never overwrite each other's changes. Slow work
// (middlewares, uploads) runs outside it.
//
// Storage is the other half: files are created only where nothing exists yet
// (`create`, `copy`), and overwritten only if unchanged since read (`replaceIf`).
// The order is always: file first, then the list. A crash in between leaves at
// most a file that is not in the list; such orphans older than `orphanAge` are
// deleted after the next change of the same group.
// ---------------------------------------------------------------------------

export type AtomicCategoryHandler<TMeta = unknown> = {
	list(): AttachmentData<TMeta>[];
	get(filename: string): AttachmentData<TMeta> | undefined;
	add(file: File, meta: TMeta): Promise<AttachmentData<TMeta>>;
	replace(filename: string, file: File, meta: TMeta): Promise<AttachmentData<TMeta>>;
	updateMeta(filename: string, meta: TMeta): Promise<AttachmentData<TMeta>>;
	rename(oldName: string, newName: string): Promise<void>;
	delete(filename: string): Promise<void>;
	reorder(filenames: string[]): Promise<void>;
};

export type AtomicProvider = StorageProvider & Required<Pick<StorageProvider, 'create' | 'copy' | 'list' | 'etag' | 'replaceIf'>>;

const ATOMIC_METHODS = ['create', 'copy', 'list', 'etag', 'replaceIf'] as const;

export function assertAtomicProvider(provider: StorageProvider | undefined, where: string): void {
	if (!provider) return;  // reported on first use, like in classic mode
	const missing = ATOMIC_METHODS.filter((m) => typeof provider[m] !== 'function');
	if (missing.length) {
		throw new Error(`${where}: the "atomic" option needs a storage provider with ${missing.join(', ')}.`);
	}
}

export interface AtomicHandlerContext<TMeta> {
	entityType:  string;
	entityId:    string;
	category:    string;
	code:        string;
	idType:      EntityIdType;
	entity:      EntityRecord;
	middlewares: UploadMiddleware<TMeta>[];
	provider:    StorageProvider | undefined;
	atomic:      AtomicFn;
	orphanAge:   number;
	nextGroupId: (entityType: string, entityId: string, category: string) => Promise<string>;
	servePrefix: string;
	sanitizeFn:  ((name: string) => string) | false;
	findUnique:  (existing: string[], name: string) => string;
	eventManager: EventEmitter | undefined;
}

const MAX_NAME_ATTEMPTS = 100;

/**
 * The change itself refused to run (not found, limit, conflict), so nothing was written
 * and files of the operation can be removed at once. Other errors (e.g. the database
 * failed, maybe after writing) leave the files to the orphan sweep, which deletes them
 * only if they are really not listed.
 */
class Rejected {
	constructor(readonly error: unknown) {}
}

async function onRejected<T>(op: Promise<T>, cleanup: () => Promise<unknown>): Promise<T> {
	try {
		return await op;
	} catch (err) {
		if (!(err instanceof Rejected)) throw err;
		await cleanup().catch(() => {});
		throw err.error;
	}
}

async function unwrap<T>(op: Promise<T>): Promise<T> {
	try {
		return await op;
	} catch (err) {
		throw err instanceof Rejected ? err.error : err;
	}
}

export function makeAtomicCategoryHandler<TMeta>(c: AtomicHandlerContext<TMeta>): AtomicCategoryHandler<TMeta> {
	const { entityType, entityId, category, code, idType, entity, middlewares, servePrefix, eventManager } = c;

	const toPublic = (item: AttachmentItem, groupId: string) => toPublicItem<TMeta>(item, groupId, servePrefix);

	function requireProvider(): AtomicProvider {
		if (!c.provider) throw new Error('No StorageProvider configured.');
		return c.provider as AtomicProvider;
	}

	function snapshot(): CategoryStore | undefined {
		return asStore(entity.attachments)[category];
	}

	function encodedEntityId(): string {
		try {
			return encodeEntityId(entityId, idType);
		} catch (err) {
			throw new Error(
				`${entityType}.${category}: ${(err as Error).message} Attachments need a saved entity with an id of type "${idType}".`,
			);
		}
	}

	function assertWritableGroup(groupId: string): void {
		const parsed = parseGroupId(groupId);
		if (!parsed || parsed.code !== code || parsed.encodedId !== encodedEntityId()) {
			throw new AttachmentValidationError(
				`${entityType}.${category}: stored group id "${groupId}" does not belong to ${entityType} ${entityId} / ${code}.`,
			);
		}
	}

	/**
	 * Runs `change` on a fresh copy of the column through the app's atomic function and
	 * stores the saved value on the entity. `change` may run more than once (retries):
	 * it must not have side effects; its last return value is returned.
	 */
	async function commit<T>(change: (raw: AttachmentsStore) => T): Promise<T> {
		let result!: T;
		let rejection: unknown;
		try {
			const saved = await c.atomic({ entityType, entityId, entity }, (current) => {
				const raw = structuredClone(asStore(current));
				try {
					result = change(raw);
				} catch (err) {
					rejection = err;
					throw err;
				}
				return raw;
			});
			entity.attachments = saved;
			return result;
		} catch (err) {
			if (err !== rejection) throw err;
			throw new Rejected(err);
		}
	}

	/** Deletes files of the group that are not listed and older than `orphanAge`. Best effort. */
	async function sweep(groupId: string): Promise<void> {
		const p = requireProvider();
		try {
			const listed  = new Set((asStore(entity.attachments)[category]?.f ?? []).map((a) => a.n));
			const cutoff  = Date.now() - c.orphanAge * 1000;
			for (const file of await p.list(groupFolder(groupId))) {
				if (!listed.has(file.name) && file.modified < cutoff) {
					await p.delete(physicalPath(groupId, file.name)).catch(() => {});
				}
			}
		} catch {
			// cleanup must never fail the operation; the next change tries again
		}
	}

	/** The category's group id, created atomically on first use (one group per category). */
	async function ensureGroup(): Promise<string> {
		let groupId = snapshot()?.i;
		if (!groupId) {
			encodedEntityId();  // fail early with a clear message for unsaved entities
			const candidate = makeGroupId(await c.nextGroupId(entityType, entityId, category), code, entityId, idType);
			groupId = await unwrap(commit((raw) => {
				const existing = raw[category];
				if (existing?.i) return existing.i;
				raw[category] = { i: candidate, v: 0, f: [] };
				return candidate;
			}));
		}
		assertWritableGroup(groupId);
		return groupId;
	}

	function storeOf(raw: AttachmentsStore, groupId: string): CategoryStore {
		const store = raw[category];
		if (!store || store.i !== groupId) {
			throw new AttachmentValidationError(`${entityType}.${category}: the group changed during the operation.`);
		}
		return store;
	}

	async function runMiddlewares(file: File, meta: TMeta, files: AttachmentData<TMeta>[]) {
		let f = file, m = meta;
		for (const mw of middlewares) ({ file: f, meta: m } = await mw(f, m, files));
		return { file: f, meta: m };
	}

	function publicList(store: CategoryStore | undefined, except?: string): AttachmentData<TMeta>[] {
		return store ? store.f.filter((a) => a.n !== except).map((a) => toPublic(a, store.i)) : [];
	}

	return {
		list() {
			const store = snapshot();
			return store ? store.f.map((a) => toPublic(a, store.i)) : [];
		},

		get(filename) {
			const store = snapshot();
			const item  = store?.f.find((a) => a.n === filename);
			return store && item ? toPublic(item, store.i) : undefined;
		},

		async add(file, meta) {
			const p = requireProvider();
			const { file: f, meta: m } = await runMiddlewares(file, meta, publicList(snapshot()));
			const groupId = await ensureGroup();

			// The storage decides name conflicts: create() never overwrites.
			const rawName = c.sanitizeFn ? c.sanitizeFn(f.name) : f.name;
			const taken = (snapshot()?.f ?? []).map((a) => a.n);
			let filename: string | undefined;
			for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS && !filename; attempt++) {
				const candidate = c.findUnique(taken, rawName);
				assertSafeFilename(candidate, category);
				if (await p.create(physicalPath(groupId, candidate), f)) filename = candidate;
				else taken.push(candidate);
			}
			if (!filename) throw new Error(`${entityType}.${category}: no free filename for "${rawName}".`);
			const path = physicalPath(groupId, filename);

			const item = await onRejected(commit((raw) => {
				const store = storeOf(raw, groupId);
				if (store.f.some((a) => a.n === filename)) {
					throw new AttachmentValidationError(`File "${filename}" already exists in "${category}".`);
				}
				const files = publicList(store);
				for (const mw of middlewares) mw.check?.(f, files);
				const v = store.v + 1;
				const newItem: AttachmentItem = { n: filename!, v: makeVersion(v), s: f.size, t: Math.floor(Date.now() / 1000), x: m };
				raw[category] = { ...store, v, f: [...store.f, newItem] };
				return newItem;
			}), () => p.delete(path));

			await sweep(groupId);
			const attachment = toPublic(item, groupId);
			eventManager?.trigger({ type: 'attachment:add', entityType, entityId, category, groupId, attachment });
			return attachment;
		},

		async replace(filename, file, meta) {
			const p = requireProvider();
			const start = snapshot();
			if (!start?.f.some((a) => a.n === filename)) throw notFound(filename, category);
			const groupId = start.i;
			assertWritableGroup(groupId);

			const { file: f, meta: m } = await runMiddlewares(file, meta, publicList(start, filename));
			const newName = c.sanitizeFn ? c.sanitizeFn(f.name) : f.name;
			if (extensionOf(newName) !== extensionOf(filename)) {
				throw new AttachmentValidationError(
					`replace("${filename}") in "${category}": the processed file is "${newName}", its extension differs. Delete and add it instead.`,
				);
			}

			const path = physicalPath(groupId, filename);
			const etag = await p.etag(path);
			if (etag === null) throw notFound(filename, category);
			if (!(await p.replaceIf(path, f, etag))) {
				throw new AttachmentValidationError(`File "${filename}" in "${category}" was changed or deleted meanwhile.`);
			}

			// Rejected = deleted or renamed meanwhile: leave nothing behind.
			const result = await onRejected(commit((raw) => {
				const store = storeOf(raw, groupId);
				const idx = store.f.findIndex((a) => a.n === filename);
				if (idx === -1) throw notFound(filename, category);
				const v = store.v + 1;
				const item: AttachmentItem = { n: filename, v: makeVersion(v), s: f.size, t: Math.floor(Date.now() / 1000), x: m };
				const items = [...store.f];
				const oldItem = items[idx];
				items[idx] = item;
				raw[category] = { ...store, v, f: items };
				return { oldItem, item };
			}), () => p.delete(path));

			await sweep(groupId);
			const oldAttachment = toPublic(result.oldItem, groupId);
			const attachment    = toPublic(result.item, groupId);
			eventManager?.trigger({ type: 'attachment:replace', entityType, entityId, category, groupId, oldAttachment, attachment });
			return attachment;
		},

		async updateMeta(filename, meta) {
			const { item, groupId } = await unwrap(commit((raw) => {
				const store = raw[category];
				const idx = store?.f.findIndex((a) => a.n === filename) ?? -1;
				if (!store || idx === -1) throw notFound(filename, category);
				const v = store.v + 1;
				const item: AttachmentItem = { ...store.f[idx], v: makeVersion(v), x: meta };
				const items = [...store.f];
				items[idx] = item;
				raw[category] = { ...store, v, f: items };
				return { item, groupId: store.i };
			}));
			const attachment = toPublic(item, groupId);
			eventManager?.trigger({ type: 'attachment:meta-updated', entityType, entityId, category, groupId, attachment });
			return attachment;
		},

		async rename(oldName, newName) {
			const p = requireProvider();
			const start = snapshot();
			if (!start?.f.some((a) => a.n === oldName)) throw notFound(oldName, category);
			const groupId = start.i;
			assertWritableGroup(groupId);

			const sanitized = c.sanitizeFn ? c.sanitizeFn(newName) : newName;
			assertSafeFilename(sanitized, category);
			if (sanitized === oldName) return;
			if (start.f.some((a) => a.n === sanitized)) {
				throw new AttachmentValidationError(`File "${sanitized}" already exists in "${category}".`);
			}

			const oldPath = physicalPath(groupId, oldName);
			const newPath = physicalPath(groupId, sanitized);
			if (!(await p.copy(oldPath, newPath))) {
				throw new AttachmentValidationError(`File "${sanitized}" already exists in "${category}".`);
			}

			await onRejected(commit((raw) => {
				const store = storeOf(raw, groupId);
				if (!store.f.some((a) => a.n === oldName)) throw notFound(oldName, category);
				if (store.f.some((a) => a.n === sanitized)) {
					throw new AttachmentValidationError(`File "${sanitized}" already exists in "${category}".`);
				}
				raw[category] = { ...store, f: store.f.map((a) => (a.n === oldName ? { ...a, n: sanitized } : a)) };
			}), () => p.delete(newPath));

			await p.delete(oldPath).catch(() => {});  // left behind on failure: an orphan, swept later
			await sweep(groupId);
			eventManager?.trigger({ type: 'attachment:rename', entityType, entityId, category, groupId, oldName, newName: sanitized });
		},

		async delete(filename) {
			const p = requireProvider();
			const groupId = await unwrap(commit((raw) => {
				const store = raw[category];
				if (!store?.f.some((a) => a.n === filename)) throw notFound(filename, category);
				raw[category] = { ...store, f: store.f.filter((a) => a.n !== filename) };
				return store.i;
			}));
			await p.delete(physicalPath(groupId, filename)).catch(() => {});  // left behind on failure: an orphan, swept later
			await sweep(groupId);
			eventManager?.trigger({ type: 'attachment:delete', entityType, entityId, category, groupId, filename });
		},

		async reorder(filenames) {
			await unwrap(commit((raw) => {
				const store = raw[category];
				const items = store?.f ?? [];
				if (filenames.length !== items.length || new Set(filenames).size !== filenames.length) {
					throw new AttachmentValidationError(
						`reorder() in "${category}" needs every current filename exactly once (got ${filenames.length}, have ${items.length}).`,
					);
				}
				if (!store) return;
				const byName = new Map(items.map((a) => [a.n, a]));
				raw[category] = {
					...store,
					f: filenames.map((name) => {
						const a = byName.get(name);
						if (!a) throw notFound(name, category);
						return a;
					}),
				};
			}));
		},
	};
}
