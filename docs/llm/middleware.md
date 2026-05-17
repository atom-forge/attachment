# Middleware — LLM Reference

```ts
type UploadMiddleware<TMeta> = (file, meta, existingFiles) => Promise<{ file, meta }>
// throw AttachmentValidationError to reject upload
```

## Validators
```ts
count(max)                         // reject if category already has >= max files
size(bytes)                        // reject if file.size > bytes
sumSize(bytes)                     // reject if sum(existing) + file.size > bytes
mime('image/*')                    // reject non-matching MIME (supports wildcards)
mime(['image/jpeg', 'image/png'])  // explicit list
ext(['.jpg', '.png'])              // reject non-matching extension (case-insensitive)
```

## Transformers (peer deps required)
```ts
// sharp required:
toWebP()                 // lossless WebP, no resize
toWebP(80)               // lossy q80
toWebP(false, 1280)      // lossless, max-width 1280 (proportional)
toWebP(80, 800, 600)     // lossy q80, contain in 800×600

imgstat()                // inject meta.img: ImgStat, entropy crop default
imgstat('a')             // attention crop
imgstat('c')             // centre crop
imgstat(focusPoint)      // manual focus: { x, y, s: { x, y, w, h } } (0-1000 permille)

// music-metadata required:
getMp3Duration()         // inject meta.duration (seconds)
getMp3Duration('key')    // inject meta.key
```

## ImgStat shape
```ts
{ w: number, h: number, d: string, a: boolean, c: 'e'|'a'|'c'|Focus, ch?: string }
// d = '#rrggbb', a = animated, ch = HMAC of focus12 (manual focus only)
// meta.img not typed in TMeta — cast: attachment.meta as { img: ImgStat }
```

## Name helpers
```ts
randname()   // replace filename with UUID, keep extension — no deps
```
