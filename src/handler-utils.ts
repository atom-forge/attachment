import { AttachmentValidationError } from './types.js';
import { isSafeFilename } from './safe-path.js';
import type { AttachmentData, AttachmentItem, CategoryStore } from './types.js';

// Helpers shared by the classic and the atomic category handlers.

export type AttachmentsStore = Record<string, CategoryStore>;
export type EntityRecord = { attachments: unknown } & Record<string, unknown>;

/** Storage path of a file: `{shard}/{groupId}/{filename}`, shard = first two characters. */
export function physicalPath(groupId: string, filename: string): string {
	return `${groupFolder(groupId)}/${filename}`;
}

/** Storage folder of a group: `{shard}/{groupId}`. */
export function groupFolder(groupId: string): string {
	return `${groupId.slice(0, 2)}/${groupId}`;
}

export function serveUrl(prefix: string, groupId: string, version: string, filename: string): string {
	return `${prefix}/${groupId}-${version}/${encodeURIComponent(filename)}`;
}

/** The attachments column as a store; anything that is not an object reads as empty. */
export function asStore(value: unknown): AttachmentsStore {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as AttachmentsStore) : {};
}

/** Item version: base36 counter plus a random suffix, so future version URLs cannot be guessed and pre-cached. */
export function makeVersion(counter: number): string {
	const rnd = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(7, '0').slice(-6);
	return `${counter.toString(36)}${rnd}`;
}

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function assertSafeFilename(filename: string, category: string): void {
	if (!isSafeFilename(filename)) {
		throw new AttachmentValidationError(`Invalid filename "${filename}" in "${category}".`);
	}
}

export function toPublic<TMeta>(item: AttachmentItem, groupId: string, servePrefix: string): AttachmentData<TMeta> {
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

export function notFound(filename: string, category: string): AttachmentValidationError {
	return new AttachmentValidationError(`File "${filename}" not found in "${category}".`);
}
