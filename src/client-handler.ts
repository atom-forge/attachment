import type { ImageVariantMap, Density, AttachmentData, ImgStat } from './types.js';
import { buildImageUrl } from './image/image-url.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ImgVariants<V extends ImageVariantMap> = {
	[K in keyof V]: (density?: Density, mode?: 'e' | 'a' | 'c' | 'b') => string;
};

export type ItemView<V extends ImageVariantMap> = {
	filename: string;
	url:      string;
	meta:     unknown;
	img:      ImgVariants<V>;
};

export type CategoryView<V extends ImageVariantMap> = {
	all:   ItemView<V>[];
	first: ItemView<V> | undefined;
	last:  ItemView<V> | undefined;
	find:  (pattern: string) => ItemView<V>[];
};

// ---------------------------------------------------------------------------
// Type helpers to extract entity/category names from an AttachmentsModule
// ---------------------------------------------------------------------------

type EntityFn = (entity: { attachments: unknown } & Record<string, unknown>) => Record<string, unknown>;

type CategoriesOf<F extends EntityFn> =
	F extends (entity: any) => infer H
		? Exclude<keyof H, 'purge'>
		: never;

export type AttachmentHandlerFor<M extends Record<string, EntityFn>, V extends ImageVariantMap> = {
	[Entity in keyof M]: (entity: { attachments: unknown } & Record<string, unknown>) => {
		[Category in CategoriesOf<M[Entity]>]: CategoryView<V>;
	};
};

// ---------------------------------------------------------------------------
// Internal raw storage types (mirrors CategoryStore from define-attachments.ts)
// ---------------------------------------------------------------------------

type RawItem = { n: string; v: string; s: number; t: number; x: unknown };
type RawCategoryStore = { i: string; v: number; f: RawItem[] };
type RawAttachments = Record<string, RawCategoryStore>;

function parseAttachments(entity: Record<string, unknown>): RawAttachments {
	const r = entity['attachments'];
	return r && typeof r === 'object' && !Array.isArray(r) ? (r as RawAttachments) : {};
}

function matchesGlob(name: string, pattern: string): boolean {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	return new RegExp(`^${escaped}$`).test(name);
}

function makeImgVariants<V extends ImageVariantMap>(
	attachment: AttachmentData<{ img: ImgStat }>,
	variants: V,
	thumbPrefix: string,
): ImgVariants<V> {
	const img = {} as ImgVariants<V>;
	for (const [key, def] of Object.entries(variants) as [keyof V & string, V[keyof V]][]) {
		(img as Record<string, unknown>)[key] = (density: Density = 1, mode?: 'e' | 'a' | 'c' | 'b') => {
			const w = Math.round((def.w ?? 0) * density);
			const h = Math.round((def.h ?? 0) * density);
			const storedMode = (attachment.meta as { img?: ImgStat } | null)?.img?.c;
			const resolvedMode: 'e' | 'a' | 'c' | 'b' = mode ?? (typeof storedMode === 'string' ? storedMode : undefined) ?? 'e';
			return buildImageUrl(attachment, w, h, resolvedMode, thumbPrefix);
		};
	}
	return img;
}

function makeItemView<V extends ImageVariantMap>(
	item: RawItem,
	groupId: string,
	variants: V,
	servePrefix: string,
	thumbPrefix: string,
): ItemView<V> {
	const url = `${servePrefix}/${groupId}-${item.v}/${item.n}`;
	const attachment: AttachmentData<{ img: ImgStat }> = {
		filename:   item.n,
		version:    item.v,
		groupId,
		size:       item.s,
		uploadedAt: item.t,
		meta:       item.x as { img: ImgStat },
		url,
	};
	return { filename: item.n, url, meta: item.x, img: makeImgVariants(attachment, variants, thumbPrefix) };
}

function makeCategoryView<V extends ImageVariantMap>(
	store: RawCategoryStore | undefined,
	variants: V,
	servePrefix: string,
	thumbPrefix: string,
): CategoryView<V> {
	const items = store?.f ?? [];
	const groupId = store?.i ?? '';
	const all = items.map((item) => makeItemView(item, groupId, variants, servePrefix, thumbPrefix));
	return {
		all,
		get first() { return all[0]; },
		get last()  { return all[all.length - 1]; },
		find(pattern: string) {
			return all.filter((v, i) => matchesGlob(items[i].n, pattern));
		},
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type AttachmentHandlerOptions = {
	servePrefix?: string;   // default: '/file'
	thumbPrefix?: string;   // default: '/img'
};

export function makeAttachmentHandler<M extends Record<string, EntityFn>, V extends ImageVariantMap>(
	variants: V,
	options?: AttachmentHandlerOptions,
): AttachmentHandlerFor<M, V> {
	const servePrefix = options?.servePrefix ?? '/file';
	const thumbPrefix = options?.thumbPrefix ?? '/img';

	return new Proxy({} as AttachmentHandlerFor<M, V>, {
		get(_target, entityProp) {
			if (typeof entityProp !== 'string') return undefined;
			return (entity: Record<string, unknown>) => {
				const raw = parseAttachments(entity);
				return new Proxy({} as Record<string, CategoryView<V>>, {
					get(_t, catProp) {
						if (typeof catProp !== 'string') return undefined;
						return makeCategoryView(raw[catProp], variants, servePrefix, thumbPrefix);
					},
				});
			};
		},
	});
}
