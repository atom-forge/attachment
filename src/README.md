# attachments

Portable, framework-agnostic file attachment system for Prisma entities.
Stores file metadata in a `Json?` column on the Prisma model — no separate file table.
Designed to be extracted into a standalone npm package without modification.

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Storage formats](#storage-formats)
4. [Handler API](#handler-api)
5. [Upload Middleware](#upload-middleware)
6. [Image handling](#image-handling)
7. [Serving files](#serving-files)
8. [Dependencies & npm extraction](#dependencies--npm-extraction)

---

## Overview

### What it does

- Attaches files to any Prisma entity via a `Json?` column called `attachments`
- Supports multiple **categories** per entity (e.g. `avatar`, `gallery`, `documents`)
- Validates and transforms uploads via a composable **middleware pipeline**
- Generates cache-busted serving URLs automatically
- Provides on-demand **image generation** for images (WebP output, flat disk cache)
- Ships a typed **client-side handler** that reads entity data directly — no extra API call

### Where it lives

```
src/attachments/         ← portable core (no app-specific imports)
  types.ts               — all public types + AttachmentValidationError
  define-attachments.ts             — defineAttachments() factory
  craete-local-provider.ts      — createLocalProvider() for local disk storage
  middleware.ts          — built-in upload validators and transformers
  create-file-server.ts         — createFileServer() request handler
  image-url.ts       — buildThumbnailUrl(), buildVariantUrl()
  generate-image.ts  — generateThumbnail() (sharp-based)
  create-image-server.ts   — createThumbnailService() request handler
  client-handler.ts      — makeAttachmentHandler() client-side factory
  index.ts               — barrel export

src/lib/image-variants.ts   ← app-level variant definitions (server + client)
src/modules/attachments/    ← app-level wiring (entities, middleware, services)
```

### App-level wiring

In this project, `modules.attachments` is pre-configured for the following entities:

| Entity   | Category  | `idField`    | Middleware                                                  |
|----------|-----------|--------------|-------------------------------------------------------------|
| `user`   | `avatar`  | `neptunCode` | —                                                           |
| `user`   | `gallery` | `neptunCode` | —                                                           |
| `course` | `avatar`  | `id` (cuid)  | `count(1)`, `mime(['image/jpeg','image/png','image/webp'])` |

---

## Getting Started

### 1. Define your attachment schema

```ts
import {defineAttachments, count, mime, toWebP, imgstat} from './index.js';

const attachments = defineAttachments({
	user: defineAttachments.entity({
		avatar: [count(1), mime('image/*'), toWebP(80, 400, 400), imgstat()],
		gallery: [mime('image/*'), toWebP(80)],
	}, {idField: 'neptunCode'}),

	course: defineAttachments.entity({
		avatar: [count(1), mime(['image/jpeg', 'image/png', 'image/webp'])],
	}),
}, {
	provider: services.storage,
	servePrefix: '/file',
	nextGroupId: async (entityType, entityId, category) => {
		const group = await prisma.attachmentGroup.upsert({
			where: {entityType_entityId_category: {entityType, entityId, category}},
			create: {entityType, entityId, category},
			update: {},
		});
		return group.id.toString(36);
	},
});
```

### 2. Upload a file

```ts
const userRecord = await prisma.user.findUniqueOrThrow({where: {neptunCode}});
const h = attachments.user(userRecord);

const {attachment, rollback} = await h.avatar.add(uploadedFile, {});
try {
	await prisma.user.update({
		where: {neptunCode},
		data: {attachments: userRecord.attachments as object},
	});
} catch (err) {
	await rollback();   // deletes the physical file on DB failure
	throw err;
}
```

The handler **mutates `entity.attachments` in-place** — you must call `prisma.update` yourself to persist.

### 3. Read files on the server

```ts
const h = attachments.user(userRecord);

h.avatar.list()           // AttachmentData[]
h.avatar.get('photo.jpg') // AttachmentData | undefined
```

### 4. Generate thumbnail URLs on the client

```ts
// src/lib/image-variants.ts — app-level variant config
import {imageVariants, type AppImageVariants} from '$lib/image-variants.js';
import {makeAttachmentHandler} from '../attachments/client-handler.js';
import type {AttachmentsModule} from '$modules/attachments/index.js';

// Create once, reuse everywhere
const h = makeAttachmentHandler<AttachmentsModule, AppImageVariants>(imageVariants);

// In a Svelte component (course has an `attachments` field from the DB)
const avatarItem = h.course(course).avatar.first;

avatarItem?.img.avatar()     // → /img/…/e.400x400/photo.jpg.webp  (1x)
avatarItem?.img.avatar(2)    // → /img/…/e.800x800/photo.jpg.webp  (2x retina)
avatarItem?.url              // → /file/…/photo.jpg  (raw file)
avatarItem?.filename         // → 'photo.jpg'
avatarItem?.meta             // → unknown (cast to your meta type as needed)
```

> **Important:** import from leaf files (`client-handler.js`, `thumbnail-url.js`), not the barrel `index.ts`, in Svelte components. The barrel re-exports Node.js server modules that break in the browser.

---

## Storage formats

### JSON column structure

The `attachments` column holds a `Record<category, CategoryStore>`:

```ts
interface CategoryStore {
	i: string;          // groupId (base36, from AttachmentGroup.id)
	v: number;          // version sequence counter (monotonically increasing)
	f: AttachmentItem[];
}

interface AttachmentItem {
	n: string;   // filename
	v: string;   // version at time of add/replace (base36)
	s: number;   // size in bytes
	t: number;   // uploadedAt (Unix epoch)
	x: unknown;  // caller-supplied meta
}
```

**Example stored value:**

```json
{
	"avatar": {
		"i": "abc123",
		"v": 3,
		"f": [
			{
				"n": "photo.jpg",
				"v": "3",
				"s": 42000,
				"t": 1743076800,
				"x": {}
			}
		]
	}
}
```

### Public `AttachmentData<TMeta>` type

All read methods return this shape:

```ts
interface AttachmentData<TMeta = unknown> {
	filename: string;
	version: string;   // base36
	groupId: string;   // base36
	size: number;
	uploadedAt: number;   // Unix epoch
	meta: TMeta;
	url: string;   // computed: /{servePrefix}/{groupId}-{version}/{filename}
}
```

`url` is never stored — computed on every read.

### Physical file layout

Files live under `UPLOAD_DIR` (default `./var/uploads`) at:

```
{shard}/{groupId}/{filename}
```

where `shard = groupId.slice(0, 2)`.

On `replace`, the file is **overwritten in place** — the physical path stays the same, but the version number changes in the JSON, making the serving URL unique (cache-busted).

---

## Handler API

```ts
const h = attachments.user(userRecord);
// h.avatar  — CategoryHandler for the 'avatar' category
// h.gallery — CategoryHandler for the 'gallery' category
// h.purge() — deletes all files across all categories
```

### Read

```ts
h.avatar.list()            // AttachmentData[] — all files
h.avatar.get('photo.jpg')  // AttachmentData | undefined
```

### Write

All write methods mutate `entity.attachments` in-place. **Persist with `prisma.update` after every write.**

#### `add(file, meta)`

```ts
const {attachment, rollback} = await h.avatar.add(file, {});
```

- Runs the middleware pipeline
- Sanitizes filename (strips diacritics, special chars) — configurable or disableable
- Resolves name collisions: `photo.png` → `photo(1).png` → `photo(2).png` …
- Bumps the version counter; assigns new `version` to the item

#### `replace(filename, file, meta)`

```ts
const {attachment, rollback} = await h.avatar.replace('photo.jpg', file, {});
```

- Runs the middleware pipeline
- Overwrites the physical file; bumps version → new URL
- Throws `AttachmentValidationError` if filename not found

#### `updateMeta(filename, meta)`

```ts
const updated = h.avatar.updateMeta('photo.jpg', {caption: 'Hello'});
```

No file I/O. Bumps version → new URL. Throws if not found.

#### `rename(oldName, newName)`

```ts
await h.avatar.rename('photo.jpg', 'profile.jpg');
```

Sanitizes `newName`. Throws if the sanitized name already exists.

#### `delete(filename)`

```ts
await h.avatar.delete('photo.jpg');
```

Deletes the physical file and removes the record. Does **not** bump the version counter.

#### `reorder(filenames)`

```ts
h.gallery.reorder(['b.png', 'a.png', 'c.png']);
```

Reorders the JSON array. No file I/O.

### `purge()` — entity level

```ts
await h.purge();
// Deletes every file across all categories. Sets entity.attachments = {}.
// Requires a provider to be configured. Persist with prisma.update afterwards.
```

### Rollback pattern

```ts
const {attachment, rollback} = await h.avatar.add(file, meta);
try {
	await prisma.course.update({where: {id}, data: {attachments: record.attachments as object}});
} catch (err) {
	await rollback();   // cleans up the uploaded file
	throw err;
}
```

---

## Upload Middleware

Middlewares are factory functions that return an `UploadMiddleware`:

```ts
type UploadMiddleware<TMeta = unknown> = (
	file: File,
	meta: TMeta,
	files: AttachmentData<TMeta>[],   // existing files in the category
) => Promise<{ file: File; meta: TMeta }>;
```

They run in order before `add()` and `replace`add()` and `replace()`. Throw `AttachmentValidationError` to abort the upload. Return the (optionally modified) file and meta to continue.

### Validators

#### `count(max)`

Rejects the upload when the category already has `max` or more files.

```ts
count(1)   // at most one file (avatar use case)
count(10)  // at most ten
```

#### `size(maxBytes)`

Rejects files larger than `maxBytes`.

```ts
size(2 * 1024 * 1024)   // 2 MB
```

#### `sumSize(maxBytes)`

Rejects when the total size of all existing files + the new file exceeds `maxBytes`.

```ts
sumSize(50 * 1024 * 1024)   // 50 MB total for the category
```

#### `mime(pattern)`

Allows only files whose MIME type matches. Supports wildcard subtypes.

```ts
mime('image/*')
mime(['image/jpeg', 'image/png', 'image/webp'])
```

#### `ext(extensions)`

Allows only files with a matching extension (case-insensitive, leading dot required).

```ts
ext(['.jpg', '.jpeg', '.png', '.webp'])
```

---

### Transformers

Transformers require peer dependencies (`sharp`, `music-metadata`). Both are installed in this project.

#### `toWebP(lossy?, width?, height?)`

Converts the uploaded image to WebP.

| Param    | Type              | Default | Description                                                                      |
|----------|-------------------|---------|----------------------------------------------------------------------------------|
| `lossy`  | `false \| number` | `false` | `false` = lossless; `0–100` = lossy quality                                      |
| `width`  | `number`          | —       | Max width. One dimension → proportional resize (no enlargement). Both → contain. |
| `height` | `number`          | —       | Max height.                                                                      |

```ts
toWebP()              // lossless, no resize
toWebP(80)            // lossy q80
toWebP(false, 1280)   // lossless, max-width 1280
toWebP(80, 800, 600)  // lossy q80, contain in 800×600
```

Peer dependency: `sharp`

#### `imgstat(cropMode?, focusHash?)`

Reads image dimensions, dominant color, animated flag, and crop mode from the uploaded file. Injects an `ImgStat` object into `meta.img`.

| Param       | Type                         | Default | Description                                      |
|-------------|------------------------------|---------|--------------------------------------------------|
| `cropMode`  | `'e' \| 'a' \| 'c' \| Focus` | `'e'`   | Crop strategy stored for later URL building      |
| `focusHash` | `FocusHashFn`                | —       | Required to store `meta.img.ch` for manual focus |

```ts
imgstat()            // entropy crop (default) — works without ImgStat for URL building
imgstat('a')         // attention crop
imgstat('c')         // centre crop
imgstat({x: 500, y: 300, s: {x: 0, y: 0, w: 1000, h: 1000}})
// manual focus point (permille coords, 0–1000)
```

The injected `ImgStat`:

```ts
interface ImgStat {
	w: number;               // width px
	h: number;               // height px
	d: string;               // dominant color (#rrggbb)
	a: boolean;              // animated (GIF / animated WebP)
	c: 'e' | 'a' | 'c' | Focus;  // stored crop mode
	ch?: string;               // HMAC hash of focus12 (manual focus only)
}
```

`meta.img` is not reflected in `TMeta` at compile time — cast at the call site:

```ts
const meta = attachment.meta as { img: ImgStat };
```

Peer dependency: `sharp`

#### `getMp3Duration(metaKey?)`

Reads the duration of an MP3 and injects it into `meta[metaKey]` (seconds, number).
Default `metaKey`: `'duration'`.

```ts
getMp3Duration()                  // → meta.duration
getMp3Duration('durationSeconds') // → meta.durationSeconds
```

Peer dependency: `music-metadata`

---

### Name helpers

#### `randname()`

Replaces the uploaded filename with a random UUID-based name, keeping the extension.

```ts
randname()
// 'photo.jpg' → 'f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg'
```

No extra dependency — uses `crypto.randomUUID()`.

---

## Image handling

### Image variants (`src/lib/image-variants.ts`)

`imageVariants` is the **single source of truth** for thumbnail sizes. It is shared by server and client.

```ts
// src/lib/image-variants.ts
export const imageVariants = {
	thumb: {w: 200, h: 200},
	avatar: {w: 400, h: 400},
	wide: {w: 800, h: 800},
	index: {w: 400},          // width-only → proportional height
	tall: {h: 400},          // height-only → proportional width
} satisfies ImageVariantMap;
```

The thumbnail service derives all allowed sizes from this map automatically (1×, 2×, 3× per variant). Adding or removing a variant here updates the server allowlist immediately.

### Thumbnail URL schema

```
/{thumbPrefix}/{groupId}-{version}/{mode-segment}/{filename}.webp
```

**Mode segment:**

| Format                      | Example                     | When               |
|-----------------------------|-----------------------------|--------------------|
| `{mode}.{w}x{h}`            | `e.400x400`                 | named crop mode    |
| `{focus12}.{w}x{h}.{hash4}` | `0s0s0o0o0o7s.400x400.ab1c` | manual focus point |

**Crop modes:**

| Mode | Strategy                   |
|------|----------------------------|
| `e`  | entropy (default fallback) |
| `a`  | attention                  |
| `c`  | centre cover               |
| `b`  | box / contain (no enlarge) |

**Size notation:** `400x400` = fixed, `400x0` = width-only, `0x400` = height-only.

### Density

The client multiplies dimensions by the density before building the URL — the server has no concept of density:

```
avatar @1x  →  e.400x400
avatar @2x  →  e.800x800
avatar @3x  →  e.1200x1200
```

### `buildVariantUrl(variants, attachment, variant, density?, mode?)`

Type-safe URL builder. Accepts any `AttachmentData<unknown>` — no `ImgStat` required.

```ts
import {buildVariantUrl} from '../attachments/thumbnail-url.js';
import {imageVariants} from '$lib/image-variants.js';

buildVariantUrl(imageVariants, attachment, 'avatar')        // 1x, entropy fallback
buildVariantUrl(imageVariants, attachment, 'avatar', 2)     // 2x
buildVariantUrl(imageVariants, attachment, 'thumb', 1, 'c') // centre crop
```

Mode resolution: explicit arg → `meta.img.c` (if stored by `imgstat`) → `'e'`.

### `buildThumbnailUrl(attachment, width, height, mode?, prefix?)`

Low-level builder. Requires `AttachmentData<{ img: ImgStat }>` when `mode` is omitted (falls back to `meta.img.c`).

```ts
import {buildThumbnailUrl} from '../attachments/thumbnail-url.js';

buildThumbnailUrl(attachment, 400, 400)        // uses meta.img.c
buildThumbnailUrl(attachment, 400, 400, 'e')   // explicit mode
buildThumbnailUrl(attachment, 400, 0, 'a')     // width-only
```

For manual focus, `meta.img.ch` must be present (populated by `imgstat` + `FocusHashFn`).

### `makeAttachmentHandler<M, V>(variants, options?)`

Client-side factory. Reads the entity's `attachments` JSON field directly — no server round-trip.

```ts
import {makeAttachmentHandler} from '../attachments/client-handler.js';
import {imageVariants, type AppImageVariants} from '$lib/image-variants.js';
import type {AttachmentsModule} from '$modules/attachments/index.js';

const h = makeAttachmentHandler<AttachmentsModule, AppImageVariants>(imageVariants);

// The entity must include the `attachments` field from the DB
const item = h.course(course).avatar.first;  // ItemView | undefined
const all = h.user(user).gallery.all;       // ItemView[]

item?.filename          // 'photo.jpg'
item?.url               // '/file/abc123-3/photo.jpg'
item?.meta              // unknown (cast as needed)
item?.img.avatar()      // '/img/abc123-3/e.400x400/photo.jpg.webp'
item?.img.avatar(2)     // '/img/abc123-3/e.800x800/photo.jpg.webp'
item?.img.thumb(1, 'c') // '/img/abc123-3/c.200x200/photo.jpg.webp'

h.user(user).gallery.find('*.jpg')           // ItemView[] — glob filter
h.user(user).gallery.last?.img.wide(2)       // last item, 2x wide thumbnail
```

**Options:** `{ servePrefix?: string, thumbPrefix?: string }` — defaults to `/file` and `/img`.

> Import from leaf files, not the barrel, in Svelte components.

### Animated images

For animated GIFs and animated WebP, `e` (entropy) and `a` (attention) are silently downgraded to `c` (centre) — they rely on single-frame analysis and produce inconsistent results across frames. Manual focus is always preserved.

---

## Serving files

Both `createFileServer` and `createThumbnailService` return the same interface:

```ts
(pathname: string) => Promise<Response | null>
```

`Response` is the [Web Standard API](https://developer.mozilla.org/en-US/docs/Web/API/Response) — available natively in Node 20+, Bun, Deno, and edge runtimes. `null` means the request does not match the configured prefix — pass it on to your framework.

### URL schemas

```
Raw file:  GET /{servePrefix}/{groupId}-{version}/{filename}
Thumbnail: GET /{thumbPrefix}/{groupId}-{version}/{mode-segment}/{filename}.webp
```

Default prefixes: `/file` and `/img`.

---

### Framework integrations

#### SvelteKit

Register both handlers in `hooks.server.ts`. They run before the SvelteKit router — no route file needed.

```ts
// src/hooks.server.ts
import type {Handle} from '@sveltejs/kit';
import {createFileServer} from '../attachments/file-server.js';
import {createThumbnailService} from '../attachments/thumbnail-service.js';
import {autoDriver} from '../attachments/file-server.auto.js';

const fileServer = createFileServer({uploadDir, servePrefix: '/file', driver: autoDriver});
const thumbServer = createThumbnailService({uploadDir, thumbDir, thumbPrefix: '/img', focusSecret, variants});

export const handle: Handle = async ({event, resolve}) =>
	(await fileServer(event.url.pathname))
	?? (await thumbServer(event.url.pathname))
	?? resolve(event);
```

In this project, `services.fileServer` and `services.thumbnailServer` are pre-configured:

```ts
import {services} from '$lib/server/context.js';

export const handle: Handle = async ({event, resolve}) =>
	(await services.fileServer(event.url.pathname))
	?? (await services.thumbnailServer(event.url.pathname))
	?? resolve(event);
```

#### Hono

Hono uses Web `Response` natively — no adapter needed.

```ts
import {Hono} from 'hono';
import {createFileServer} from '../attachments/file-server.js';
import {createThumbnailService} from '../attachments/thumbnail-service.js';
import {autoDriver} from '../attachments/file-server.auto.js';

const fileServer = createFileServer({uploadDir, servePrefix: '/file', driver: autoDriver});
const thumbServer = createThumbnailService({uploadDir, thumbDir, thumbPrefix: '/img', focusSecret, variants});

const app = new Hono();

app.use('/file/*', async (c, next) => {
	return (await fileServer(new URL(c.req.url).pathname)) ?? next();
});

app.use('/img/*', async (c, next) => {
	return (await thumbServer(new URL(c.req.url).pathname)) ?? next();
});
```

#### Express

Express does not support Web `Response` natively. A small adapter converts headers and body:

```ts
import express from 'express';
import {createFileServer} from '../attachments/file-server.js';
import {createThumbnailService} from '../attachments/thumbnail-service.js';
import {autoDriver} from '../attachments/file-server.auto.js';

const fileServer = createFileServer({uploadDir, servePrefix: '/file', driver: autoDriver});
const thumbServer = createThumbnailService({uploadDir, thumbDir, thumbPrefix: '/img', focusSecret, variants});

async function sendWebResponse(response: Response, res: express.Response) {
	res.status(response.status);
	response.headers.forEach((value, key) => res.setHeader(key, value));
	res.end(Buffer.from(await response.arrayBuffer()));
}

const app = express();

app.use('/file', async (req, res, next) => {
	const r = await fileServer(req.path);
	if (!r) return next();
	await sendWebResponse(r, res);
});

app.use('/img', async (req, res, next) => {
	const r = await thumbServer(req.path);
	if (!r) return next();
	await sendWebResponse(r, res);
});
```

> **Note:** Express passes only the path (without prefix) to the handler when mounted with `app.use('/file', ...)`. If you mount at root instead, pass `req.url` directly.

#### Next.js (App Router)

**Option A — `middleware.ts`** (intercepts all requests before any route):

```ts
// middleware.ts (project root)
import {NextResponse} from 'next/server';
import type {NextRequest} from 'next/server';
import {createFileServer} from './src/attachments/file-server.js';
import {createThumbnailService} from './src/attachments/thumbnail-service.js';
import {autoDriver} from './src/attachments/file-server.auto.js';

const fileServer = createFileServer({uploadDir, servePrefix: '/file', driver: autoDriver});
const thumbServer = createThumbnailService({uploadDir, thumbDir, thumbPrefix: '/img', focusSecret, variants});

export async function middleware(request: NextRequest) {
	const {pathname} = request.nextUrl;
	return (await fileServer(pathname))
		?? (await thumbServer(pathname))
		?? NextResponse.next();
}

export const config = {
	matcher: ['/file/:path*', '/img/:path*'],
};
```

**Option B — route handlers** (`app/file/[...slug]/route.ts`):

```ts
// app/file/[...slug]/route.ts
import {createFileServer} from '../../../../attachments/file-server.js';
import {autoDriver} from '../../../../attachments/file-server.auto.js';

const fileServer = createFileServer({uploadDir, servePrefix: '/file', driver: autoDriver});

export async function GET(request: Request) {
	const pathname = new URL(request.url).pathname;
	return (await fileServer(pathname)) ?? new Response('Not found', {status: 404});
}
```

Create an identical handler at `app/img/[...slug]/route.ts` for thumbnails.

#### Nuxt 3 / Nitro

Use a server middleware under `server/middleware/`. Nitro's `defineEventHandler` is response-framework-specific, but `sendWebResponse` (Nitro 2.6+) bridges Web `Response` directly.

```ts
// server/middleware/attachments.ts
import {createFileServer} from '../../attachments/file-server.js';
import {createThumbnailService} from '../../attachments/thumbnail-service.js';
import {autoDriver} from '../../attachments/file-server.auto.js';

const fileServer = createFileServer({uploadDir, servePrefix: '/file', driver: autoDriver});
const thumbServer = createThumbnailService({uploadDir, thumbDir, thumbPrefix: '/img', focusSecret, variants});

export default defineEventHandler(async (event) => {
	const r = (await fileServer(event.path)) ?? (await thumbServer(event.path));
	if (!r) return;

	setResponseStatus(event, r.status);
	for (const [key, value] of r.headers) setResponseHeader(event, key, value);
	const buf = Buffer.from(await r.arrayBuffer());
	return send(event, buf);
});
```

> Nitro's `sendWebResponse(event, response)` helper (available in Nitro 2.6+) eliminates the manual header loop above.

---

### Nginx (production)

Bypass the app server entirely for maximum throughput. Nginx resolves the physical path from the URL without HMAC validation — appropriate because files are already content-addressed by `groupId` and the shard prefix.

**Raw files:**

```nginx
location ~ ^/file/(..)(\w*)(?:-\w+)?/(.+)$ {
    alias /var/uploads/$1/$1$2/$3;
}
# /file/abc123-3/photo.jpg → /var/uploads/ab/abc123/photo.jpg
```

**Thumbnails** (serve cached; fall back to the app for generation):

```nginx
location ~ ^/img/([^/]+)/([^/]+)/(.+)$ {
    try_files /var/thumb/$1.$2.$3 @app;
}
location @app {
    proxy_pass http://localhost:3000;
}
```

---

### Cache invalidation

When an attachment is replaced, its version changes — old thumbnail cache files become orphaned. Schedule periodic cleanup of `THUMB_DIR`:

```sh
# Delete thumbnails not accessed in 30 days
find /var/thumb -type f -atime +30 -delete
```

---

### Environment variables summary

| Variable       | Default         | Description                                   |
|----------------|-----------------|-----------------------------------------------|
| `UPLOAD_DIR`   | `./var/uploads` | Root directory for uploaded files             |
| `SERVE_PREFIX` | `/file`         | URL prefix for raw file serving               |
| `THUMB_DIR`    | `./var/thumb`   | Flat cache directory for generated thumbnails |
| `THUMB_PREFIX` | `/img`          | URL prefix for thumbnail serving              |
| `FOCUS_SECRET` | *(required)*    | HMAC secret for manual-focus hash validation  |

---

## Dependencies & npm extraction

### Runtime dependencies (Node.js built-ins — 0 npm deps)

| Module             | Used in                                                                     |
|--------------------|-----------------------------------------------------------------------------|
| `node:crypto`      | `create-image-server.ts` — HMAC signing                                     |
| `node:fs/promises` | `craete-local-provider.ts`, `create-image-server.ts`, `file-server.node.ts` |
| `node:path`        | `craete-local-provider.ts`, `create-image-server.ts`                        |

`File` and `crypto.randomUUID()` are Web API globals — available in Node 20+ and Bun natively.

### Peer dependencies (required when publishing as npm package)

| Peer dependency  | Version | Required by                                    |
|------------------|---------|------------------------------------------------|
| `sharp`          | `^0.34` | `toWebP()`, `imgstat()`, `generateThumbnail()` |
| `music-metadata` | `^11`   | `getMp3Duration()`                             |

All are optional at the package level — validators work without them; calling transformer factories will fail at runtime if the peer dep is missing.

### Extraction rules (`src/attachments/` must never contain)

- No Prisma imports
- No SvelteKit imports (`@sveltejs/kit`, `$app/*`)
- No path aliases (`$lib/*`, `$modules`, `$services`)
- No app error types (`BadRequestError`, etc.)

Validation errors are thrown as `AttachmentValidationError extends Error`. App code wraps this in `BadRequestError` where needed.
