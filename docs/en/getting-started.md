# Getting Started

## What it does

- Attaches files to any Prisma entity via a `Json?` column called `attachments`
- Supports multiple **categories** per entity (e.g. `avatar`, `gallery`, `documents`)
- Validates and transforms uploads via a composable **middleware pipeline**
- Generates cache-busted serving URLs automatically
- Provides on-demand **thumbnail generation** for images (WebP output, flat disk cache)
- Ships a typed **client-side handler** that reads entity data directly — no extra API call

## Installation

```sh
npm install @atom-forge/attachment
```

### Peer dependencies

| Package          | Version  | Required by                                    |
|------------------|----------|------------------------------------------------|
| `sharp`          | `>=0.32` | `toWebP()`, `imgstat()`, `generateThumbnail()` |
| `music-metadata` | `>=11`   | `getMp3Duration()`                             |
| `zod`            | `>=4`    | schema validation middleware                   |

Peer deps are optional at the package level — import only what you use.

---

## 1. Define your attachment schema

```ts
import { defineAttachments, count, mime, toWebP, imgstat } from '@atom-forge/attachment';
import { createLocalProvider } from '@atom-forge/attachment';

const attachments = defineAttachments({
  user: defineAttachments.entity({
    avatar:  [count(1), mime('image/*'), toWebP(80, 400, 400), imgstat()],
    gallery: [mime('image/*'), toWebP(80)],
  }, { idField: 'neptunCode' }),

  course: defineAttachments.entity({
    avatar: [count(1), mime(['image/jpeg', 'image/png', 'image/webp'])],
  }),
}, {
  provider:    createLocalProvider('./var/uploads'),
  servePrefix: '/file',
  // nextGroupId: optional — defaults to crypto.randomUUID() → base36
  // Override if you need deterministic or DB-backed group IDs:
  // nextGroupId: async (entityType, entityId, category) => myIdGenerator(...)
});
```

`defineAttachments.entity(categories, options?)` defines one entity type.
`idField` tells the handler which field on the entity is the primary key (default: `'id'`).

---

## 2. Upload a file

```ts
const userRecord = await prisma.user.findUniqueOrThrow({ where: { neptunCode } });
const h = attachments.user(userRecord);

const { attachment, rollback } = await h.avatar.add(uploadedFile, {});
try {
  await prisma.user.update({
    where: { neptunCode },
    data:  { attachments: userRecord.attachments as object },
  });
} catch (err) {
  await rollback();   // deletes the physical file on DB failure
  throw err;
}
```

The handler **mutates `entity.attachments` in-place** — you must call `prisma.update` yourself to persist.

---

## 3. Read files on the server

```ts
const h = attachments.user(userRecord);

h.avatar.list()           // AttachmentData[]
h.avatar.get('photo.jpg') // AttachmentData | undefined
```

---

## 4. Client-side handler

The client-side handler reads the entity's `attachments` JSON directly — no server round-trip required.

```ts
import { makeAttachmentHandler } from '@atom-forge/attachment/client';
import { imageVariants } from './image-variants.js';

const h = makeAttachmentHandler(imageVariants, { servePrefix: '/file', thumbPrefix: '/img' });

const item = h.course(course).avatar.first;  // ItemView | undefined
const all  = h.user(user).gallery.all;       // ItemView[]

item?.filename          // 'photo.jpg'
item?.url               // '/file/abc123-3/photo.jpg'
item?.meta              // unknown — cast to your meta type
item?.img.avatar()      // '/img/abc123-3/e.400x400/photo.jpg.webp'
item?.img.avatar(2)     // '/img/abc123-3/e.800x800/photo.jpg.webp'  (2x retina)
```

> In browser/SSR components import from `@atom-forge/attachment/client`. The main package re-exports Node.js server modules.
