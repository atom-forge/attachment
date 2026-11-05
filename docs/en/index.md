# @atom-forge/attachment

Portable, framework-agnostic file attachment system for Prisma entities.

Most applications eventually need to attach files to their data: an avatar on a user, a gallery on a product, a PDF on an invoice. `@atom-forge/attachment` keeps this simple. There is no separate file table; the metadata of every file lives in a single `Json?` column on the entity it belongs to, and the files themselves sit in a storage backend of your choice, either the local disk or S3/MinIO.

## Who this documentation is for

Developers who store files for Prisma entities in a TypeScript server application (Node.js or Bun), with a framework such as SvelteKit, Hono, Express, Next.js or Nuxt, and who want uploads, image variants and file serving without building a file table or a media service. Some familiarity with Prisma and with your framework's request handling is assumed.

## How to read this documentation

The chapters build on each other, so reading them in order works best:

1. **[Getting Started](getting-started.md)** shows the whole path from schema to upload to URL in a few minutes.
2. **[Handler API](handler-api.md)** covers every operation you can run on an entity's files.
3. **[Middleware](middleware.md)** explains how uploads are validated and transformed.
4. **[Image Handling](image.md)** shows how thumbnails and image variants work.
5. **[Serving Files](serving.md)** wires everything into your framework and reverse proxy.
6. **[Storage](storage.md)** describes the JSON format, the providers and the events behind it all.
7. **[Access Control](access-control.md)** explains how categories become public or authorized, and how the reverse proxy and storage keep authorized files protected.

When you upgrade from an earlier version, read **[Upgrading](upgrading.md)**: it lists every change that needs action, version by version. **[AI Notes](ai-notes.md)** gives copyable instructions for coding agents working in projects that use the package.

> **In a hurry?** Read [Getting Started](getting-started.md), then jump to the chapter for the task at hand. Each chapter stands on its own after the first one.
