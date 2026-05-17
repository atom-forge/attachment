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
}

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
	c: 'e' | 'a' | 'c' | Focus;  // crop mode: entropy | attention | center | focus point
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

export type UploadMiddleware<TMeta = unknown> = (
	file: File,
	meta: TMeta,
	files: AttachmentData<TMeta>[],
) => Promise<{ file: File; meta: TMeta }>;

export type CategoryInput<TMeta = unknown> = UploadMiddleware<TMeta>[] | null | undefined;
