import type { StorageProvider } from './types.js';

// ---------------------------------------------------------------------------
// Group ids and the category registry
//
// Every category store has a composite group id, which is also its storage folder:
//
//   {random}-{CODE}-{entityId36}      e.g. k3x9q-PD-39x9
//
// - random:     lowercase base36, unguessable (protects against enumeration), also the shard
// - CODE:       the category's two-character code [A-Z0-9], unique across all categories
// - entityId36: the owning entity's id in base36 (see EntityIdType)
//
// From the code a server finds the entity type and category (and its provider and
// optional `authorize` hook); from the entity id it knows the owner. Because the
// composite key is the folder, a tampered entity id in a URL points to a missing path.
// ---------------------------------------------------------------------------

export type EntityIdType = 'int' | 'uuid';

export interface AuthorizeContext {
	request:    Request;
	entityType: string;
	entityId:   string;
	category:   string;
	filename:   string;
}

export type AuthorizeFn = (ctx: AuthorizeContext) => boolean | Promise<boolean>;

export interface CategoryEntry {
	entityType: string;
	category:   string;
	code:       string;
	idType:     EntityIdType;
	authorize:  AuthorizeFn | undefined;
	provider:   StorageProvider | undefined;
}

export type CategoryRegistry = Map<string, CategoryEntry>;

export const CATEGORY_REGISTRY: unique symbol = Symbol.for('@atom-forge/attachment/category-registry') as never;

export const CODE_PATTERN = /^[A-Z0-9]{2}$/;
const RANDOM_PATTERN = /^[a-z0-9]+$/;
const GROUP_PATTERN  = /^([a-z0-9]+)-([A-Z0-9]{2})-([a-z0-9]+)$/;
const UUID_PATTERN   = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

// --- entity id encoding (base36, lowercase) ---

function parseBase36(s: string): bigint {
	if (!/^[a-z0-9]+$/.test(s)) throw new Error(`Invalid base36 value "${s}".`);
	let n = 0n;
	for (const ch of s) n = n * 36n + BigInt(parseInt(ch, 36));
	return n;
}

export function encodeEntityId(entityId: string, idType: EntityIdType): string {
	if (idType === 'uuid') {
		if (!UUID_PATTERN.test(entityId)) throw new Error(`Entity id "${entityId}" is not a UUID.`);
		return BigInt('0x' + entityId.replace(/-/g, '')).toString(36);
	}
	if (!/^\d+$/.test(entityId)) throw new Error(`Entity id "${entityId}" is not a non-negative integer.`);
	return BigInt(entityId).toString(36);
}

export function decodeEntityId(encoded: string, idType: EntityIdType): string {
	const n = parseBase36(encoded);
	if (idType === 'uuid') {
		if (n >= 1n << 128n) throw new Error('decodeEntityId: value out of UUID range');
		const hex = n.toString(16).padStart(32, '0');
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
	return n.toString();
}

// --- composite group id ---

export function makeGroupId(random: string, code: string, entityId: string, idType: EntityIdType): string {
	if (!RANDOM_PATTERN.test(random)) {
		throw new Error(`Group id "${random}" from nextGroupId must be lowercase base36 ([a-z0-9]+).`);
	}
	return `${random}-${code}-${encodeEntityId(entityId, idType)}`;
}

export interface ParsedGroupId {
	random:    string;
	code:      string;
	encodedId: string;
}

/** Splits a composite group id; `null` when it does not have the {random}-{CODE}-{id} shape. */
export function parseGroupId(groupId: string): ParsedGroupId | null {
	const m = GROUP_PATTERN.exec(groupId);
	return m ? { random: m[1], code: m[2], encodedId: m[3] } : null;
}

// --- registry access ---

export function getRegistry(attachments: unknown): CategoryRegistry {
	const registry = attachments && typeof attachments === 'object'
		? (attachments as { [CATEGORY_REGISTRY]?: CategoryRegistry })[CATEGORY_REGISTRY]
		: undefined;
	if (!registry) throw new Error('Expected the object returned by defineAttachments().');
	return registry;
}

export interface ResolvedGroup {
	entry:    CategoryEntry;
	entityId: string;
}

/** Resolves a group id from a URL to its category and owner; `null` if unknown or malformed. */
export function resolveGroup(registry: CategoryRegistry, groupId: string): ResolvedGroup | null {
	const parsed = parseGroupId(groupId);
	const entry  = parsed && registry.get(parsed.code);
	if (!parsed || !entry) return null;
	try {
		return { entry, entityId: decodeEntityId(parsed.encodedId, entry.idType) };
	} catch {
		return null;
	}
}

/**
 * Codes of the categories without `authorize` — the ones a reverse proxy may serve
 * directly. Use it to build the proxy pattern, e.g. `publicCodes(attachments).join('|')`.
 */
export function publicCodes(attachments: unknown): string[] {
	return [...getRegistry(attachments).values()].filter((e) => !e.authorize).map((e) => e.code);
}
