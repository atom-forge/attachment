import mime from 'mime';
import type { StorageProvider } from '../types.js';
import { physicalPath } from '../define-attachments.js';
import { getRegistry, resolveGroup } from '../group-id.js';
import { isSafeFilename, isSafeGroupId } from '../safe-path.js';

// ---------------------------------------------------------------------------
// createFileServer
// ---------------------------------------------------------------------------

export interface FileServerOptions {
	/** The object returned by `defineAttachments`: maps a URL's category code to its provider and `authorize`. */
	attachments:  object;
	servePrefix?: string;  // default: '/file'
}

export interface FileServerHandler {
	match(request: Request): boolean;
	handle(request: Request): Promise<Response>;
}

export const PUBLIC_CACHE  = 'public, max-age=31536000, immutable';
export const PRIVATE_CACHE = 'private, no-store';

// Types a browser would run as a page/script on our origin: always downloaded, never rendered inline.
const ACTIVE_TYPES = new Set([
	'text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml',
	'text/javascript', 'application/javascript', 'application/x-javascript',
]);

/** Security headers for every served file: no MIME sniffing; active content is forced to download. */
export function applySecurityHeaders(headers: Headers, filename: string, contentType: string): void {
	headers.set('X-Content-Type-Options', 'nosniff');
	if (ACTIVE_TYPES.has(contentType)) {
		headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
		headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
	}
}

function streamResponse(provider: StorageProvider, logicalPath: string, filename: string, cacheControl: string): Response {
	const contentType = mime.getType(filename) ?? 'application/octet-stream';
	const headers = new Headers({ 'Content-Type': contentType, 'Cache-Control': cacheControl });
	applySecurityHeaders(headers, filename, contentType);
	return new Response(provider.stream(logicalPath), { headers });
}

/**
 * Serves `/{servePrefix}/{groupId}-{version}/{filename}`.
 *
 * The category code inside the group id selects the category: its provider is read,
 * and when it has an `authorize` hook, the hook decides (403 when denied) and the
 * response is not cacheable. Unknown codes, tampered ids and missing files are 404.
 */
export function createFileServer(options: FileServerOptions): FileServerHandler {
	const servePrefix = options.servePrefix ?? '/file';
	const registry    = getRegistry(options.attachments);
	const notFound    = () => new Response('File not found', { status: 404 });

	function getPathname(request: Request): string {
		return new URL(request.url).pathname;
	}

	return {
		match(request: Request): boolean {
			return getPathname(request).startsWith(servePrefix + '/');
		},

		async handle(request: Request): Promise<Response> {
			const rest  = getPathname(request).slice(servePrefix.length + 1); // "{groupId}-{version}/{filename}"
			const slash = rest.indexOf('/');
			if (slash === -1) return notFound();

			const slug = rest.slice(0, slash);
			let filename: string;
			try {
				filename = decodeURIComponent(rest.slice(slash + 1));  // URLs carry the filename percent-encoded
			} catch {
				return notFound();
			}
			const lastDash = slug.lastIndexOf('-');
			if (lastDash <= 0) return notFound();
			const groupId = slug.slice(0, lastDash);
			if (!isSafeGroupId(groupId) || !isSafeFilename(filename)) return notFound();

			const resolved = resolveGroup(registry, groupId);
			if (!resolved) return notFound();
			const { entry, entityId } = resolved;

			if (entry.authorize) {
				const allowed = await entry.authorize({
					request,
					entityType: entry.entityType,
					entityId,
					category:   entry.category,
					filename,
				});
				if (!allowed) return new Response('Forbidden', { status: 403 });
			}

			// The composite group id is the storage folder, so a tampered entity id simply misses.
			const provider = entry.provider;
			if (!provider) throw new Error(`createFileServer: no provider for ${entry.entityType}.${entry.category}.`);
			const logical = physicalPath(groupId, filename);
			if (!(await provider.exists(logical))) return notFound();
			return streamResponse(provider, logical, filename, entry.authorize ? PRIVATE_CACHE : PUBLIC_CACHE);
		},
	};
}
