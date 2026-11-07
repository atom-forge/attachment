# @atom-forge/attachment — AI Guide

Start here when using or modifying this package. This guide covers the mental model and critical rules; follow the links below for the full English documentation. When documentation and implementation disagree, check the public exports and source before proposing code.

## Mental model

A framework-agnostic attachment system for Prisma entities, with local or S3/MinIO storage.

- Each entity has an `attachments Json?` column; no separate attachment table is needed.
- `defineAttachments` declares entity types and their attachment categories (such as `avatar` or `documents`). Each category is an object with a mandatory two-character `code` (`[A-Z0-9]`, unique across the whole `defineAttachments` call), an ordered upload `middlewares` pipeline, an optional `authorize` hook and an optional per-category storage `provider`.
- Each category store has a composite group id `{random}-{CODE}-{entityId36}` (e.g. `k3x9q-PD-39x9`), which is also its storage folder and part of every URL. From the code the servers find the category, its provider and `authorize`; the entity id is the owner. Attachments can only be added to a saved entity whose id matches the entity's `idType` (`'int'` default, or `'uuid'`).
- Server handlers read and mutate the entity's attachment JSON. The application owns database persistence.
- Storage providers manage physical files separately from the database. File and image servers take the `defineAttachments` result (`attachments`) and read each file through its category's provider; they work on Web `Request`/`Response` and the application integrates them with its framework.
- Access control is uniform: a category is access-controlled only if it has `authorize` (checked on every file and thumbnail request, served `private, no-store`), and public only as far as the reverse proxy serves it directly. The proxy serves only an allow-list of public codes (`publicCodes(attachments)`); everything else goes to the app.
- The browser-safe client handler reads the same JSON and builds file/thumbnail URLs without an extra metadata request.

## Critical rules

1. **Load and persist `attachments` explicitly — unless atomic mode is on.** Pass an entity containing its current `attachments` field to the server handler. In the default mode, save that field yourself after every mutation; the library does not coordinate concurrent writers. In **atomic mode** (`atomic` option on `defineAttachments` or on one entity) the library saves every change itself through the app's `atomic(ctx, mutate)` function, which must read the column, apply the pure `mutate`, write and return the result with no other write in between (row lock or compare-and-set; `mutate` may run more than once). Then never write the column yourself or save a whole loaded row over it. See [concurrent writes](docs/en/concurrency.md).
2. **Storage and database writes are not one transaction.** In the default mode `add` and `replace` return `rollback()`, which undoes only the storage change: it deletes the file `add` wrote, or restores the original file `replace` overwrote (kept in memory until then). It does not restore the mutated JSON or undo emitted events. After failed persistence, discard/reload the mutated entity. Async mutations (`add`, `replace`, `rename`, `delete`, `purge`) on the same entity object run one after another; separately loaded copies of the same record are not coordinated. In atomic mode there is no `rollback`: files are written first (never overwriting: `create`/`copy`/`replaceIf` provider methods), the list is changed in one atomic step, rejected changes delete their new file, and unlisted files older than `orphanAge` (default 86400 s) are swept after later changes of the group. `count()`/`sumSize()` re-check on the fresh list via the middleware's optional `check` part; custom limits that depend on other files need one.
3. **Use the correct entry point.** Server code imports from `@atom-forge/attachment`; browser code and shared UI components import from `@atom-forge/attachment/client`. Do not pull Node.js storage or image-processing modules into the browser bundle.
4. **Await asynchronous operations.** `add`, `replace`, `rename`, `delete`, and entity-level `purge` are asynchronous. `list` and `get` are synchronous; `updateMeta` and `reorder` are synchronous in the default mode and asynchronous in atomic mode. In atomic mode `add`/`replace` resolve to the `AttachmentData` itself. File and image servers expose `match(request)` (sync) and `handle(request)` (returns `Promise<Response>`): check `match` first, then await `handle`.
5. **Keep URLs separate from storage paths.** Public attachment data includes a computed `url`; do not persist it into the compact JSON store. Versions (base36 counter + random suffix) provide cache-busting URLs, not historical file storage. `replace` writes to the same physical path with a new version. Never construct or rewrite group ids by hand: legacy (plain random) group ids are rejected by `add`/`replace` and answered with 404 by the servers.
6. **Middleware runs in declaration order.** Each step receives the previous step's file and metadata. Validate before transformations when limits should apply to the original upload. Use `AttachmentValidationError` to reject uploads. Replacement middleware sees the category's other files, excluding the replaced item.
7. **Use one shared image variant map.** Keep client URL generation and the image server's allowed sizes aligned. The client multiplies dimensions for 1×/2×/3× density; URL generation alone does not configure thumbnail serving. Crop modes are `'e'`, `'a'`, `'c'`, `'b'` or a `Focus` point; manual-focus URLs need `meta.img.ch`, produced by `imgstat(focus, createFocusHash(secret))` with the same secret as `createImageServer({ focusSecret })`.
8. **Configure serving and access control in the application.** Generated URLs do not mount routes. Files of categories without `authorize` are protected only by their unguessable URL; for per-request authorization add `authorize` to the category. Both servers take `{ attachments }` (no `uploadDir`, `sourceProvider` or drivers). The reverse proxy may serve directly only the codes from `publicCodes(attachments)`; never put a code with `authorize` on that list, because the proxy would bypass `authorize`. If a bucket/prefix is anonymously readable, give authorized categories a separate non-public `provider`. Match `servePrefix`/`thumbPrefix` across handlers, servers, and proxies; adapt Web responses where the framework requires it.
9. **Wire file cleanup to entity deletion.** `createPrismaExtension(eventManager)` (via `prisma.$extends`) fires `entity:deleted` after a single-record `delete`; handle it in the app's own emitter (the library's `EventEmitter` only has `trigger`) by building the handler from the deleted entity and calling `purge()` — do not update the deleted row. `deleteMany` is not covered: load the records and purge them first. `purge()` is best effort and throws with an `errors` array if some files could not be deleted. `createPrismaMiddleware` (`$use`) is deprecated.

## Minimal usage

Install:

```sh
npm install @atom-forge/attachment
```

The declared peer dependencies are `sharp >=0.32.0` and `music-metadata >=11.12.0`. Image processing uses `sharp`; MP3 metadata extraction uses `music-metadata`. See [middleware](docs/en/middleware.md) for feature-specific requirements.

`sharp` and `music-metadata` are optional peers: install them only for the features that use them.

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
    avatar:    { code: 'AV', middlewares: [count(1), mime('image/*'), size(5 * 1024 * 1024)] },
    documents: { code: 'DO' },
    contracts: {
      code: 'PD',
      authorize: async ({ request, entityId }) => canSee(request, entityId), // app-defined check
    },
  }),
}, {
  provider: createLocalProvider('./var/uploads'),
  servePrefix: '/file',
});
```

The entity ID field defaults to `id` and its type to `'int'`; use `defineAttachments.entity(categories, { idField: 'yourKey', idType: 'uuid' })` otherwise (string/slug ids are not supported). Codes are validated at startup (missing, malformed, duplicate, or array-form categories throw). A category without `middlewares` imposes no upload validation.

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

`createFileServer` and `createImageServer` each return `{ match(request), handle(request) }` working on Web `Request`/`Response` (Node-compatible runtime, not edge). Pass the whole `Request` (`authorize` reads its headers):

```ts
import { createFileServer, createImageServer, createLocalProvider } from '@atom-forge/attachment';

const fileServer  = createFileServer({ attachments, servePrefix: '/file' });
const imageServer = createImageServer({
  attachments,
  variants,                                        // same map as the client
  thumbProvider: createLocalProvider('./var/thumb'),
  thumbPrefix:   '/img',
  focusSecret:   process.env.FOCUS_SECRET!,
});
// Manual focus on upload: imgstat(focus, createFocusHash(process.env.FOCUS_SECRET!))
// Reverse proxy allow-list: publicCodes(attachments).join('|')  →  'AV|DO'

if (fileServer.match(request))  return fileServer.handle(request);
if (imageServer.match(request)) return imageServer.handle(request);
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
| [Storage](docs/en/storage.md) | Compact JSON format, group ids, provider contract, local/S3 storage, per-category providers, events, Prisma extension |
| [Concurrent writes](docs/en/concurrency.md) | Atomic mode: the `atomic` function, Prisma examples (row lock, compare-and-set), changed return types, orphan cleanup, provider requirements, known limits |
| [Serving files](docs/en/serving.md) | File/image servers, framework integration, proxies, cache cleanup |
| [Access control](docs/en/access-control.md) | `authorize`, public-code proxy allow-list (`publicCodes`), authorized file and thumbnail serving, bucket rules |
| [Upgrading](docs/en/upgrading.md) | Changes that need action between versions (0.3.3 → 0.4.0: object categories with codes, new group ids, server options, proxy rules) |

Start from the [documentation index](docs/en/index.md) for the reading order.

## Working on this repository

- Public server exports: `src/index.ts`. Browser-safe exports: `src/client.ts`.
- Handler behavior: `src/define-attachments.ts` (default mode), `src/atomic-handler.ts` (atomic mode); shared contracts and stored shapes: `src/types.ts`.
- Make focused changes; keep runtime behavior, public types, and relevant documentation consistent. Do not add a new API based only on an outdated example. Documentation is written in `book/` first and carried over to `docs/en` and `docs/hu`; see `AGENTS.md`.
- Run `npx tsc --noEmit` for a non-emitting type check. `npm run build` rebuilds `dist` (removes it first). There is currently no test script in `package.json`.
- When changing package contents, check the `files` allowlist in `package.json`. Do not commit or release unless requested.
