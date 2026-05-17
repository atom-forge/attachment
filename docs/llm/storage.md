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