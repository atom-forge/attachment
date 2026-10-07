# @atom-forge/attachment — AI Guide

Start here when using or modifying this package. This guide covers the mental model and critical rules; follow the links below for the full English documentation. When documentation and implementation disagree, check the public exports and source before proposing code.

## Mental model

A framework-agnostic attachment system for Prisma entities, with local or S3/MinIO storage.

- Each entity has an `attachments Json?` column; no separate attachment table is needed.
- `defineAttachments` declares entity types and their attachment categories (such as `avatar` or `documents`). Each category has an ordered upload middleware pipeline.
- Server handlers read and mutate the entity's attachment JSON. The application owns database persistence.
- Storage providers manage physical files separately from the database. File and image servers return Web `Response` objects; the application integrates them with its framework.
- The browser-safe client handler reads the same JSON and builds file/thumbnail URLs without an extra metadata request.

## Critical rules

1. **Load and persist `attachments` explicitly.** Pass an entity containing its current `attachments` field to the server handler. After every mutation, save that field yourself. The library does not perform Prisma updates or coordinate concurrent writers.
2. **Storage and database writes are not one transaction.** `add` and `replace` return `rollback()`, which deletes the written physical file only. It does not restore the mutated JSON or undo emitted events. `replace` overwrites the original file; rollback does not recover it. After failed persistence, discard/reload the mutated entity and plan recovery for destructive operations.
3. **Use the correct entry point.** Server code imports from `@atom-forge/attachment`; browser code and shared UI components import from `@atom-forge/attachment/client`. Do not pull Node.js storage or image-processing modules into the browser bundle.
4. **Await asynchronous operations.** `add`, `replace`, `rename`, `delete`, and entity-level `purge` are asynchronous. `list`, `get`, `updateMeta`, and `reorder` are synchronous. Serving handlers return `Promise<Response | null>`: await each result before applying a `null` fallback.
5. **Keep URLs separate from storage paths.** Public attachment data includes a computed `url`; do not persist it into the compact JSON store. Versions provide cache-busting URLs, not historical file storage. `replace` writes to the same physical path with a new version.
6. **Middleware runs in declaration order.** Each step receives the previous step's file and metadata. Validate before transformations when limits should apply to the original upload. Use `AttachmentValidationError` to reject uploads. Replacement middleware sees the category's other files, excluding the replaced item.
7. **Use one shared image variant map.** Keep client URL generation and the image server's allowed sizes aligned. The client multiplies dimensions for 1×/2×/3× density; URL generation alone does not configure thumbnail serving. Manual-focus URLs require the server's focus-hash/secret configuration.
8. **Configure serving and access control in the application.** Generated URLs do not mount routes or provide application authorization. Match `servePrefix`/`thumbPrefix` across handlers, servers, and proxies; adapt Web responses where the framework requires it.

## Minimal usage

Install:

```sh
npm install @atom-forge/attachment
```

The declared peer dependencies are `sharp >=0.32.0`, `music-metadata >=11.12.0`, and `zod >=4.0.0`. Image processing uses `sharp`; MP3 metadata extraction uses `music-metadata`. See [middleware](docs/en/middleware.md) for feature-specific requirements.

### Define server categories

Add `attachments Json?` to the application's Prisma model, then configure the handler:

```ts
import {
  defineAttachments,
  createLocalProvider,
  count,
  mime,
  size,
} from '@atom-forge/attachment';

export const attachments = defineAttachments({
  user: defineAttachments.entity({
    avatar: [count(1), mime('image/*'), size(5 * 1024 * 1024)],
    documents: [],
  }),
}, {
  provider: createLocalProvider('./var/uploads'),
  servePrefix: '/file',
});
```

The entity ID field defaults to `id`; use `defineAttachments.entity(categories, { idField: 'yourKey' })` for a different key. Empty middleware arrays impose no upload validation.

### Upload and persist

In application server code, with a configured Prisma client, a user ID, and an uploaded Web `File`:

```ts
const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
const h = attachments.user(user);
const { attachment, rollback } = await h.avatar.add(uploadedFile, {});

try {
  await prisma.user.update({
    where: { id: user.id },
    data: { attachments: user.attachments as object },
  });
} catch (error) {
  await rollback();
  // Discard/reload user: rollback does not restore its attachment JSON.
  throw error;
}

h.avatar.list();                    // AttachmentData[]
h.avatar.get(attachment.filename); // AttachmentData | undefined
```

Other mutations: `replace(filename, file, meta)`, `updateMeta(filename, meta)`, `rename(oldName, newName)`, `delete(filename)`, `reorder(filenames)`, and entity-level `h.purge()`. Persist the resulting JSON after each. See [handler API](docs/en/handler-api.md) for semantics and errors.

### Read in the client

```ts
import { makeAttachmentHandler } from '@atom-forge/attachment/client';

const variants = { avatar: { w: 400, h: 400 } };
const client = makeAttachmentHandler(variants, {
  servePrefix: '/file',
  thumbPrefix: '/img',
});

// user is the entity returned by the application, including attachments.
const item = client.user(user).avatar.first;
item?.url;           // Original file URL
item?.img.avatar();  // 400×400 thumbnail URL
item?.img.avatar(2); // 800×800 thumbnail URL
```

Image URLs need an image server or equivalent proxy setup. Configure that server with the same variant map; add `imgstat()` to the upload pipeline when image metadata and crop information are needed. See [image handling](docs/en/image.md).

### Wire serving into the framework

After configuring `fileServer` and `imageServer`, the fallback must await their results:

```ts
const response = await fileServer(pathname) ?? await imageServer(pathname);
if (response) return response;
// Otherwise continue with the framework's normal request handling.
```

See [serving files](docs/en/serving.md) for server constructors, framework adapters, proxy configuration, caching, and thumbnail cleanup.

## Detailed English documentation

| Topic | Read for |
| --- | --- |
| [Getting started](docs/en/getting-started.md) | Installation, Prisma model integration, category definitions, first upload |
| [Handler API](docs/en/handler-api.md) | Reads, mutations, persistence, rollback, configuration options |
| [Middleware](docs/en/middleware.md) | Validators, transformations, image/audio metadata, custom pipelines |
| [Image handling](docs/en/image.md) | Variants, crop modes, focus, density, URL builders, client views |
| [Storage](docs/en/storage.md) | Compact JSON format, provider contract, local/S3 storage, events, Prisma middleware |
| [Serving files](docs/en/serving.md) | File/image servers, framework integration, proxies, cache cleanup |

## Working on this repository

- Public server exports: `src/index.ts`. Browser-safe exports: `src/client.ts`.
- Handler behavior: `src/define-attachments.ts`; shared contracts and stored shapes: `src/types.ts`.
- Make focused changes; keep runtime behavior, public types, and relevant documentation consistent. Do not add a new API based only on an outdated example.
- Run `npx tsc --noEmit` for a non-emitting type check. `npm run build` rebuilds `dist` (removes it first). There is currently no test script in `package.json`.
- When changing package contents, check the `files` allowlist in `package.json`. Do not commit or release unless requested.
