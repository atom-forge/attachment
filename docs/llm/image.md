# Image Handling — LLM Reference

## Variant map
```ts
const variants = {
  thumb:  { w: 200, h: 200 },
  avatar: { w: 400, h: 400 },
  wide:   { w: 800 },           // width-only → proportional
  tall:   { h: 400 },           // height-only → proportional
} satisfies ImageVariantMap;
```
Server derives 1×/2×/3× sizes automatically. Changing variants updates allowlist immediately.

## Thumbnail URL
```
/{thumbPrefix}/{groupId}-{version}/{modeSeg}/{filename}.webp
```
modeSeg formats:
- `e.400x400` — named mode (e=entropy, a=attention, c=centre, b=box)
- `0s0s0o0o0o7s.400x400.ab1c` — manual focus (focus12.WxH.hash4)
- size: `400x400` fixed | `400x0` width-only | `0x400` height-only

## Density
Client multiplies variant dims by density before building URL. Server has no density concept.
`avatar @2x` → `e.800x800`

## URL builders
```ts
// type-safe, any AttachmentData, no ImgStat needed
buildVariantUrl(variants, attachment, 'avatar')        // 1x, entropy fallback
buildVariantUrl(variants, attachment, 'avatar', 2)     // 2x
buildVariantUrl(variants, attachment, 'thumb', 1, 'c') // force centre

// low-level
buildThumbnailUrl(attachment, 400, 400)       // uses meta.img.c
buildThumbnailUrl(attachment, 400, 400, 'e')  // explicit mode
buildThumbnailUrl(attachment, 400, 0, 'a')    // width-only
```
Mode resolution: explicit arg → `meta.img.c` → `'e'`

## Client handler (browser-safe)
```ts
// import from leaf, NOT barrel (barrel re-exports Node modules)
import { makeAttachmentHandler } from '@atom-forge/attachment/client-handler';
const h = makeAttachmentHandler(variants, { servePrefix: '/file', thumbPrefix: '/img' });

h.entity(dbRow).cat.first        // ItemView | undefined
h.entity(dbRow).cat.all          // ItemView[]
h.entity(dbRow).cat.last
h.entity(dbRow).cat.find('*.jpg') // glob filter
item.url / item.filename / item.meta
item.img.avatar()    // 1x
item.img.avatar(2)   // 2x
item.img.thumb(1, 'c') // force mode
```

## Animated images
Animated GIF/WebP: e and a crop modes silently downgraded to c. Manual focus always preserved.