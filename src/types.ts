// ---------------------------------------------------------------------------
// Image variant types
// ---------------------------------------------------------------------------

export type ImageVariantDef = { w?: number; h?: number };
export type ImageVariantMap = Record<string, ImageVariantDef>;
export type Density = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Internal JSON storage types (short keys — stored in entity.attachments JSON)
// ---------------------------------------------------------------------------

export interface AttachmentItem {
	n: string;   // filename
	v: string;   // version (base36)
	s: number;   // size (bytes)
	t: number;   // uploadedAt (Unix epoch)
	x: unknown;  // meta (caller-supplied)
}

export interface CategoryStore {
	i:  string;            // groupId (base36, from AttachmentGroup.id)
	v:  number;            // version sequence counter (monotonically increasing)
	f:  AttachmentItem[];  // items
}

// ---------------------------------------------------------------------------
// Public API type (returned by factory methods — human-friendly field names)
// ---------------------------------------------------------------------------

export interface AttachmentData<TMeta = unknown> {
	filename:   string;
	version:    string;  // base36
	groupId:    string;  // base36
	size:       number;
	uploadedAt: number;  // Unix epoch
	meta:       TMeta;
	url:        string;  // computed on read, not stored
}

// ---------------------------------------------------------------------------
// Storage provider interface
// ---------------------------------------------------------------------------

export interface StorageProvider {
	save(path: string, file: File): Promise<void>;
	read(path: string): Promise<Buffer>;
	stream(path: string): ReadableStream<Uint8Array>;
	delete(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	rename(oldPath: string, newPath: string): Promise<void>;
	setEventManager?(em: import('./events/types.js').EventEmitter): void;

	// --- Needed only with the `atomic` option (conflict-safe mode) ---

	/** Saves the file only if nothing exists at `path` yet; `false` when it already exists. */
	create?(path: string, file: File): Promise<boolean>;
	/** Copies `from` to `to` only if nothing exists at `to` yet; `false` when it already exists. */
	copy?(from: string, to: string): Promise<boolean>;
	/** Files directly in a folder (`{shard}/{groupId}`); empty when the folder does not exist. */
	list?(folder: string): Promise<StoredFile[]>;
	/** Opaque token of the file's current content (e.g. S3 ETag); `null` when the file does not exist. */
	etag?(path: string): Promise<string | null>;
	/** Overwrites the file only if its current token is still `etag`; `false` otherwise (changed or deleted). */
	replaceIf?(path: string, file: File, etag: string): Promise<boolean>;
}

export interface StoredFile {
	name:     string;
	/** Last modification time (ms since epoch). */
	modified: number;
}

// ---------------------------------------------------------------------------
// Atomic (conflict-safe) mode
// ---------------------------------------------------------------------------

export interface AtomicContext {
	entityType: string;
	entityId:   string;
	entity:     Record<string, unknown>;
}

/**
 * Atomically updates the entity's `attachments` column: read the current value,
 * pass it to `mutate`, write the result and return it — without another write
 * in between (row lock in a transaction, or compare-and-set with retry).
 * `mutate` is pure and synchronous and may be called more than once; when it
 * throws, nothing must be written and the error must propagate.
 */
export type AtomicFn = (ctx: AtomicContext, mutate: (current: unknown) => unknown) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface DefineAttachmentsOptions {
	provider:      StorageProvider;
	nextGroupId?:  (entityType: string, entityId: string, category: string) => Promise<string>;
	servePrefix?:  string;                                       // URL prefix for generated file URLs, default: '/file'
	sanitize?:     false | true | ((name: string) => string);   // filename sanitization, default: true (built-in)
	findUnique?:   (existing: string[], name: string) => string; // collision resolution for add(), default: base(n)ext
	eventManager?: import('./events/types.js').EventEmitter;
	/** Conflict-safe mode: the package saves every change itself through this function. */
	atomic?:       AtomicFn;
	/** Atomic mode: a file in a group folder that is not listed and older than this (seconds) is an orphan and gets deleted. Default: 86400. */
	orphanAge?:    number;
}

// ---------------------------------------------------------------------------
// Image metadata types (used by imgstat middleware)
// ---------------------------------------------------------------------------

export interface Focus {
	x: number;
	y: number;
	s: { x: number; y: number; w: number; h: number };
}

export type FocusHashFn = (encodedFocus: string) => string;

export function encodeFocus(focus: Focus): string {
	const vals = [focus.x, focus.y, focus.s.x, focus.s.y, focus.s.w, focus.s.h];
	return vals.map((v) => Math.round(v).toString(36).padStart(2, '0')).join('');
}

export function decodeFocus(s: string): Focus {
	const parse = (chunk: string) => parseInt(chunk, 36);
	return {
		x: parse(s.slice(0, 2)),
		y: parse(s.slice(2, 4)),
		s: {
			x: parse(s.slice(4, 6)),
			y: parse(s.slice(6, 8)),
			w: parse(s.slice(8, 10)),
			h: parse(s.slice(10, 12)),
		},
	};
}

export interface ImgStat {
	w: number;                    // width
	h: number;                    // height
	d: string;                    // dominant color hex (#rrggbb)
	a: boolean;                   // animated (pages > 1)
	c: 'e' | 'a' | 'c' | 'b' | Focus;  // crop mode: entropy | attention | center | box | focus point
	ch?: string;                  // pre-computed focus hash (manual focus only)
}

// ---------------------------------------------------------------------------
// Errors & middleware types
// ---------------------------------------------------------------------------

export class AttachmentValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AttachmentValidationError';
	}
}

export type UploadMiddleware<TMeta = unknown> = ((
	file: File,
	meta: TMeta,
	files: AttachmentData<TMeta>[],
) => Promise<{ file: File; meta: TMeta }>) & {
	/**
	 * Optional limit that depends on the other files (e.g. count, total size). In atomic
	 * mode it runs again on the fresh list when the upload is saved, so concurrent
	 * uploads cannot bypass it. Throws `AttachmentValidationError` to reject.
	 */
	check?: (file: File, files: AttachmentData<TMeta>[]) => void;
};

export interface CategoryConfig<TMeta = unknown> {
	/** Two characters [A-Z0-9], unique across all categories of a defineAttachments() call. */
	code:         string;
	middlewares?: UploadMiddleware<TMeta>[];
	/** Checks every file and thumbnail request of this category (served with `private, no-store`). */
	authorize?:   import('./group-id.js').AuthorizeFn;
	/** Storage for this category (defaults to the `defineAttachments` provider). */
	provider?:    StorageProvider;
}

export type CategoryInput<TMeta = unknown> = CategoryConfig<TMeta>;
