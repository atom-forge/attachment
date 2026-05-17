import { AttachmentValidationError } from './types.js';
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

// --- Config types ---

export interface EntityOptions {
	idField?: string;
}

export interface EntityDefinition<TCategories extends Record<string, CategoryInput>> {
	_options: EntityOptions;
	categories: TCategories;
}

// url is now part of AttachmentData; this alias is kept for backward compatibility
export type AttachmentWithUrl<TMeta = unknown> = AttachmentData<TMeta>;

const defaultNextGroupId = async () => BigInt('0x' + crypto.randomUUID().replace(/-/g, '')).toString(36);

// --- Internal helpers ---

type AttachmentsStore = Record<string, CategoryStore>;
type EntityRecord = { attachments: unknown } & Record<string, unknown>;

export function physicalPath(groupId: string, filename: string): string {
	const shard = groupId.slice(0, 2);
	return `${shard}/${groupId}/${filename}`;
}

function serveUrl(prefix: string, groupId: string, version: string, filename: string): string {
	return `${prefix}/${groupId}-${version}/${filename}`;
}

function readStore(entity: EntityRecord): AttachmentsStore {
	const r = entity.attachments;
	return r && typeof r === 'object' && !Array.isArray(r) ? (r as AttachmentsStore) : {};
}

const defaultSanitize = (name: string): string =>
	name
		.normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove diacritics
		.replace(/[^a-zA-Z0-9_.]/g, '-')                   // non-alphanumeric → dash
		.replace(/(^[-.]+)|([-._]+)$/g, '')                // strip leading/trailing separators
		.replace(/-+/g, '-')                               // collapse dashes
		.replace(/\\.[-]/g, '.')                           // dot-dash → dot
		.replace(/[-.]\./g, '.');                          // dash/dot before dot → dot

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
): CategoryHandler<TMeta> {
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
		return {
			filename:   item.n,
			version:    item.v,
			groupId,
			size:       item.s,
			uploadedAt: item.t,
			meta:       item.x as TMeta,
			url:        serveUrl(servePrefix, groupId, item.v, item.n),
		};
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

		async add(file: File, meta: TMeta) {
			const p = requireProvider();
			const currentStore = getCategoryStore();
			const currentItems = getItems();
			const publicList = currentStore
				? currentItems.map((item) => toPublic(item, currentStore.i))
				: [];

			const { file: f, meta: m } = await runMiddlewares(file, meta, publicList);

			let groupId = currentStore?.i;
			if (!groupId) {
				groupId = await (nextGroupId ?? defaultNextGroupId)(entityType, entityId, category);
			}
			const vs = (currentStore?.v ?? 0) + 1;
			const version = vs.toString(36);
			const rawName = sanitizeFn ? sanitizeFn(f.name) : f.name;
			const filename = findUniqueFn(currentItems.map((a) => a.n), rawName);
			const path = physicalPath(groupId, filename);

			await p.save(path, f);

			const newItem: AttachmentItem = {
				n: filename,
				v: version,
				s: f.size,
				t: Math.floor(Date.now() / 1000),
				x: m,
			};
			const updatedStore: CategoryStore = {
				i: groupId,
				v: vs,
				f: [...(currentStore?.f ?? []), newItem],
			};
			const raw = readStore(entity);
			raw[category] = updatedStore;
			entity.attachments = raw;

			const attachment = toPublic(newItem, groupId);
			eventManager?.trigger({ type: 'attachment:add', entityType, entityId, category, groupId, attachment });
			return { attachment, rollback: () => p.delete(path) };
		},

		async replace(filename: string, file: File, meta: TMeta) {
			const p = requireProvider();
			const currentItems = getItems();
			const currentStore = getCategoryStore();
			const idx = currentItems.findIndex((a) => a.n === filename);
			if (idx === -1) throw new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
			if (!currentStore) throw new AttachmentValidationError(`Category "${category}" store is missing.`);

			const publicList = currentItems
				.filter((item) => item.n !== filename)
				.map((item) => toPublic(item, currentStore.i));
			const { file: f, meta: m } = await runMiddlewares(file, meta, publicList);

			const groupId = currentStore.i;
			const vs = currentStore.v + 1;
			const version = vs.toString(36);
			const path = physicalPath(groupId, filename);

			await p.save(path, f);

			const updatedItem: AttachmentItem = {
				n: filename,
				v: version,
				s: f.size,
				t: Math.floor(Date.now() / 1000),
				x: m,
			};
			const newItems = [...currentItems];
			newItems[idx] = updatedItem;
			const raw = readStore(entity);
			raw[category] = { ...currentStore, v: vs, f: newItems };
			entity.attachments = raw;

			const oldAttachment = toPublic(currentItems[idx], groupId);
			const attachment    = toPublic(updatedItem, groupId);
			eventManager?.trigger({ type: 'attachment:replace', entityType, entityId, category, groupId, oldAttachment, attachment });
			return { attachment, rollback: () => p.delete(path) };
		},

		updateMeta(filename: string, meta: TMeta): AttachmentData<TMeta> {
			const currentItems = getItems();
			const currentStore = getCategoryStore();
			const idx = currentItems.findIndex((a) => a.n === filename);
			if (idx === -1) throw new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
			if (!currentStore) throw new AttachmentValidationError(`Category "${category}" store is missing.`);

			const vs = currentStore.v + 1;
			const version = vs.toString(36);
			const updatedItem: AttachmentItem = { ...currentItems[idx], v: version, x: meta };
			const newItems = [...currentItems];
			newItems[idx] = updatedItem;
			const raw = readStore(entity);
			raw[category] = { ...currentStore, v: vs, f: newItems };
			entity.attachments = raw;
			const attachment = toPublic(updatedItem, currentStore.i);
			eventManager?.trigger({ type: 'attachment:meta-updated', entityType, entityId, category, groupId: currentStore.i, attachment });
			return attachment;
		},

		async rename(oldName: string, newName: string): Promise<void> {
			const p = requireProvider();
			const currentItems = getItems();
			const currentStore = getCategoryStore();
			const idx = currentItems.findIndex((a) => a.n === oldName);
			if (idx === -1) throw new AttachmentValidationError(`File "${oldName}" not found in "${category}".`);
			if (!currentStore) throw new AttachmentValidationError(`Category "${category}" store is missing.`);

			const sanitized = sanitizeFn ? sanitizeFn(newName) : newName;
			if (currentItems.some((a) => a.n === sanitized && a.n !== oldName)) {
				throw new AttachmentValidationError(`File "${sanitized}" already exists in "${category}".`);
			}

			const oldPath = physicalPath(currentStore.i, oldName);
			const newPath = physicalPath(currentStore.i, sanitized);
			await p.rename(oldPath, newPath);

			const updatedItem: AttachmentItem = { ...currentItems[idx], n: sanitized };
			const newItems = [...currentItems];
			newItems[idx] = updatedItem;
			setItems(newItems, currentStore);
			eventManager?.trigger({ type: 'attachment:rename', entityType, entityId, category, groupId: currentStore.i, oldName, newName: sanitized });
		},

		async delete(filename: string): Promise<void> {
			const p = requireProvider();
			const currentItems = getItems();
			const currentStore = getCategoryStore();
			const idx = currentItems.findIndex((a) => a.n === filename);
			if (idx === -1) throw new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
			if (!currentStore) throw new AttachmentValidationError(`Category "${category}" store is missing.`);

			await p.delete(physicalPath(currentStore.i, filename));
			setItems(currentItems.filter((_, i) => i !== idx), currentStore);
			eventManager?.trigger({ type: 'attachment:delete', entityType, entityId, category, groupId: currentStore.i, filename });
		},

		reorder(filenames: string[]): void {
			const currentItems = getItems();
			const currentStore = getCategoryStore();
			if (!currentStore) throw new AttachmentValidationError(`Category "${category}" store is missing.`);

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

function makeEntityHandler<TCategories extends Record<string, CategoryInput>>(
	entityType: string,
	entityDef: EntityDefinition<TCategories>,
	provider: StorageProvider | undefined,
	nextGroupId: DefineAttachmentsOptions['nextGroupId'] | undefined,
	servePrefix: string,
	sanitizeFn: ((name: string) => string) | false,
	findUniqueFn: (existing: string[], name: string) => string,
	eventManager: EventEmitter | undefined,
) {
	const idField = entityDef._options.idField ?? 'id';

	return function (entity: EntityRecord): AttachmentHandler<TCategories> {
		const entityId = String(entity[idField]);
		const result = {} as AttachmentHandler<TCategories>;

		for (const category of Object.keys(entityDef.categories) as (keyof TCategories & string)[]) {
			const input = entityDef.categories[category];
			const middlewares = Array.isArray(input) ? input : [];
			(result as Record<string, CategoryHandler>)[category] = makeCategoryHandler(
				entityType, entityId, category, middlewares, entity, provider, nextGroupId, servePrefix, sanitizeFn, findUniqueFn, eventManager,
			);
		}

		(result as unknown as { purge(): Promise<void> }).purge = async function (): Promise<void> {
			if (!provider) throw new Error('No StorageProvider configured.');
			const raw = readStore(entity);
			for (const store of Object.values(raw)) {
				for (const item of store.f) {
					await provider.delete(physicalPath(store.i, item.n));
				}
			}
			entity.attachments = {};
			eventManager?.trigger({ type: 'attachment:purge', entityType, entityId });
		};

		return result;
	};
}

// --- Factory ---

type DefineAttachmentsFn = {
	<TConfig extends Record<string, EntityDefinition<Record<string, CategoryInput>>>>(
		config: TConfig,
		options?: Partial<DefineAttachmentsOptions>,
	): { [K in keyof TConfig]: (entity: EntityRecord) => AttachmentHandler<TConfig[K]['categories']> };
	entity<TCategories extends Record<string, CategoryInput>>(
		categories: TCategories,
		options?: EntityOptions,
	): EntityDefinition<TCategories>;
};

export const defineAttachments: DefineAttachmentsFn = Object.assign(
	function defineAttachments<TConfig extends Record<string, EntityDefinition<Record<string, CategoryInput>>>>(
		config: TConfig,
		options?: Partial<DefineAttachmentsOptions>,
	): { [K in keyof TConfig]: (entity: EntityRecord) => AttachmentHandler<TConfig[K]['categories']> } {
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
		const result = {} as { [K in keyof TConfig]: (entity: EntityRecord) => AttachmentHandler<TConfig[K]['categories']> };

		for (const key of Object.keys(config) as (keyof TConfig & string)[]) {
			result[key] = makeEntityHandler(key, config[key], provider, nextGroupId, servePrefix, sanitizeFn, findUniqueFn, eventManager) as typeof result[typeof key];
		}

		return result;
	},
	{
		entity<TCategories extends Record<string, CategoryInput>>(
			categories: TCategories,
			options?: EntityOptions,
		): EntityDefinition<TCategories> {
			return { _options: options ?? {}, categories };
		},
	},
);
