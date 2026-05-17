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