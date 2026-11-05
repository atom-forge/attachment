# Image Handling

## Image variants

Define a variant map once — it is shared between server and client:

```ts
import { type ImageVariantMap } from '@atom-forge/attachment';

export const imageVariants = {
  thumb:  { w: 200, h: 200 },
  avatar: { w: 400, h: 400 },
  wide:   { w: 800, h: 800 },
  index:  { w: 400 },           // width-only → proportional height
  tall:   { h: 400 },           // height-only → proportional width
} satisfies ImageVariantMap;

export type AppImageVariants = typeof imageVariants;
```

The thumbnail service derives all allowed sizes from this map automatically (1×, 2×, 3× per variant). Adding or removing a variant here updates the server allowlist immediately.

---

## Thumbnail URL schema

```
/{thumbPrefix}/{groupId}-{version}/{mode-segment}/{filename}.webp

/img/k3x9q-AV-39x9-1r2jo3l/e.400x400/photo.jpg.webp
```

`groupId` is the composite group id of the category store (`{random}-{CODE}-{entityId36}`, here `k3x9q-AV-39x9`), `version` the item version (`1r2jo3l`). The filename is percent-encoded.

**Mode segment:**

| Format                      | Example                     | When                  |
|-----------------------------|-----------------------------|-----------------------|
| `{mode}.{w}x{h}`            | `e.400x400`                 | named crop mode       |
| `{focus12}.{w}x{h}.{hash4}` | `0s0s0o0o0o7s.400x400.ab1c` | manual focus point    |

**Crop modes:**

| Mode | Strategy                   |
|------|----------------------------|
| `e`  | entropy (default fallback) |
| `a`  | attention                  |
| `c`  | centre cover               |
| `b`  | box / inside (fits within, no enlarge) |

**Size notation:** `400x400` = fixed, `400x0` = width-only, `0x400` = height-only.

The mode segment is validated strictly: anything other than `{e|a|c|b}.{w}x{h}` or `{focus12}.{w}x{h}.{hash4}` is a 404, so URL variations cannot multiply cache entries.

---

## Density

The client multiplies dimensions by the density before building the URL — the server has no concept of density:

```
avatar @1x  →  e.400x400
avatar @2x  →  e.800x800
avatar @3x  →  e.1200x1200
```

---

## `buildVariantUrl(variants, attachment, variant, density?, mode?)`

Type-safe URL builder. Accepts any `AttachmentData<unknown>` — no `ImgStat` required. `mode` is `'e' | 'a' | 'c' | 'b'`.

```ts
import { buildVariantUrl } from '@atom-forge/attachment/client';

buildVariantUrl(imageVariants, attachment, 'avatar')         // 1x, stored mode or entropy fallback
buildVariantUrl(imageVariants, attachment, 'avatar', 2)      // 2x
buildVariantUrl(imageVariants, attachment, 'thumb', 1, 'c')  // centre crop
```

Mode resolution: explicit arg → stored `meta.img.c` (a stored `Focus` only if `meta.img.ch` also exists) → `'e'`. The same applies to `makeAttachmentHandler`.

---

## `buildImageUrl(attachment, width, height, mode?, prefix?)`

Low-level builder. Requires `AttachmentData<{ img: ImgStat }>` when `mode` is omitted.

```ts
import { buildImageUrl } from '@atom-forge/attachment/client';

buildImageUrl(attachment, 400, 400)        // uses meta.img.c
buildImageUrl(attachment, 400, 400, 'e')   // explicit mode
buildImageUrl(attachment, 400, 0, 'a')     // width-only
```

Accepts `'e' | 'a' | 'c' | 'b' | Focus`. For manual focus, `meta.img.ch` must be present (populated by `imgstat` + `FocusHashFn`), otherwise it throws.

---

## `makeAttachmentHandler<M, V>(variants, options?)`

Client-side factory. Reads the entity's `attachments` JSON field directly — no server round-trip.

```ts
import { makeAttachmentHandler } from '@atom-forge/attachment/client';

const h = makeAttachmentHandler(imageVariants);
// options: { servePrefix?: string, thumbPrefix?: string }  (defaults: '/file', '/img')

const item = h.user(user).avatar.first;       // ItemView | undefined
const all  = h.user(user).gallery.all;        // ItemView[]

item?.filename          // 'photo.jpg'
item?.url               // '/file/k3x9q-AV-39x9-1r2jo3l/photo.jpg'
item?.meta              // unknown (cast as needed)
item?.img.avatar()      // '/img/k3x9q-AV-39x9-1r2jo3l/e.400x400/photo.jpg.webp'
item?.img.avatar(2)     // '/img/k3x9q-AV-39x9-1r2jo3l/e.800x800/photo.jpg.webp'
item?.img.thumb(1, 'c') // '/img/k3x9q-AV-39x9-1r2jo3l/c.200x200/photo.jpg.webp'

h.user(user).gallery.find('*.jpg')    // ItemView[] — glob filter
h.user(user).gallery.last?.img.wide(2)
```

---

## Manual focus end to end

A focus URL carries a 4-character hash; the image server recomputes it with its `focusSecret` and answers 403 on mismatch. To make focus URLs work:

1. Upload with `imgstat(focus, createFocusHash(secret))` — `createFocusHash` is a server-only export, `secret` is the same value as the image server's `focusSecret`. This stores `meta.img.c` (the focus) and `meta.img.ch` (the hash).
2. Build the URL on the client without a mode (`item.img.avatar()`, `buildVariantUrl(...)`, `buildImageUrl(...)`): the stored focus and hash are used.
3. Serve with `createImageServer({ ..., focusSecret: secret })`.

```ts
// server
import { imgstat, createFocusHash, createImageServer } from '@atom-forge/attachment';

const FOCUS_SECRET = process.env.FOCUS_SECRET!;
const focusHash = createFocusHash(FOCUS_SECRET);
// category: { code: 'CV', middlewares: [mime('image/*'), imgstat({ x: 500, y: 300, s: { x: 0, y: 0, w: 1000, h: 1000 } }, focusHash)] }

const imageServer = createImageServer({ attachments, variants: imageVariants, thumbProvider, focusSecret: FOCUS_SECRET });
```

A stored focus without `meta.img.ch` (e.g. `imgstat(focus)` without a hash function) is ignored by the client, which falls back to `'e'`. Changing the secret invalidates existing focus URLs.

---

## Image server

```ts
import { createImageServer, createLocalProvider } from '@atom-forge/attachment';

export const imageServer = createImageServer({
  attachments,                                    // the defineAttachments result
  variants:      imageVariants,                   // the same map the client uses
  thumbProvider: createLocalProvider('./var/thumb'),
  thumbPrefix:   '/img',                          // optional, default '/img'
  focusSecret:   process.env.FOCUS_SECRET!,
  eventManager,                                   // optional, receives thumbnail:generated
});
```

| Option          | Default  | Meaning                                                                 |
|-----------------|----------|-------------------------------------------------------------------------|
| `attachments`   | —        | The `defineAttachments` result. The source image is read from the category's provider (resolved by the code in the group id). |
| `variants`      | —        | Variant map; the allowed sizes are derived from it.                     |
| `thumbProvider` | —        | Where generated thumbnails are cached.                                  |
| `thumbPrefix`   | `'/img'` | URL prefix of thumbnails.                                               |
| `focusSecret`   | —        | Secret for manual-focus hashes (same as for `createFocusHash`).         |
| `eventManager`  | —        | Receives `thumbnail:generated`.                                         |

There is no `sourceProvider` option. The request is validated before the cache is touched:

| Case                                                              | Status |
|-------------------------------------------------------------------|--------|
| Malformed path, group id, version (`[a-z0-9]+`) or filename, mode segment not in the strict format, unknown category code | 404 |
| Size not derived from `variants`                                  | 400    |
| Focus hash does not match                                         | 403    |
| Category has `authorize` and it returns `false`                   | 403    |
| Original file missing (cached thumbnails of deleted files are not served) | 404 |
| Generation failed                                                 | 500    |

Thumbnails are served as WebP with `X-Content-Type-Options: nosniff` and `Cache-Control: public, max-age=31536000, immutable`. Categories with `authorize` get thumbnails too: `authorize` runs for every thumbnail request, and the response is `Cache-Control: private, no-store`. Their thumbnails are still cached in `thumbProvider`, so a reverse proxy serving the cache directly must serve only public codes (see [Serving Files](serving.md) and [Access Control](access-control.md)).

The thumbnails are produced by `generateImage(source, mode, width?, height?)` (exported; returns a WebP `Buffer`), which applies EXIF orientation first and never enlarges.

---

## Animated images

For animated GIFs and animated WebP, `e` (entropy) and `a` (attention) are silently downgraded to `c` (centre) — they rely on single-frame analysis and produce inconsistent results across frames. Manual focus is always preserved.

---

## Event: `thumbnail:generated`

When `eventManager` is passed to `createImageServer`, the image server calls its `trigger` with `thumbnail:generated` after a new thumbnail is generated and cached (not on cache hits) — useful for monitoring:

```ts
// payload
{ type: 'thumbnail:generated', groupId, filename, modeSeg }
```
