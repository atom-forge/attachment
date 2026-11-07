import mime from 'mime';
import { AttachmentValidationError } from './types.js';
import {
	asStore,
	assertSafeFilename,
	extensionOf,
	makeVersion,
	physicalPath,
	toPublic as toPublicItem,
	type AttachmentsStore,
	type EntityRecord,
} from './handler-utils.js';

import type {
	AttachmentData,
	AttachmentItem,
	CategoryStore,
	DefineAttachmentsOptions,
	StorageProvider,
	UploadMiddleware,
	CategoryInput,
} from './types.js';
import type { EventEmitter } from './events/types.js';
import type { AtomicFn } from './types.js';
import { assertAtomicProvider, makeAtomicCategoryHandler, type AtomicCategoryHandler } from './atomic-handler.js';
import { groupFolder } from './handler-utils.js';
import {
	CATEGORY_REGISTRY,
	CODE_PATTERN,
	encodeEntityId,
	makeGroupId,
	parseGroupId,
	type CategoryRegistry,
	type EntityIdType,
} from './group-id.js';

export { physicalPath };

// --- Config types ---

export interface EntityOptions {
	idField?: string;
	/** How the entity id is encoded into group ids (base36). Default: 'int'. */
	idType?:  EntityIdType;
	/** Conflict-safe mode for this entity only (overrides the `defineAttachments` option). */
	atomic?:  AtomicFn;
}

export interface EntityDefinition<TCategories extends Record<string, CategoryInput>, TAtomic extends boolean = boolean> {
	_options: EntityOptions;
	categories: TCategories;
	/** Type-level marker: true when the entity has its own `atomic` function. */
	readonly _atomic?: TAtomic;
}

// url is now part of AttachmentData; this alias is kept for backward compatibility
export type AttachmentWithUrl<TMeta = unknown> = AttachmentData<TMeta>;

const defaultNextGroupId = async () => BigInt('0x' + crypto.randomUUID().replace(/-/g, '')).toString(36);

// --- Internal helpers ---

function readStore(entity: EntityRecord): AttachmentsStore {
	return asStore(entity.attachments);
}

// Stem and extension are cleaned separately, so a stem made only of non-ASCII
// characters ("фото.jpg") cannot swallow the extension dot. Never returns ''.
const defaultSanitize = (name: string): string => {
	const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');  // remove diacritics
	const dot   = ascii.lastIndexOf('.');
	const stem = (dot >= 0 ? ascii.slice(0, dot) : ascii)
		.replace(/[^a-zA-Z0-9_.]/g, '-')   // other characters → dash
		.replace(/-+/g, '-')               // collapse dashes
		.replace(/[-.]*\.[-.]*/g, '.')     // dots with dashes around → one dot
		.replace(/^[-._]+|[-._]+$/g, '')   // strip leading/trailing separators
		|| 'file';
	const ext = dot >= 0 ? ascii.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '') : '';
	return ext ? `${stem}.${ext}` : stem;
};

const defaultFindUnique = (existing: string[], name: string): string => {
	if (!existing.includes(name)) return name;
	const dot     = name.lastIndexOf('.');
	const base    = dot >= 0 ? name.slice(0, dot) : name;
	const extPart = dot >= 0 ? name.slice(dot) : '';
	for (let i = 1; ; i++) {
		const candidate = `${base}(${i})${extPart}`;
		if (!existing.includes(candidate)) return candidate;
	}
};

function assertCategoryConfig(input: unknown, where: string): asserts input is CategoryInput {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error(`${where}: a category must be an object like { code: 'AV', middlewares: [...] }.`);
	}
	const code = (input as { code?: unknown }).code;
	if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
		throw new Error(`${where}: code ${JSON.stringify(code)} must be exactly two characters [A-Z0-9].`);
	}
}

// Async mutations of one entity object run one after another, so a call never
// works from a store snapshot that another call is about to overwrite.
const entityLocks = new WeakMap<object, Promise<unknown>>();

function serialize<T>(entity: object, fn: () => Promise<T>): Promise<T> {
	const previous = entityLocks.get(entity) ?? Promise.resolve();
	const run = previous.then(fn, fn);
	entityLocks.set(entity, run.catch(() => {}));
	return run;
}

// --- Category handler ---

export type CategoryHandler<TMeta = unknown> = {
	list(): AttachmentData<TMeta>[];
	get(filename: string): AttachmentData<TMeta> | undefined;
	add(file: File, meta: TMeta): Promise<{ attachment: AttachmentData<TMeta>; rollback: () => Promise<void> }>;
	replace(filename: string, file: File, meta: TMeta): Promise<{ attachment: AttachmentData<TMeta>; rollback: () => Promise<void> }>;
	updateMeta(filename: string, meta: TMeta): AttachmentData<TMeta>;
	rename(oldName: string, newName: string): Promise<void>;
	delete(filename: string): Promise<void>;
	reorder(filenames: string[]): void;
};

function makeCategoryHandler<TMeta>(
	entityType: string,
	entityId: string,
	category: string,
	middlewares: UploadMiddleware<TMeta>[],
	entity: EntityRecord,
	provider: StorageProvider | undefined,
	nextGroupId: DefineAttachmentsOptions['nextGroupId'] | undefined,
	servePrefix: string,
	sanitizeFn: ((name: string) => string) | false,
	findUniqueFn: (existing: string[], name: string) => string,
	eventManager: EventEmitter | undefined,
	code: string,
	idType: EntityIdType,
): CategoryHandler<TMeta> {
	function encodedEntityId(): string {
		try {
			return encodeEntityId(entityId, idType);
		} catch (err) {
			throw new Error(
				`${entityType}.${category}: ${(err as Error).message} Attachments need a saved entity with an id of type "${idType}".`,
			);
		}
	}

	// The stored group id must be the composite key of THIS entity and category.
	// Legacy group ids (without code and entity id) are not supported.
	function assertWritableGroup(groupId: string): void {
		const parsed = parseGroupId(groupId);
		if (!parsed || parsed.code !== code || parsed.encodedId !== encodedEntityId()) {
			throw new AttachmentValidationError(
				`${entityType}.${category}: stored group id "${groupId}" does not belong to ${entityType} ${entityId} / ${code}.`,
			);
		}
	}

	function getCategoryStore(): CategoryStore | undefined {
		return readStore(entity)[category];
	}

	function getItems(): AttachmentItem[] {
		return getCategoryStore()?.f ?? [];
	}

	function setItems(items: AttachmentItem[], store: CategoryStore): void {
		const raw = readStore(entity);
		raw[category] = { ...store, f: items };
		entity.attachments = raw;
	}

	function toPublic(item: AttachmentItem, groupId: string): AttachmentData<TMeta> {
		return toPublicItem<TMeta>(item, groupId, servePrefix);
	}

	function requireProvider(): StorageProvider {
		if (!provider) throw new Error('No StorageProvider configured.');
		return provider;
	}

	async function runMiddlewares(file: File, meta: TMeta, files: AttachmentData<TMeta>[]): Promise<{ file: File; meta: TMeta }> {
		let f = file, m = meta;
		for (const mw of middlewares) {
			({ file: f, meta: m } = await mw(f, m, files));
		}
		return { file: f, meta: m };
	}

	return {
		list(): AttachmentData<TMeta>[] {
			const store = getCategoryStore();
			if (!store) return [];
			return getItems().map((item) => toPublic(item, store.i));
		},

		get(filename: string): AttachmentData<TMeta> | undefined {
			const store = getCategoryStore();
			if (!store) return undefined;
			const item = getItems().find((a) => a.n === filename);
			return item ? toPublic(item, store.i) : undefined;
		},

		add(file: File, meta: TMeta) {
			return serialize(entity, async () => {
				const p = requireProvider();
				const startStore = getCategoryStore();
				const publicList = startStore
					? startStore.f.map((item) => toPublic(item, startStore.i))
					: [];

				const { file: f, meta: m } = await runMiddlewares(file, meta, publicList);

				let groupId = getCategoryStore()?.i;
				if (!groupId) {
					encodedEntityId();  // fail early with a clear message for unsaved entities
					groupId = makeGroupId(await (nextGroupId ?? defaultNextGroupId)(entityType, entityId, category), code, entityId, idType);
				}
				assertWritableGroup(groupId);
				const rawName = sanitizeFn ? sanitizeFn(f.name) : f.name;
				const filename = findUniqueFn(getItems().map((a) => a.n), rawName);
				assertSafeFilename(filename, category);
				const path = physicalPath(groupId, filename);

				await p.save(path, f);

				// Re-read: synchronous calls (updateMeta, reorder) may have changed the store meanwhile.
				const fresh = getCategoryStore();
				const vs = (fresh?.v ?? 0) + 1;
				const newItem: AttachmentItem = {
					n: filename,
					v: makeVersion(vs),
					s: f.size,
					t: Math.floor(Date.now() / 1000),
					x: m,
				};
				const raw = readStore(entity);
				raw[category] = { i: groupId, v: vs, f: [...(fresh?.f ?? []), newItem] };
				entity.attachments = raw;

				const attachment = toPublic(newItem, groupId);
				eventManager?.trigger({ type: 'attachment:add', entityType, entityId, category, groupId, attachment });
				return { attachment, rollback: () => p.delete(path) };
			});
		},

		replace(filename: string, file: File, meta: TMeta) {
			return serialize(entity, async () => {
				const p = requireProvider();
				const startStore = getCategoryStore();
				if (!startStore) throw new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
				if (!startStore.f.some((a) => a.n === filename)) {
					throw new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
				}

				const publicList = startStore.f
					.filter((item) => item.n !== filename)
					.map((item) => toPublic(item, startStore.i));
				const { file: f, meta: m } = await runMiddlewares(file, meta, publicList);
				// replace() keeps the stored filename, so the content must keep its type too
				// (e.g. toWebP() turns an upload into .webp: replacing "a.jpg" with WebP bytes would mislabel it).
				const newName = sanitizeFn ? sanitizeFn(f.name) : f.name;
				if (extensionOf(newName) !== extensionOf(filename)) {
					throw new AttachmentValidationError(
						`replace("${filename}") in "${category}": the processed file is "${newName}", its extension differs. Delete and add it instead.`,
					);
				}

				const groupId = startStore.i;
				assertWritableGroup(groupId);
				const path = physicalPath(groupId, filename);

				// Keep the original bytes so rollback can put them back (replace overwrites in place).
				let original: Buffer | undefined;
				try {
					original = await p.read(path);
				} catch {
					original = undefined;  // original file already missing: rollback just removes the new one
				}
				const restore = async () => {
					if (!original) return p.delete(path);
					const type = mime.getType(filename) ?? 'application/octet-stream';
					await p.save(path, new File([new Uint8Array(original)], filename, { type }));
				};

				try {
					await p.save(path, f);
				} catch (err) {
					await restore().catch(() => {});
					throw err;
				}

				// Re-read: synchronous calls (updateMeta, reorder) may have changed the store meanwhile.
				const fresh = getCategoryStore() ?? startStore;
				const idx = fresh.f.findIndex((a) => a.n === filename);
				if (idx === -1) {
					await restore().catch(() => {});
					throw new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
				}
				const vs = fresh.v + 1;
				const updatedItem: AttachmentItem = {
					n: filename,
					v: makeVersion(vs),
					s: f.size,
					t: Math.floor(Date.now() / 1000),
					x: m,
				};
				const newItems = [...fresh.f];
				const oldItem = newItems[idx];
				newItems[idx] = updatedItem;
				const raw = readStore(entity);
				raw[category] = { ...fresh, v: vs, f: newItems };
				entity.attachments = raw;

				const oldAttachment = toPublic(oldItem, groupId);
				const attachment    = toPublic(updatedItem, groupId);
				eventManager?.trigger({ type: 'attachment:replace', entityType, entityId, category, groupId, oldAttachment, attachment });
				return { attachment, rollback: restore };
			});
		},

		updateMeta(filename: string, meta: TMeta): AttachmentData<TMeta> {
			const currentItems = getItems();
			const currentStore = getCategoryStore();
			const idx = currentItems.findIndex((a) => a.n === filename);
			if (idx === -1) throw new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
			if (!currentStore) throw new AttachmentValidationError(`Category "${category}" store is missing.`);

			const vs = currentStore.v + 1;
			const updatedItem: AttachmentItem = { ...currentItems[idx], v: makeVersion(vs), x: meta };
			const newItems = [...currentItems];
			newItems[idx] = updatedItem;
			const raw = readStore(entity);
			raw[category] = { ...currentStore, v: vs, f: newItems };
			entity.attachments = raw;
			const attachment = toPublic(updatedItem, currentStore.i);
			eventManager?.trigger({ type: 'attachment:meta-updated', entityType, entityId, category, groupId: currentStore.i, attachment });
			return attachment;
		},

		rename(oldName: string, newName: string): Promise<void> {
			return serialize(entity, async () => {
				const p = requireProvider();
				const currentStore = getCategoryStore();
				if (!currentStore || !currentStore.f.some((a) => a.n === oldName)) {
					throw new AttachmentValidationError(`File "${oldName}" not found in "${category}".`);
				}

				const sanitized = sanitizeFn ? sanitizeFn(newName) : newName;
				assertSafeFilename(sanitized, category);
				if (currentStore.f.some((a) => a.n === sanitized && a.n !== oldName)) {
					throw new AttachmentValidationError(`File "${sanitized}" already exists in "${category}".`);
				}

				await p.rename(physicalPath(currentStore.i, oldName), physicalPath(currentStore.i, sanitized));

				// Re-read: synchronous calls (updateMeta, reorder) may have changed the store meanwhile.
				const fresh = getCategoryStore() ?? currentStore;
				setItems(fresh.f.map((a) => (a.n === oldName ? { ...a, n: sanitized } : a)), fresh);
				eventManager?.trigger({ type: 'attachment:rename', entityType, entityId, category, groupId: fresh.i, oldName, newName: sanitized });
			});
		},

		delete(filename: string): Promise<void> {
			return serialize(entity, async () => {
				const p = requireProvider();
				const currentStore = getCategoryStore();
				if (!currentStore || !currentStore.f.some((a) => a.n === filename)) {
					throw new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
				}

				await p.delete(physicalPath(currentStore.i, filename));

				const fresh = getCategoryStore() ?? currentStore;
				setItems(fresh.f.filter((a) => a.n !== filename), fresh);
				eventManager?.trigger({ type: 'attachment:delete', entityType, entityId, category, groupId: fresh.i, filename });
			});
		},

		reorder(filenames: string[]): void {
			const currentItems = getItems();
			const currentStore = getCategoryStore();
			if (!currentStore) throw new AttachmentValidationError(`Category "${category}" store is missing.`);

			if (filenames.length !== currentItems.length || new Set(filenames).size !== filenames.length) {
				throw new AttachmentValidationError(
					`reorder() in "${category}" needs every current filename exactly once (got ${filenames.length}, have ${currentItems.length}).`,
				);
			}
			const byName = new Map(currentItems.map((a) => [a.n, a]));
			const reordered = filenames.map((name) => {
				const a = byName.get(name);
				if (!a) throw new AttachmentValidationError(`File "${name}" not found in "${category}".`);
				return a;
			});
			setItems(reordered, currentStore);
		},
	};
}

// --- Entity handler type ---

export type AttachmentHandler<TCategories extends Record<string, CategoryInput>> = {
	[K in keyof TCategories]: CategoryHandler;
} & {
	purge(): Promise<void>;
};

/** Handler of an entity in atomic mode: changes save themselves, there is no rollback. */
export type AtomicAttachmentHandler<TCategories extends Record<string, CategoryInput>> = {
	[K in keyof TCategories]: AtomicCategoryHandler;
} & {
	purge(): Promise<void>;
};

type HasAtomic<O> = O extends { atomic: AtomicFn } ? true : false;

type HandlerOf<D, O> =
	D extends EntityDefinition<infer C, infer A>
		? [A] extends [true] ? AtomicAttachmentHandler<C>
		: HasAtomic<O> extends true ? AtomicAttachmentHandler<C>
		: AttachmentHandler<C>
		: never;

export type AttachmentsModule<TConfig, O = {}> = {
	[K in keyof TConfig]: (entity: EntityRecord) => HandlerOf<TConfig[K], O>;
};

function makeEntityHandler<TCategories extends Record<string, CategoryInput>>(
	entityType: string,
	entityDef: EntityDefinition<TCategories>,
	provider: StorageProvider | undefined,
	nextGroupId: DefineAttachmentsOptions['nextGroupId'] | undefined,
	servePrefix: string,
	sanitizeFn: ((name: string) => string) | false,
	findUniqueFn: (existing: string[], name: string) => string,
	eventManager: EventEmitter | undefined,
	atomic: AtomicFn | undefined,
	orphanAge: number,
) {
	const idField = entityDef._options.idField ?? 'id';
	const idType  = entityDef._options.idType ?? 'int';
	const categories = entityDef.categories as Record<string, CategoryInput>;
	const providerFor = (category: string) => categories[category]?.provider ?? provider;

	return function (entity: EntityRecord): AttachmentHandler<TCategories> {
		const entityId = String(entity[idField]);
		const result = {} as AttachmentHandler<TCategories>;

		for (const category of Object.keys(categories)) {
			const config = categories[category];
			(result as Record<string, unknown>)[category] = atomic
				? makeAtomicCategoryHandler({
					entityType, entityId, category, code: config.code, idType, entity,
					middlewares: config.middlewares ?? [], provider: providerFor(category), atomic, orphanAge,
					nextGroupId: nextGroupId ?? defaultNextGroupId, servePrefix, sanitizeFn, findUnique: findUniqueFn, eventManager,
				})
				: makeCategoryHandler(
					entityType, entityId, category, config.middlewares ?? [], entity, providerFor(category), nextGroupId, servePrefix, sanitizeFn, findUniqueFn, eventManager, config.code, idType,
				);
		}

		(result as unknown as { purge(): Promise<void> }).purge = () => serialize(entity, async (): Promise<void> => {
			const raw = readStore(entity);
			// Best effort: try every file, keep only the stores whose files could not be deleted.
			const failed: Record<string, CategoryStore> = {};
			const errors: unknown[] = [];
			for (const [category, store] of Object.entries(raw)) {
				const p = providerFor(category);
				const left: AttachmentItem[] = [];
				for (const item of store.f) {
					try {
						if (!p) throw new Error('No StorageProvider configured.');
						await p.delete(physicalPath(store.i, item.n));
					} catch (err) {
						left.push(item);
						errors.push(err);
					}
				}
				// Atomic mode: the folder may also hold orphans (crashed uploads); the entity is gone, so all of it goes.
				if (atomic && p?.list && !left.length) {
					try {
						for (const file of await p.list(groupFolder(store.i))) {
							await p.delete(physicalPath(store.i, file.name)).catch(() => {});
						}
					} catch {
						// best effort
					}
				}
				if (left.length) failed[category] = { ...store, f: left };
			}
			entity.attachments = failed;
			if (errors.length) {
				const error = new Error(`purge(): ${errors.length} file(s) could not be deleted; they are kept in entity.attachments.`);
				(error as Error & { errors: unknown[] }).errors = errors;
				throw error;
			}
			eventManager?.trigger({ type: 'attachment:purge', entityType, entityId });
		});

		return result;
	};
}

// --- Factory ---

type DefineAttachmentsFn = {
	<TConfig extends Record<string, EntityDefinition<Record<string, CategoryInput>>>, O extends Partial<DefineAttachmentsOptions> = {}>(
		config: TConfig,
		options?: O,
	): AttachmentsModule<TConfig, O>;
	entity<TCategories extends Record<string, CategoryInput>, O extends EntityOptions = {}>(
		categories: TCategories,
		options?: O,
	): EntityDefinition<TCategories, HasAtomic<O>>;
};

export const defineAttachments: DefineAttachmentsFn = Object.assign(
	function defineAttachments<TConfig extends Record<string, EntityDefinition<Record<string, CategoryInput>>>, O extends Partial<DefineAttachmentsOptions> = {}>(
		config: TConfig,
		options?: O,
	): AttachmentsModule<TConfig, O> {
		const provider     = options?.provider;
		const nextGroupId  = options?.nextGroupId;
		const servePrefix  = options?.servePrefix ?? '/file';
		const sanitizeOpt  = options?.sanitize;
		const sanitizeFn: ((name: string) => string) | false =
			sanitizeOpt === false ? false :
			typeof sanitizeOpt === 'function' ? sanitizeOpt :
			defaultSanitize;
		const findUniqueFn  = options?.findUnique ?? defaultFindUnique;
		const eventManager  = options?.eventManager;
		if (provider && eventManager) provider.setEventManager?.(eventManager);
		const orphanAge     = options?.orphanAge ?? 86400;
		const result = {} as Record<string, unknown>;

		const registry: CategoryRegistry = new Map();
		for (const [entityType, def] of Object.entries(config)) {
			for (const [category, input] of Object.entries(def.categories)) {
				const where = `${entityType}.${category}`;
				assertCategoryConfig(input, where);
				const existing = registry.get(input.code);
				if (existing) {
					throw new Error(`${where}: code "${input.code}" is already used by ${existing.entityType}.${existing.category}.`);
				}
				if (input.provider && eventManager) input.provider.setEventManager?.(eventManager);
				if (def._options.atomic ?? options?.atomic) assertAtomicProvider(input.provider ?? provider, where);
				registry.set(input.code, {
					entityType,
					category,
					code:      input.code,
					idType:    def._options.idType ?? 'int',
					authorize: input.authorize,
					provider:  input.provider ?? provider,
				});
			}
		}

		for (const key of Object.keys(config)) {
			const def = config[key];
			result[key] = makeEntityHandler(key, def, provider, nextGroupId, servePrefix, sanitizeFn, findUniqueFn, eventManager, def._options.atomic ?? options?.atomic, orphanAge);
		}

		Object.defineProperty(result, CATEGORY_REGISTRY, { value: registry, enumerable: false });
		return result as AttachmentsModule<TConfig, O>;
	},
	{
		entity<TCategories extends Record<string, CategoryInput>, O extends EntityOptions = {}>(
			categories: TCategories,
			options?: O,
		): EntityDefinition<TCategories, HasAtomic<O>> {
			return { _options: options ?? {}, categories };
		},
	},
);
