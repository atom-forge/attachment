# Kezdeti lépések

## Mit csinál

- Fájlokat csatol bármilyen Prisma entitáshoz egy `Json?` oszlopon keresztül (`attachments`)
- Entitásonként több **kategória** is definiálható (pl. `avatar`, `gallery`, `documents`)
- Feltöltéseket validál és transzformál egy kompozálható **middleware pipeline**-nal
- Automatikusan generál cache-bust-olt kiszolgálási URL-eket
- Igény szerint **thumbnail-eket generál** képekhez (WebP kimenet, lapos lemezes cache)
- Tipizált **kliens oldali handlert** biztosít, ami közvetlenül olvassa az entitás adatát — nem kell külön API hívás

## Telepítés

```sh
npm install @atom-forge/attachment
```

### Peer függőségek

| Csomag           | Verzió   | Szükséges ehhez                                |
|------------------|----------|------------------------------------------------|
| `sharp`          | `>=0.32` | `toWebP()`, `imgstat()`, `generateImage()`     |
| `music-metadata` | `>=11`   | `getMp3Duration()`                             |

A peer függőségek opcionálisak — csak azt importáld, amit használsz.

---

## 1. Definiáld az attachment sémát

```ts
import { defineAttachments, count, mime, toWebP, imgstat } from '@atom-forge/attachment';
import { createLocalProvider } from '@atom-forge/attachment';

const attachments = defineAttachments({
  user: defineAttachments.entity({
    avatar:  { code: 'AV', middlewares: [count(1), mime('image/*'), toWebP(80, 400, 400), imgstat()] },
    gallery: { code: 'GA', middlewares: [mime('image/*'), toWebP(80)] },
  }, { idType: 'uuid' }),

  course: defineAttachments.entity({
    avatar: { code: 'CA', middlewares: [count(1), mime(['image/jpeg', 'image/png', 'image/webp'])] },
  }),
}, {
  provider:    createLocalProvider('./var/uploads'),
  servePrefix: '/file',
  // nextGroupId: opcionális — alapértelmezett: crypto.randomUUID() → base36
  // Csak a group ID véletlen részét állítja elő; kisbetűs base36-ot ([a-z0-9]+) kell visszaadnia:
  // nextGroupId: async (entityType, entityId, category) => sajatIdGenerator(...)
});
```

`defineAttachments.entity(categories, options?)` egy entitástípust definiál.
Az `idField` megadja, hogy az entitáson melyik mező az elsődleges kulcs (alapértelmezett: `'id'`).
Az `idType` megadja, hogyan kerül az azonosító (base36 kódolással) a group ID-ba: `'int'` (alapértelmezett) vagy `'uuid'`. String/slug azonosítók nem támogatottak.

Minden kategória egy objektum, kötelező `code`-dal: pontosan két karakter `[A-Z0-9]`, egyedi az adott `defineAttachments` hívás összes kategóriája között (a fenti példában a `course.avatar` ezért `CA`, nem `AV`). Indításkor ellenőrizve van: hiányzó, hibás vagy duplikált kód, illetve tömb formájú kategória esetén hibát dob. Opcionális mezők: `middlewares`, `authorize` (hozzáférés-ellenőrzés fájl- és thumbnail-kérésenként) és `provider` (kategóriánkénti tárhely) — lásd: [Hozzáférés-szabályozás](access-control.md).

A kód a group ID része, amely egyben a tárolási mappa is: `{random}-{CODE}-{entityId36}`, pl. `k3x9q-CA-39x9` (`39x9` a `152829` base36-ban).

---

## 2. Fájl feltöltése

```ts
const userRecord = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
const h = attachments.user(userRecord);

const { attachment, rollback } = await h.avatar.add(uploadedFile, {});
try {
  await prisma.user.update({
    where: { id: userId },
    data:  { attachments: userRecord.attachments as object },
  });
} catch (err) {
  await rollback();   // adatbázis hiba esetén törli a fizikai fájlt
  throw err;
}
```

Fájlt csak **mentett** entitáshoz lehet csatolni: az azonosítónak léteznie kell és illeszkednie kell az `idType`-hoz, különben az `add` egyértelmű hibaüzenettel dob.

A handler **helyben módosítja az `entity.attachments`-t** — a `prisma.update`-et magadnak kell meghívni a mentéshez.

---

## 3. Fájlok olvasása szerveren

```ts
const h = attachments.user(userRecord);

h.avatar.list()           // AttachmentData[]
h.avatar.get('photo.jpg') // AttachmentData | undefined
```

---

## 4. Kliens oldali handler

A kliens oldali handler közvetlenül olvassa az entitás `attachments` JSON mezőjét — nem kell szerver hívás.

```ts
import { makeAttachmentHandler } from '@atom-forge/attachment/client';
import { imageVariants } from './image-variants.js';

const h = makeAttachmentHandler(imageVariants, { servePrefix: '/file', thumbPrefix: '/img' });

const item = h.course(course).avatar.first;  // ItemView | undefined
const all  = h.user(user).gallery.all;       // ItemView[]

item?.filename          // 'photo.jpg'
item?.url               // '/file/k3x9q-CA-39x9-1r2jo3l/photo.jpg'
item?.meta              // unknown — cast-old a saját meta típusodra
item?.img.avatar()      // '/img/k3x9q-CA-39x9-1r2jo3l/e.400x400/photo.jpg.webp'
item?.img.avatar(2)     // '/img/k3x9q-CA-39x9-1r2jo3l/e.800x800/photo.jpg.webp'  (2x retina)
```

> Böngészős / SSR komponensekben `@atom-forge/attachment/client`-ből importálj. A főcsomag Node.js szerver modulokat is re-exportál.
