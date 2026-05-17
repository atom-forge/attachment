# Upload Middleware

Middlewares run in order before `add()` and `replace()`. Throw `AttachmentValidationError` to abort the upload.

```ts
type UploadMiddleware<TMeta = unknown> = (
  file:  File,
  meta:  TMeta,
  files: AttachmentData<TMeta>[],   // existing files in the category
) => Promise<{ file: File; meta: TMeta }>;
```

---

## Validators

### `count(max)`

Rejects the upload when the category already has `max` or more files.

```ts
count(1)   // at most one file (avatar use case)
count(10)  // at most ten
```

### `size(maxBytes)`

Rejects files larger than `maxBytes`.

```ts
size(2 * 1024 * 1024)   // 2 MB
```

### `sumSize(maxBytes)`

Rejects when total size of all existing files + the new file exceeds `maxBytes`.

```ts
sumSize(50 * 1024 * 1024)   // 50 MB total for the category
```

### `mime(pattern)`

Allows only files whose MIME type matches. Supports wildcard subtypes.

```ts
mime('image/*')
mime(['image/jpeg', 'image/png', 'image/webp'])
```

### `ext(extensions)`

Allows only files with a matching extension (case-insensitive, leading dot required).

```ts
ext(['.jpg', '.jpeg', '.png', '.webp'])
```

---

## Transformers

Require peer dependencies (`sharp`, `music-metadata`).

### `toWebP(lossy?, width?, height?)`

Converts the uploaded image to WebP.

| Param    | Type              | Default | Description                                                  |
|----------|-------------------|---------|--------------------------------------------------------------|
| `lossy`  | `false \| number` | `false` | `false` = lossless; `0–100` = lossy quality                  |
| `width`  | `number`          | —       | Max width. One dimension → proportional resize (no enlarge). Both → contain. |
| `height` | `number`          | —       | Max height.                                                  |

```ts
toWebP()              // lossless, no resize
toWebP(80)            // lossy q80
toWebP(false, 1280)   // lossless, max-width 1280
toWebP(80, 800, 600)  // lossy q80, contain in 800×600
```

Peer dependency: `sharp`

### `imgstat(cropMode?, focusHash?)`

Reads image dimensions, dominant color, animated flag, and crop mode. Injects an `ImgStat` object into `meta.img`.

| Param       | Type                          | Default | Description                                      |
|-------------|-------------------------------|---------|--------------------------------------------------|
| `cropMode`  | `'e' \| 'a' \| 'c' \| Focus` | `'e'`   | Crop strategy stored for thumbnail URL building  |
| `focusHash` | `FocusHashFn`                 | —       | Required to store `meta.img.ch` for manual focus |

```ts
imgstat()        // entropy crop (default)
imgstat('a')     // attention crop
imgstat('c')     // centre crop
imgstat({ x: 500, y: 300, s: { x: 0, y: 0, w: 1000, h: 1000 } })  // manual focus
```

The injected `ImgStat`:

```ts
interface ImgStat {
  w:   number;                    // width px
  h:   number;                    // height px
  d:   string;                    // dominant color (#rrggbb)
  a:   boolean;                   // animated (GIF / animated WebP)
  c:   'e' | 'a' | 'c' | Focus;  // stored crop mode
  ch?: string;                    // HMAC hash of focus12 (manual focus only)
}
```

`meta.img` is not reflected in `TMeta` at compile time — cast at the call site:

```ts
const meta = attachment.meta as { img: ImgStat };
```

Peer dependency: `sharp`

### `getMp3Duration(metaKey?)`

Reads the duration of an MP3 and injects it into `meta[metaKey]` (seconds, number). Default `metaKey`: `'duration'`.

```ts
getMp3Duration()                  // → meta.duration
getMp3Duration('durationSeconds') // → meta.durationSeconds
```

Peer dependency: `music-metadata`

---

## Name helpers

### `randname()`

Replaces the uploaded filename with a random UUID-based name, keeping the extension.

```ts
randname()
// 'photo.jpg' → 'f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg'
```

No extra dependency — uses `crypto.randomUUID()`.
