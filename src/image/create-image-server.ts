import { decodeFocus } from '../types.js';
import { physicalPath } from '../define-attachments.js';
import { isSafeFilename, isSafeGroupId } from '../safe-path.js';
import { generateImage } from './generate-image.js';
import { getRegistry, resolveGroup } from '../group-id.js';
import { createFocusHash } from './focus-hash.js';
import type { EventEmitter } from '../events/types.js';
import type { ImageVariantMap, StorageProvider } from '../types.js';

const VERSION_PATTERN = /^[a-z0-9]+$/;
const MODE_SEGMENT = /^(?:([eacb])|([0-9a-z]{12}))\.(\d*)x(\d*)(?:\.([0-9a-f]{4}))?$/;

export interface ImageServiceConfig {
	/** The object returned by `defineAttachments`: resolves the source provider and `authorize` per category. */
	attachments:    object;
	variants:       ImageVariantMap;
	thumbProvider:  StorageProvider;
	thumbPrefix?:   string;  // default: '/img'
	focusSecret:    string;
	/** Receives `thumbnail:generated` after a new thumbnail is generated and cached. */
	eventManager?:  EventEmitter;
}

export interface ImageServerHandler {
	match(request: Request): boolean;
	handle(request: Request): Promise<Response>;
}

/**
 * Creates an image request handler.
 *
 * URL shapes:
 *   /{prefix}/{gid}-{ver}/{mode}.{w}x{h}/{filename}.webp        (e/a/c/b modes)
 *   /{prefix}/{gid}-{ver}/{focus12}.{w}x{h}.{hash4}/{filename}.webp  (manual focus)
 */
export function createImageServer(config: ImageServiceConfig): ImageServerHandler {
	const { thumbProvider } = config;
	const registry = getRegistry(config.attachments);
	const focusHash = createFocusHash(config.focusSecret);
	const availableSizes = [1, 2, 3].flatMap((d) =>
		Object.values(config.variants).map(
			(def) => `${Math.round((def.w ?? 0) * d)}x${Math.round((def.h ?? 0) * d)}`,
		),
	);
	const prefix  = config.thumbPrefix ?? '/img';
	const inFlight = new Map<string, Promise<Buffer>>();

	function getPathname(request: Request): string {
		return new URL(request.url).pathname;
	}

	return {
		match(request: Request): boolean {
			return getPathname(request).startsWith(prefix + '/');
		},

		async handle(request: Request): Promise<Response> {
			const notFound = () => new Response('Not Found', { status: 404 });

			// Parse: /{prefix}/{gid}-{ver}/{mode-seg}/{filename}.webp
			const parts = getPathname(request).slice(prefix.length + 1).split('/');
			if (parts.length !== 3) return notFound();
			const [gidVer, modeSeg, encodedName] = parts;

			let urlFilename: string;
			try {
				urlFilename = decodeURIComponent(encodedName);
			} catch {
				return notFound();
			}
			if (!urlFilename.endsWith('.webp')) return notFound();

			// {gid}-{ver}: split on last '-'
			const lastDash = gidVer.lastIndexOf('-');
			if (lastDash <= 0) return notFound();
			const groupId = gidVer.slice(0, lastDash);
			const version = gidVer.slice(lastDash + 1);

			// Stored filename: strip trailing '.webp' added by buildImageUrl
			const filename = urlFilename.slice(0, -5);
			if (!isSafeGroupId(groupId) || !VERSION_PATTERN.test(version) || !isSafeFilename(filename)) return notFound();

			// Strict mode segment: "{e|a|c|b}.{w}x{h}" or "{focus12}.{w}x{h}.{hash4}".
			// Anything else is rejected before the cache, so URL variations cannot multiply cache entries.
			const modeMatch = MODE_SEGMENT.exec(modeSeg);
			if (!modeMatch) return notFound();
			const [, simpleMode, focusCode, wStr, hStr, urlHash] = modeMatch;
			if (simpleMode ? urlHash !== undefined : urlHash === undefined) return notFound();

			const size = `${wStr}x${hStr}`;
			if (!availableSizes.includes(size)) {
				return new Response('Invalid size', { status: 400 });
			}
			if (focusCode && focusHash(focusCode) !== urlHash) {
				return new Response('Invalid focus hash', { status: 403 });
			}

			const resolved = resolveGroup(registry, groupId);
			if (!resolved) return notFound();
			const { entry, entityId } = resolved;
			const sourceProvider = entry.provider;
			if (!sourceProvider) throw new Error(`createImageServer: no provider for ${entry.entityType}.${entry.category}.`);

			// Categories with authorize: the hook decides, and the thumbnail is not cacheable downstream.
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
			const cacheControl = entry.authorize ? 'private, no-store' : 'public, max-age=31536000, immutable';

			// The original must still exist: thumbnails of deleted files are not served from the cache.
			const sourcePath = physicalPath(groupId, filename);
			if (!(await sourceProvider.exists(sourcePath))) return notFound();

			// Flat cache key: join URL segments with dots (unambiguous: gid/version contain no dots,
			// the mode segment has a fixed shape).
			const flatName = `${gidVer}.${modeSeg}.${urlFilename}`;
			if (await thumbProvider.exists(flatName)) {
				try {
					return webpResponse(await thumbProvider.read(flatName), cacheControl);
				} catch {
					// cache read failed — regenerate
				}
			}

			const width  = parseInt(wStr, 10) || undefined;
			const height = parseInt(hStr, 10) || undefined;
			const firstToken = simpleMode ?? focusCode;
			const isManualFocus = focusCode !== undefined;

			// Resolve crop mode
			const mode = isManualFocus
				? decodeFocus(firstToken!)
				: (firstToken as 'e' | 'a' | 'c' | 'b');

			// 4. Generate — dedup concurrent requests for the same key
			let genPromise = inFlight.get(flatName);
			if (!genPromise) {
				genPromise = (async () => {
					const sourceBuffer = await sourceProvider.read(sourcePath);
					return generateImage(sourceBuffer, mode, width, height);
				})();
				inFlight.set(flatName, genPromise);
				// The request below handles the rejection; this chain must not leave an unhandled one.
				genPromise.finally(() => inFlight.delete(flatName)).catch(() => {});
			}

			let buffer: Buffer;
			try {
				buffer = await genPromise;
			} catch {
				return new Response('Image generation failed', { status: 500 });
			}

			// 5. Cache write (non-fatal on failure)
			try {
				const ab = new ArrayBuffer(buffer.length);
				new Uint8Array(ab).set(buffer);
				await thumbProvider.save(flatName, new File([ab], flatName, { type: 'image/webp' }));
				config.eventManager?.trigger({ type: 'thumbnail:generated', groupId, filename, modeSeg });
			} catch {
				// serve anyway
			}

			// 6. Serve
			return webpResponse(buffer, cacheControl);
		},
	};
}

function webpResponse(body: Buffer, cacheControl: string): Response {
	return new Response(new Blob([body as any], { type: 'image/webp' }), {
		headers: { 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' },
	});
}
