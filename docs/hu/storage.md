# Tárolás

## JSON oszlop struktúra

Az `attachments` oszlop egy `Record<category, CategoryStore>`-t tartalmaz:

```ts
interface CategoryStore {
  i: string;          // groupId (base36, automatikusan generált UUID→base36 az első hozzáadáskor)
  v: number;          // verzióscámláló (monoton növekvő)
  f: AttachmentItem[];
}

interface AttachmentItem {
  n: string;   // fájlnév
  v: string;   // verzió a hozzáadás/csere pillanatában (base36)
  s: number;   // méret bájtban
  t: number;   // feltöltés időpontja (Unix epoch)
  x: unknown;  // hívó által megadott meta
}
```

**Példa tárolt érték:**
```json
{
  "avatar": {
    "i": "abc123",
    "v": 3,
    "f": [{ "n": "photo.jpg", "v": "3", "s": 42000, "t": 1743076800, "x": {} }]
  }
}
```

---

## Publikus `AttachmentData<TMeta>` típus

Minden olvasási metódus ezt a formát adja vissza:

```ts
interface AttachmentData<TMeta = unknown> {
  filename:   string;
  version:    string;   // base36
  groupId:    string;   // base36
  size:       number;
  uploadedAt: number;   // Unix epoch
  meta:       TMeta;
  url:        string;   // számított: /{servePrefix}/{groupId}-{version}/{filename}
}
```

Az `url` soha nincs tárolva — minden olvasáskor számítódik.

---

## `StorageProvider` interfész

```ts
interface StorageProvider {
  save(path: string, file: File):               Promise<void>;
  read(path: string):                           Promise<Buffer>;
  stream(path: string):                         ReadableStream<Uint8Array>;
  delete(path: string):                         Promise<void>;
  exists(path: string):                         Promise<boolean>;
  rename(oldPath: string, newPath: string):     Promise<void>;
  setEventManager?(em: EventEmitter):           void;
}
```

---

## Fizikai fájl elrendezés

### Lokális provider

A fájlok elérési útja:

```
{shard}/{groupId}/{filename}
```

ahol `shard = groupId.slice(0, 2)`.

Példa: `ab/abc123/photo.jpg`

`replace` esetén a fájl **helyben íródik felül** — a fizikai útvonal ugyanaz marad, de a JSON-ban a verziószám változik → új URL (cache-bustolva).

### S3 / MinIO

Shard nélkül — az object storage-nak nincs szüksége könyvtár shardingra:

```
{groupId}/{filename}
```

Példa: `abc123/photo.jpg`

A mentések mindig `Cache-Control: public, max-age=31536000, immutable` headert állítanak be.

---

## Lokális provider

```ts
import { createLocalProvider } from '@atom-forge/attachment';

const provider = createLocalProvider('./var/uploads');
```

Nincs extra függőség — Node.js beépített modulokat használ (`fs/promises`).

---

## S3 / MinIO provider

```ts
import { createS3Provider } from '@atom-forge/attachment';

const provider = createS3Provider({
  bucket:          'assets',
  region:          'eu-central-1',
  endpoint:        'http://minio:9000',  // MinIO-nál kötelező; AWS S3-nál elhagyható
  forcePathStyle:  true,                 // MinIO-nál szükséges
  accessKeyId:     '...',
  secretAccessKey: '...',
});
```

| Opció             | Kötelező       | Leírás                                                           |
|-------------------|----------------|------------------------------------------------------------------|
| `bucket`          | igen           | S3 bucket neve                                                   |
| `region`          | igen           | AWS régió                                                        |
| `endpoint`        | csak MinIO     | Egyedi endpoint URL                                              |
| `forcePathStyle`  | csak MinIO     | `http://host/bucket/key` formátum (virtuális-hosted helyett)     |
| `accessKeyId`     | igen           | Access key                                                       |
| `secretAccessKey` | igen           | Secret key                                                       |

A `rename` `CopyObject` + `DeleteObject` hívásokkal valósul meg (nem atomikus). Ha a törlési lépés sikertelen, `storage:rename-cleanup-failed` esemény váltódik ki.

Függőség: `@aws-sdk/client-s3`

---

## Eseményrendszer

Csatolj event managert az életciklus események fogadásához:

```ts
import { type EventEmitter } from '@atom-forge/attachment';

const myEventManager: EventEmitter = {
  trigger(event) { /* logolás, job queue, stb. */ }
};

defineAttachments({...}, {
  provider,
  eventManager: myEventManager,
});
```

### A `defineAttachments` által kiváltott események

| Esemény                    | Mikor                           | Payload                                              |
|----------------------------|---------------------------------|------------------------------------------------------|
| `attachment:add`           | fájl feltöltve, store frissítve | entityType, entityId, category, groupId, attachment  |
| `attachment:replace`       | fájl felülírva, store frissítve | …, oldAttachment, attachment                         |
| `attachment:delete`        | fájl törölve, store frissítve   | entityType, entityId, category, groupId, filename    |
| `attachment:rename`        | fájl átnevezve                  | …, oldName, newName                                  |
| `attachment:meta-updated`  | csak meta változott             | entityType, entityId, category, groupId, attachment  |
| `attachment:purge`         | összes fájl törölve             | entityType, entityId                                 |

### S3 provider által kiváltott események

| Esemény                          | Mikor                                   |
|----------------------------------|-----------------------------------------|
| `storage:rename-cleanup-failed`  | CopyObject ok, DeleteObject sikertelen  |

### Prisma middleware

Automatikus `entity:deleted` esemény beállítása Prisma törlésekre:

```ts
import { createPrismaMiddleware } from '@atom-forge/attachment';

prisma.$use(createPrismaMiddleware(eventManager));
```

Az esemény kezelése az attachmentek törléséhez entitás törléskor:

```ts
eventManager.on('entity:deleted', async ({ model, entity }) => {
  const handler = attachments[model.toLowerCase()]?.(entity);
  await handler?.purge();
  await prisma[model.toLowerCase()].update({
    where: { id: entity.id },
    data:  { attachments: entity.attachments as object },
  });
});
```
