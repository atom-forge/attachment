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
| `sharp`          | `>=0.32` | `toWebP()`, `imgstat()`, `generateThumbnail()` |
| `music-metadata` | `>=11`   | `getMp3Duration()`                             |
| `zod`            | `>=4`    | séma validáló middleware                       |

A peer függőségek opcionálisak — csak azt importáld, amit használsz.

---

## 1. Definiáld az attachment sémát

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
  // nextGroupId: opcionális — alapértelmezett: crypto.randomUUID() → base36
  // Felülírható, ha egyedi vagy adatbázis-alapú group ID szükséges:
  // nextGroupId: async (entityType, entityId, category) => sajatIdGenerator(...)
});
```

`defineAttachments.entity(categories, options?)` egy entitástípust definiál.
Az `idField` megadja, hogy az entitáson melyik mező az elsődleges kulcs (alapértelmezett: `'id'`).

---

## 2. Fájl feltöltése

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
  await rollback();   // adatbázis hiba esetén törli a fizikai fájlt
  throw err;
}
```

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
item?.url               // '/file/abc123-3/photo.jpg'
item?.meta              // unknown — cast-old a saját meta típusodra
item?.img.avatar()      // '/img/abc123-3/e.400x400/photo.jpg.webp'
item?.img.avatar(2)     // '/img/abc123-3/e.800x800/photo.jpg.webp'  (2x retina)
```

> Böngészős / SSR komponensekben `@atom-forge/attachment/client`-ből importálj. A főcsomag Node.js szerver modulokat is re-exportál.
