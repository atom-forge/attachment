---
name: "@atom-forge/attachment"
language: en
id: atom-forge-attachment
author: Gergely Laborci
tags: [attachment, prisma, typescript]
intro: Portable, framework-agnostic file attachment system for Prisma entities.
children:
  - "[[01-getting-started.md]]"
  - "[[02-handler-api.md]]"
  - "[[03-middleware.md]]"
  - "[[04-image.md]]"
  - "[[05-serving.md]]"
  - "[[06-storage.md]]"
---
# @atom-forge/attachment

Portable, framework-agnostic file attachment system for Prisma entities.

Most applications eventually need to attach files to their data: an avatar on a user, a gallery on a product, a PDF on an invoice. `@atom-forge/attachment` keeps this simple. There is no separate file table; the metadata of every file lives in a single `Json?` column on the entity it belongs to, and the files themselves sit in a storage backend of your choice, either the local disk or S3/MinIO.

## How to read this book

The chapters build on each other, so reading them in order works best:

1. **Getting Started** shows the whole path from schema to upload to URL in a few minutes.
2. **Handler API** covers every operation you can run on an entity's files.
3. **Middleware** explains how uploads are validated and transformed.
4. **Image Handling** shows how thumbnails and image variants work.
5. **Serving Files** wires everything into your framework and reverse proxy.
6. **Storage** describes the JSON format, the providers and the events behind it all.

> [!tip] In a hurry?
> Read *Getting Started*, then jump to the chapter for the task at hand. Each chapter stands on its own after the first one.
