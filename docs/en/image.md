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
```

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
| `b`  | box / contain (no enlarge) |

**Size notation:** `400x400` = fixed, `400x0` = width-only, `0x400` = height-only.

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

Type-safe URL builder. Accepts any `AttachmentData<unknown>` — no `ImgStat` required.

```ts
import { buildVariantUrl } from '@atom-forge/attachment';

buildVariantUrl(imageVariants, attachment, 'avatar')         // 1x, entropy fallback
buildVariantUrl(imageVariants, attachment, 'avatar', 2)      // 2x
buildVariantUrl(imageVariants, attachment, 'thumb', 1, 'c')  // centre crop
```

Mode resolution: explicit arg → `meta.img.c` (if stored by `imgstat`) → `'e'`.

---

## `buildThumbnailUrl(attachment, width, height, mode?, prefix?)`

Low-level builder. Requires `AttachmentData<{ img: ImgStat }>` when `mode` is omitted.

```ts
import { buildThumbnailUrl } from '@atom-forge/attachment';

buildThumbnailUrl(attachment, 400, 400)        // uses meta.img.c
buildThumbnailUrl(attachment, 400, 400, 'e')   // explicit mode
buildThumbnailUrl(attachment, 400, 0, 'a')     // width-only
```

For manual focus, `meta.img.ch` must be present (populated by `imgstat` + `FocusHashFn`).

---

## `makeAttachmentHandler<M, V>(variants, options?)`

Client-side factory. Reads the entity's `attachments` JSON field directly — no server round-trip.

```ts
import { makeAttachmentHandler } from '@atom-forge/attachment/client-handler';

const h = makeAttachmentHandler(imageVariants);
// options: { servePrefix?: string, thumbPrefix?: string }  (defaults: '/file', '/img')

const item = h.course(course).avatar.first;   // ItemView | undefined
const all  = h.user(user).gallery.all;        // ItemView[]

item?.filename          // 'photo.jpg'
item?.url               // '/file/abc123-3/photo.jpg'
item?.meta              // unknown (cast as needed)
item?.img.avatar()      // '/img/abc123-3/e.400x400/photo.jpg.webp'
item?.img.avatar(2)     // '/img/abc123-3/e.800x800/photo.jpg.webp'
item?.img.thumb(1, 'c') // '/img/abc123-3/c.200x200/photo.jpg.webp'

h.user(user).gallery.find('*.jpg')    // ItemView[] — glob filter
h.user(user).gallery.last?.img.wide(2)
```

---

## Animated images

For animated GIFs and animated WebP, `e` (entropy) and `a` (attention) are silently downgraded to `c` (centre) — they rely on single-frame analysis and produce inconsistent results across frames. Manual focus is always preserved.

---

## Event: `thumbnail:generated`

The image server optionally fires `thumbnail:generated` after writing a cache file — useful for monitoring or pre-warming:

```ts
// payload
{ type: 'thumbnail:generated', groupId, filename, modeSeg }
```