# Tárolás

## JSON oszlop struktúra

Az `attachments` oszlop egy `Record<category, CategoryStore>`-t tartalmaz:

```ts
interface CategoryStore {
  i: string;          // groupId: összetett kulcs {random}-{CODE}-{entityId36}, az első hozzáadáskor jön létre
  v: number;          // verziószámláló (monoton növekvő)
  f: AttachmentItem[];
}

interface AttachmentItem {
  n: string;   // fájlnév
  v: string;   // verzió a hozzáadás/csere pillanatában (base36 számláló + véletlen utótag)
  s: number;   // méret bájtban
  t: number;   // feltöltés időpontja (Unix epoch)
  x: unknown;  // hívó által megadott meta
}
```

**Példa tárolt érték** (`avatar` kategória `AV` kóddal, felhasználó azonosító: `152829`):
```json
{
  "avatar": {
    "i": "k3x9q-AV-39x9",
    "v": 3,
    "f": [{ "n": "photo.jpg", "v": "3r2jo3l", "s": 42000, "t": 1743076800, "x": {} }]
  }
}
```

### Group id

A kategória store group id-ja összetett kulcs, és egyben a tárolási mappa is:

```
{random}-{CODE}-{entityId36}      pl. k3x9q-AV-39x9   (39x9 = 152829 base36-ban)
```

| Rész         | Jelentés |
|--------------|----------|
| `random`     | Kisbetűs base36, kitalálhatatlan (véd a végigpróbálgatás ellen). Az első két karaktere a lokális shard. Alapértelmezetten egy véletlen UUID-ból képződik; az egyedi `nextGroupId` csak ezt a részt állítja elő, és `[a-z0-9]+` értéket kell visszaadnia. |
| `CODE`       | A kategória kétkarakteres `code`-ja. Ebből találják meg a szerverek az entitástípust, a kategóriát, a providerét és az `authorize` hookját. |
| `entityId36` | A tulajdonos entitás azonosítója base36-ban (`idType: 'int'`, az alapértelmezett), vagy a 128 bites UUID érték base36-ban (`idType: 'uuid'`, kb. 25 karakter). |

Mivel az összetett kulcs maga a mappa, ha valaki átírja az URL-ben az entitás azonosítóját, nem létező útvonalra jut (404), így az `authorize` nem csapható be egy másik tulajdonos ellenőrzésével.

A korábbi verziók group id-jai (sima véletlen azonosítók) nem támogatottak: az `add`/`replace` `AttachmentValidationError`-t dob rájuk, a szerverek 404-et adnak. Migráció nincs.

### Elem verzió

Egy elem `v` értéke a store számlálója base36-ban, utána 6 véletlen base36 karakter (pl. `3r2jo3l`). A véletlen utótag miatt a jövőbeli verziók URL-jei nem találhatók ki és nem cache-elhetők előre.

---

## Publikus `AttachmentData<TMeta>` típus

Minden olvasási metódus ezt a formát adja vissza:

```ts
interface AttachmentData<TMeta = unknown> {
  filename:   string;
  version:    string;   // base36 számláló + véletlen utótag
  groupId:    string;   // összetett: {random}-{CODE}-{entityId36}
  size:       number;
  uploadedAt: number;   // Unix epoch
  meta:       TMeta;
  url:        string;   // számított: /{servePrefix}/{groupId}-{version}/{filename}
}
```

Az `url` soha nincs tárolva — minden olvasáskor számítódik. A fájlnév az URL-ben percent-kódolva szerepel (`encodeURIComponent`).

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

A `path` mindig a `{shard}/{groupId}/{filename}` logikai útvonal (lásd lent). A fájlszerver a `stream()`-mel streameli az eredeti fájlokat, a képszerver a `read()`-del olvassa őket, ezért minden providernek mindkettőt meg kell valósítania.

A beépített providerek szerződésének részletei:

- `delete` — a lokális provider figyelmen kívül hagyja a már hiányzó fájlt, így egy olyan csatolmány törlése is sikeres, amelynek a fájlja már nincs meg.
- `exists` — az S3 provider csak „nem található” esetén ad `false`-t, minden más hibát (hitelesítés, hálózat) továbbdob. `s3:ListBucket` jogosultság nélkül az S3 a hiányzó kulcsokra 403-at ad, ami ilyenkor `false` helyett hibaként jelenik meg.
- `stream` — az S3 provider pull alapú: csak olyan ütemben olvas az S3-ból, ahogy a kliens fogyaszt, és megszakítja az S3 választ, ha a kliens elmegy.
- `rename` — az S3 providernél az azonos kulcsra történő átnevezés no-op.

---

## Fizikai fájl elrendezés

### Lokális provider

A fájlok elérési útja:

```
{shard}/{groupId}/{filename}
```

ahol `shard = groupId.slice(0, 2)` — a véletlen rész első két karaktere.

Példa: `k3/k3x9q-AV-39x9/photo.jpg`

`replace` esetén a fájl **helyben íródik felül** — a fizikai útvonal ugyanaz marad, de a JSON-ban a verzió változik → új URL (cache-bustolva).

### S3 / MinIO

Shard nélkül — az object storage-nak nincs szüksége könyvtár shardingra. A shard lekerül a logikai útvonalról:

```
{prefix}/{groupId}/{filename}
```

Példa: `files/k3x9q-AV-39x9/photo.jpg` (prefix nélkül `k3x9q-AV-39x9/photo.jpg`)

Az opcionális provider prefix minden object kulcsot névtérbe tesz. Így az eredeti
fájlok és a generált képvariánsok egy bucketben, mégis külön kezelhetően tárolhatók.
A thumbnailek lapos kulcson cache-elődnek: `{groupId}-{version}.{mode-seg}.{filename}.webp`:

```
files/k3x9q-AV-39x9/photo.jpg
images/k3x9q-AV-39x9-3r2jo3l.e.400x400.photo.jpg.webp
```

A mentések mindig `Cache-Control: public, max-age=31536000, immutable` headert állítanak be az objektumon. A válasz headerét az alkalmazás fájlszervere maga határozza meg (`authorize`-zal rendelkező kategóriáknál `private, no-store`).

---

## Lokális provider

```ts
import { createLocalProvider } from '@atom-forge/attachment';

const provider = createLocalProvider('./var/uploads');
```

Nincs extra függőség — Node.js beépített modulokat használ (`fs/promises`). A feltöltési könyvtáron kívülre mutató útvonalakat elutasítja.

---

## S3 / MinIO provider

```ts
import { createS3Provider } from '@atom-forge/attachment';

const provider = createS3Provider({
  bucket:          'assets',
  prefix:          'files/',             // opcionális object-kulcs névtér
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
| `prefix`          | nem            | Object-kulcs névtér; a kezdő/záró perjelek normalizálódnak       |
| `region`          | nem            | AWS régió (ha hiányzik, az AWS SDK alapértelmezett feloldása érvényes) |
| `endpoint`        | nem (MinIO)    | Egyedi endpoint URL; MinIO-hoz szükséges                         |
| `forcePathStyle`  | nem (MinIO)    | `http://host/bucket/key` formátum (virtual-hosted helyett); MinIO-hoz szükséges |
| `accessKeyId`     | nem            | Access key; csak a `secretAccessKey`-jel együtt használódik      |
| `secretAccessKey` | nem            | Secret key; explicit kulcsok nélkül az AWS SDK alapértelmezett credential lánca érvényes |

A `rename` `CopyObject` + `DeleteObject` hívásokkal valósul meg (nem atomikus). Ha a törlési lépés sikertelen, `storage:rename-cleanup-failed` esemény váltódik ki.

### Egy bucket az eredeti fájloknak és a képcache-nek

Az attachment provider és a képszerver `thumbProvider`-e ugyanarra a bucketre mutat eltérő prefixszel:

```ts
const provider      = createS3Provider({ bucket: 'assets', prefix: 'files/',  /* ... */ });
const thumbProvider = createS3Provider({ bucket: 'assets', prefix: 'images/', /* ... */ });

const attachments = defineAttachments({ /* ... */ }, { provider });
const imageServer = createImageServer({ attachments, thumbProvider, /* ... */ });
```

Így a lifecycle szabály csak az `images/` prefixet törölheti, a `files/` érintetlen marad.

Függőség: `@aws-sdk/client-s3`

---

## Kategóriánkénti provider

Bármely kategória megadhat saját `provider`-t; amelyik nem ad meg, az a `defineAttachments` providerét használja. A fájl- és képszerver a group id-ban lévő kategóriakódból találja meg a megfelelő providert.

```ts
const attachments = defineAttachments({
  course: defineAttachments.entity({
    cover:     { code: 'CV', middlewares: [mime('image/*')] },
    contracts: {
      code: 'PD',
      authorize: async ({ request, entityId }) => canSee(request, entityId),
      provider:  createS3Provider({ bucket: 'assets', prefix: 'private/' }),
    },
  }),
}, { provider: createS3Provider({ bucket: 'assets', prefix: 'files/' }) });
```

Ha egy bucket vagy prefix névtelenül olvasható (például mert a proxy közvetlenül onnan szolgálja ki a publikus fájlokat), az `authorize`-zal rendelkező kategóriáknak külön, nem publikus providert kell használniuk, mint fent; különben a fájljaik közvetlenül letölthetők a bucketből. Lásd: [Hozzáférés-szabályozás](access-control.md).

---

## Eseményrendszer

Csatolj event managert az életciklus események fogadásához. Az `EventEmitter` interfésznek egyetlen metódusa van, a `trigger(event)`; az event manager a `defineAttachments` és minden kategória providerének is átadódik (`setEventManager`):

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
| `attachment:purge`         | az entitás összes fájlja törölve (csak teljes siker esetén) | entityType, entityId     |

A `purge()` best effort: minden fájlt megpróbál törölni, a nem törölhető fájlok store-jait megtartja az `entity.attachments`-ben, majd egy `errors` tömböt tartalmazó `Error`-t dob. Csak ha minden fájl törlődött, akkor üríti a mezőt `{}`-re és váltja ki az `attachment:purge` eseményt.

### Az S3 provider által kiváltott események

| Esemény                          | Mikor                                   | Payload                    |
|----------------------------------|-----------------------------------------|----------------------------|
| `storage:rename-cleanup-failed`  | CopyObject ok, DeleteObject sikertelen  | oldPath, newPath, error    |

### A képszerver által kiváltott események

Csak ha a `createImageServer` kap `eventManager`-t:

| Esemény                | Mikor                                         | Payload                     |
|------------------------|-----------------------------------------------|-----------------------------|
| `thumbnail:generated`  | új thumbnail generálódott és cache-elődött    | groupId, filename, modeSeg  |

### Prisma extension

`entity:deleted` (`{ model, entity }`) esemény minden sikeres egyrekordos Prisma `delete` után:

```ts
import { createPrismaExtension } from '@atom-forge/attachment';

const prisma = new PrismaClient().$extends(createPrismaExtension(eventManager));
```

A `deleteMany` nincs lefedve: a Prisma csak darabszámot ad vissza, a törölt rekordokat nem. A `deleteMany` előtt töltsd be a rekordokat, és magad purge-old a csatolmányaikat.

A `createPrismaMiddleware(eventManager)` (a `prisma.$use`-hoz) még létezik, de elavult: a `$use` a Prisma 4.16 óta elavult, az újabb verziókból eltávolították.

Az esemény kezelése a csatolmányok törléséhez entitás törléskor. A könyvtár `EventEmitter`-ének csak `trigger` metódusa van, így a kezelőkhöz való továbbítás a saját event managered dolga, például:

```ts
import type { AttachmentEvent, EventEmitter } from '@atom-forge/attachment';

class AppEvents implements EventEmitter {
  private handlers: Array<(event: AttachmentEvent) => void | Promise<void>> = [];
  subscribe(handler: (event: AttachmentEvent) => void | Promise<void>) { this.handlers.push(handler); }
  trigger(event: AttachmentEvent) {
    for (const handler of this.handlers) {
      Promise.resolve(handler(event)).catch((error) => console.error(error));
    }
  }
}

const eventManager = new AppEvents();
const prisma = new PrismaClient().$extends(createPrismaExtension(eventManager));

eventManager.subscribe(async (event) => {
  if (event.type !== 'entity:deleted') return;
  const factory = attachments[event.model.toLowerCase() as keyof typeof attachments];
  if (!factory) return;
  // A sor már nincs meg: a handlert a törölt rekordból építjük, és töröljük a fájljait.
  // Az attachments mezőt ne írd vissza — nincs frissíthető sor.
  await factory(event.entity as any).purge();
});
```

Ha a `purge()` hibát dob, az `errors` tömbje sorolja fel a nem törölhető fájlokat; logold őket vagy próbáld újra később, mert a rájuk hivatkozó rekord már nem létezik.
