# Getting Started — LLM Reference

## Install
```sh
npm install @atom-forge/attachment
```
Peer deps (optional): `sharp >=0.32`, `music-metadata >=11`, `zod >=4`

## Define schema
```ts
import { defineAttachments, createLocalProvider } from '@atom-forge/attachment';

const attachments = defineAttachments(
  {
    user:   defineAttachments.entity({ avatar: [mw1, mw2], gallery: [] }, { idField: 'neptunCode' }),
    course: defineAttachments.entity({ avatar: [mw1] }),
  },
  {
    provider:    createLocalProvider('./var/uploads'),
    servePrefix: '/file',          // optional, default '/file'
    nextGroupId: async (...) => …, // optional, default: crypto.randomUUID() → base36
    sanitize:    true,             // optional: false | true | fn, default true
    findUnique:  (existing, name) => …, // optional, default base(n)ext
    eventManager: myBus,          // optional
  }
);
```

## Upload
```ts
const h = attachments.user(entity); // entity must have .attachments from DB
const { attachment, rollback } = await h.avatar.add(file, meta);
// → mutates entity.attachments in-place; persist with prisma.update
// → rollback() deletes the physical file on DB failure
```

## Read (server)
```ts
h.avatar.list()           // AttachmentData[]
h.avatar.get('photo.jpg') // AttachmentData | undefined
```

## Read (client)
```ts
import { makeAttachmentHandler } from '@atom-forge/attachment/client-handler';
const h = makeAttachmentHandler(imageVariants, { servePrefix: '/file', thumbPrefix: '/img' });
h.course(entity).avatar.first    // ItemView | undefined
h.user(entity).gallery.all       // ItemView[]
item.url                         // '/file/{gid}-{v}/{filename}'
item.img.avatar()                // '/img/{gid}-{v}/e.400x400/{filename}.webp'
item.img.avatar(2)               // 2x density
```

---

# Handler API — LLM Reference

## Create
```ts
const h = attachments.entityType(dbEntity);
```

## Read
```ts
h.cat.list()            // AttachmentData[]
h.cat.get(filename)     // AttachmentData | undefined
```

## Write — all mutate entity.attachments; persist with prisma.update
```ts
// add — runs middleware, sanitizes name, resolves collisions, bumps version
const { attachment, rollback } = await h.cat.add(file, meta);

// replace — overwrites file in-place, bumps version → new URL
const { attachment, rollback } = await h.cat.replace(filename, file, meta);

// updateMeta — no file I/O, bumps version
const updated = await h.cat.updateMeta(filename, meta);

// rename — sanitizes newName, throws on collision
await h.cat.rename(oldName, newName);

// delete — removes file + record, no version bump
await h.cat.delete(filename);

// reorder — JSON only, no file I/O
h.cat.reorder([filename1, filename2]);
```

## Purge (entity level)
```ts
await h.purge(); // deletes all files across all categories; sets entity.attachments = {}
```

## Rollback
```ts
const { rollback } = await h.cat.add(file, meta);
try { await prisma.update(...) } catch { await rollback(); throw; }
```

## AttachmentData shape
```ts
{ filename, version, groupId, size, uploadedAt, meta, url }
// url = /{servePrefix}/{groupId}-{version}/{filename}  — computed, never stored
```

## DefineAttachmentsOptions
| Option         | Type                                          | Default       |
|----------------|-----------------------------------------------|---------------|
| `provider`     | `StorageProvider`                             | —             |
| `servePrefix`  | `string`                                      | `'/file'`     |
| `nextGroupId`  | `(entityType, entityId, cat) => Promise<string>` | UUID→base36 |
| `sanitize`     | `false \| true \| fn`                         | `true`        |
| `findUnique`   | `(existing, name) => string`                  | `base(n)ext`  |
| `eventManager` | `EventEmitter`                                | —             |

---

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

---

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

---

# Storage — LLM Reference

## JSON column shape
```ts
// entity.attachments: Record<category, CategoryStore>
interface CategoryStore {
  i: string;   // groupId (base36, UUID→base36 on first add)
  v: number;   // version counter (monotonically increasing)
  f: AttachmentItem[];
}
interface AttachmentItem {
  n: string;   // filename
  v: string;   // version (base36)
  s: number;   // size bytes
  t: number;   // uploadedAt Unix epoch
  x: unknown;  // meta
}
```

## StorageProvider interface
```ts
interface StorageProvider {
  save(path, file):         Promise<void>;
  read(path):               Promise<Buffer>;
  stream(path):             ReadableStream<Uint8Array>;
  delete(path):             Promise<void>;
  exists(path):             Promise<boolean>;
  rename(old, new):         Promise<void>;
  setEventManager?(em):     void;
}
```

## Physical paths
```
local:  {shard}/{groupId}/{filename}   shard = groupId.slice(0,2)
S3:     {groupId}/{filename}           no shard
```
replace = overwrite in-place → same path, version bumped → new URL

## Local provider
```ts
import { createLocalProvider } from '@atom-forge/attachment';
createLocalProvider('./var/uploads')  // uses Node fs/promises, no extra deps
```

## S3/MinIO provider
```ts
import { createS3Provider } from '@atom-forge/attachment';
createS3Provider({
  bucket, region,
  endpoint:       'http://minio:9000',  // MinIO only
  forcePathStyle: true,                 // MinIO only
  accessKeyId, secretAccessKey,
})
// saves always set Cache-Control: immutable
// rename = CopyObject + DeleteObject (not atomic)
// dep: @aws-sdk/client-s3
```

## Event system
```ts
interface EventEmitter { trigger(event: AttachmentEvent): void }

// attach:
defineAttachments({...}, { provider, eventManager: myBus })
```

Events from `defineAttachments`:
```
attachment:add            entityType, entityId, category, groupId, attachment
attachment:replace        …, oldAttachment, attachment
attachment:delete         entityType, entityId, category, groupId, filename
attachment:rename         …, oldName, newName
attachment:meta-updated   entityType, entityId, category, groupId, attachment
attachment:purge          entityType, entityId
```

Events from S3 provider:
```
storage:rename-cleanup-failed   oldPath, newPath, error
```

## Prisma middleware
```ts
import { createPrismaMiddleware } from '@atom-forge/attachment';
prisma.$use(createPrismaMiddleware(eventManager));
// fires entity:deleted { model, entity } on every prisma delete
```

---

# Serving Files — LLM Reference

## Handler interface
```ts
(pathname: string) => Promise<Response | null>
// null = path doesn't match prefix → pass to framework
```

## URL schemas
```
/file/{groupId}-{version}/{filename}
/img/{groupId}-{version}/{modeSeg}/{filename}.webp
```

## Framework wiring
```ts
// SvelteKit hooks.server.ts
export const handle: Handle = ({ event, resolve }) =>
  fileServer(event.url.pathname) ?? imageServer(event.url.pathname) ?? resolve(event);

// Hono
app.use('/file/*', (c, next) => fileServer(new URL(c.req.url).pathname) ?? next());

// Express — needs Web Response adapter (res.status/setHeader/end)

// Next.js middleware.ts
export async function middleware(req: NextRequest) {
  return fileServer(req.nextUrl.pathname) ?? imageServer(req.nextUrl.pathname) ?? NextResponse.next();
}
export const config = { matcher: ['/file/:path*', '/img/:path*'] };

// Nuxt server/middleware/attachments.ts
export default defineEventHandler(async (event) => {
  const r = await fileServer(event.path) ?? await imageServer(event.path);
  if (!r) return;
  setResponseStatus(event, r.status);
  for (const [k, v] of r.headers) setResponseHeader(event, k, v);
  return send(event, Buffer.from(await r.arrayBuffer()));
});
```

## Proxy path derivation
```
/file/abc123-3/photo.jpg
  local  → /var/uploads/ab/abc123/photo.jpg  (shard = first 2 chars)
  S3     → abc123/photo.jpg  (no shard)

/img/abc123-3/e.400x400/photo.jpg.webp
  flat key → abc123-3.e.400x400.photo.jpg.webp
```

## Nginx snippets
```nginx
# local /file
location ~ "^/file/(?<shard>[a-z0-9]{2})(?<rest>[a-z0-9]*)-[a-z0-9]+/(?<f>.+)$" {
    alias /var/uploads/$shard/$shard$rest/$f;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

# local /img — serve flat key or generate
location ~ "^/img/([^/]+)/([^/]+)/(.+)$" {
    root /var/thumb;
    try_files /$1.$2.$3 @generate;
}
location @generate { proxy_pass http://localhost:3000; }

# S3 /file
location ~ "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$" {
    rewrite ^ /$1/$2 break;
    proxy_pass https://my-bucket.s3.region.amazonaws.com;
}

# S3/MinIO /img
location ~ "^/img/([^/]+)/([^/]+)/(.+)$" {
    rewrite ^ /my-thumbs/$1.$2.$3 break;
    proxy_pass http://minio:9000;
    proxy_intercept_errors on;
    error_page 404 = @generate;
}
location @generate { proxy_pass http://localhost:3000$request_uri; }
```

## Thumbnail cleanup
```sh
# local — cron
find /var/thumb -type f -atime +30 -delete

# S3/MinIO — lifecycle rule (run once)
aws s3api put-bucket-lifecycle-configuration --bucket my-thumbs \
  --lifecycle-configuration '{"Rules":[{"ID":"expire","Status":"Enabled","Filter":{},"Expiration":{"Days":30}}]}'
mc ilm add --expiry-days 30 myminio/my-thumbs
```

## Env vars
```
UPLOAD_DIR    ./var/uploads    root for uploaded files
SERVE_PREFIX  /file            raw file URL prefix
THUMB_DIR     ./var/thumb      thumbnail cache dir
THUMB_PREFIX  /img             thumbnail URL prefix
FOCUS_SECRET  (required)       HMAC secret for manual focus hash
```