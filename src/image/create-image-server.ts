import { join, resolve } from 'node:path';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { decodeFocus, generateImage, physicalPath } from '../index.js';
import { createHmac } from 'node:crypto';
import type { ImageVariantMap } from '../types.js';

export interface ImageServiceConfig {
	variants:     ImageVariantMap;
	uploadDir:    string;
	thumbDir:     string;
	thumbPrefix?: string;   // default: '/img'
	focusSecret:  string;
}

/**
 * Creates a image request handler.
 *
 * Returns `null` for pathnames outside the configured prefix — pass-through to the framework.
 * Otherwise handles the full pipeline: cache hit → validate → generate → cache write → serve.
 *
 * URL shapes:
 *   /{prefix}/{gid}-{ver}/{mode}.{w}x{h}/{filename}.webp        (e/a/c/b modes)
 *   /{prefix}/{gid}-{ver}/{focus12}.{w}x{h}.{hash4}/{filename}.webp  (manual focus)
 */
export function createImageServer(
	config: ImageServiceConfig,
): (pathname: string) => Promise<Response | null> {
	const focusHash = (encoded: string) =>
		createHmac('sha256', config.focusSecret).update(encoded).digest('hex').slice(0, 4);
	const availableSizes = [1, 2, 3].flatMap((d) =>
		Object.values(config.variants).map(
			(def) => `${Math.round((def.w ?? 0) * d)}x${Math.round((def.h ?? 0) * d)}`,
		),
	);
	const { uploadDir, thumbDir } = config;
	const prefix = config.thumbPrefix ?? '/img';
	const uploadRoot = resolve(uploadDir);
	const inFlight = new Map<string, Promise<Buffer>>();

	return async function handle(pathname: string): Promise<Response | null> {
		if (!pathname.startsWith(prefix + '/')) return null;

		// Parse: /{prefix}/{gid}-{ver}/{mode-seg}/{filename}.webp
		const rest = pathname.slice(prefix.length + 1);
		const parts = rest.split('/');
		if (parts.length !== 3) return null;

		const [gidVer, modeSeg, urlFilename] = parts;
		if (!urlFilename.endsWith('.webp')) return null;

		// {gid}-{ver}: split on last '-'
		const lastDash = gidVer.lastIndexOf('-');
		if (lastDash === -1) return null;
		const groupId = gidVer.slice(0, lastDash);

		// Stored filename: strip trailing '.webp' added by buildImageUrl
		const filename = urlFilename.slice(0, -5);

		// Parse mode segment
		const modeTokens = modeSeg.split('.');
		const firstToken = modeTokens[0];
		const isManualFocus =
			firstToken.length === 12 && !['e', 'a', 'c', 'b'].includes(firstToken);

		let size: string;
		let urlHash: string | undefined;

		if (isManualFocus) {
			if (modeTokens.length < 3) return null;
			size    = modeTokens[1];
			urlHash = modeTokens[2];
		} else {
			if (modeTokens.length < 2) return null;
			size = modeTokens[1];
		}

		// Flat cache filename: join URL segments with dots
		const flatName  = `${gidVer}.${modeSeg}.${urlFilename}`;
		const cachePath = join(thumbDir, flatName);

		// 0. Cache hit
		try {
			const cached = await readFile(cachePath);
			return webpResponse(cached);
		} catch {
			// not cached — continue
		}

		// 1. Validate size
		if (!availableSizes.includes(size)) {
			return new Response('Invalid size', { status: 400 });
		}

		// 1. Validate focus hash
		if (isManualFocus) {
			if (focusHash(firstToken) !== urlHash) {
				return new Response('Invalid focus hash', { status: 403 });
			}
		}

		// 2. Locate original file
		const sourcePath = join(uploadRoot, physicalPath(groupId, filename));
		try {
			await access(sourcePath);
		} catch {
			return new Response('Not found', { status: 404 });
		}

		// Parse dimensions from size string (e.g. "400x400", "x400", "400x")
		const [wStr, hStr] = size.split('x');
		const width  = wStr  ? (parseInt(wStr,  10) || undefined) : undefined;
		const height = hStr ? (parseInt(hStr, 10) || undefined) : undefined;

		// Resolve crop mode
		const mode = isManualFocus
			? decodeFocus(firstToken)
			: (firstToken as 'e' | 'a' | 'c' | 'b');

		// 3. Generate — dedup concurrent requests for the same key
		let genPromise = inFlight.get(flatName);
		if (!genPromise) {
			genPromise = generateImage(sourcePath, mode, width, height);
			inFlight.set(flatName, genPromise);
			genPromise.finally(() => inFlight.delete(flatName));
		}

		let buffer: Buffer;
		try {
			buffer = await genPromise;
		} catch {
			return new Response('Image generation failed', { status: 500 });
		}

		// 4. Cache write (non-fatal on failure)
		try {
			await mkdir(thumbDir, { recursive: true });
			await writeFile(cachePath, buffer as unknown as Uint8Array);
		} catch {
			// serve anyway
		}

		// 5. Serve
		return webpResponse(buffer);
	};
}

function webpResponse(body: Buffer): Response {
	return new Response(new Blob([body as any], { type: 'image/webp' }), {
		headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
	});
}
