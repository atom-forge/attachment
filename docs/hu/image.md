# Képkezelés

## Kép variánsok

A variáns térképet egyszer definiáld — szerver és kliens megosztja:

```ts
import { type ImageVariantMap } from '@atom-forge/attachment';

export const imageVariants = {
  thumb:  { w: 200, h: 200 },
  avatar: { w: 400, h: 400 },
  wide:   { w: 800, h: 800 },
  index:  { w: 400 },           // csak szélesség → arányos magasság
  tall:   { h: 400 },           // csak magasság → arányos szélesség
} satisfies ImageVariantMap;

export type AppImageVariants = typeof imageVariants;
```

A thumbnail szerviz ebből a térképből automatikusan levezeti az összes engedélyezett méretet (1×, 2×, 3× variansenként). Egy variáns hozzáadása vagy eltávolítása azonnal frissíti a szerver allowlist-et.

---

## Thumbnail URL séma

```
/{thumbPrefix}/{groupId}-{version}/{mode-szegmens}/{filename}.webp

/img/k3x9q-AV-39x9-1r2jo3l/e.400x400/photo.jpg.webp
```

A `groupId` a kategória tároló összetett group id-ja (`{random}-{CODE}-{entityId36}`, itt `k3x9q-AV-39x9`), a `version` az elem verziója (`1r2jo3l`). A fájlnév százalékkódolt.

**Mode szegmens:**

| Formátum                    | Példa                       | Mikor                    |
|-----------------------------|-----------------------------|--------------------------|
| `{mode}.{w}x{h}`            | `e.400x400`                 | névvel ellátott vágási mód |
| `{focus12}.{w}x{h}.{hash4}` | `0s0s0o0o0o7s.400x400.ab1c` | kézi fókuszpont          |

**Vágási módok:**

| Mód | Stratégia                    |
|-----|------------------------------|
| `e` | entropy (alapértelmezett)    |
| `a` | attention                    |
| `c` | középre igazított cover      |
| `b` | box / inside (belefér, nem nagyít) |

**Méret jelölés:** `400x400` = fix, `400x0` = csak szélesség, `0x400` = csak magasság.

A mode szegmens ellenőrzése szigorú: ami nem `{e|a|c|b}.{w}x{h}` vagy `{focus12}.{w}x{h}.{hash4}` alakú, az 404, így az URL-variációk nem sokszorozhatják a cache bejegyzéseket.

---

## Sűrűség (Density)

A kliens megszorozza a méreteket a sűrűséggel az URL építés előtt — a szerviznek nincs fogalma a sűrűségről:

```
avatar @1x  →  e.400x400
avatar @2x  →  e.800x800
avatar @3x  →  e.1200x1200
```

---

## `buildVariantUrl(variants, attachment, variant, density?, mode?)`

Típusbiztos URL-építő. Bármilyen `AttachmentData<unknown>`-t elfogad — nem szükséges `ImgStat`. A `mode` értéke `'e' | 'a' | 'c' | 'b'`.

```ts
import { buildVariantUrl } from '@atom-forge/attachment/client';

buildVariantUrl(imageVariants, attachment, 'avatar')         // 1x, tárolt mód vagy entropy fallback
buildVariantUrl(imageVariants, attachment, 'avatar', 2)      // 2x
buildVariantUrl(imageVariants, attachment, 'thumb', 1, 'c')  // középre vágás
```

Mód kiválasztás: explicit arg → tárolt `meta.img.c` (tárolt `Focus` csak akkor, ha `meta.img.ch` is van) → `'e'`. Ugyanez érvényes a `makeAttachmentHandler`-re.

---

## `buildImageUrl(attachment, width, height, mode?, prefix?)`

Alacsony szintű URL-építő. `AttachmentData<{ img: ImgStat }>` szükséges, ha a `mode` nincs megadva.

```ts
import { buildImageUrl } from '@atom-forge/attachment/client';

buildImageUrl(attachment, 400, 400)        // meta.img.c-t használja
buildImageUrl(attachment, 400, 400, 'e')   // explicit mód
buildImageUrl(attachment, 400, 0, 'a')     // csak szélesség
```

Elfogadott módok: `'e' | 'a' | 'c' | 'b' | Focus`. Kézi fókusznál `meta.img.ch` szükséges (`imgstat` + `FocusHashFn` tölti fel), különben hibát dob.

---

## `makeAttachmentHandler<M, V>(variants, options?)`

Kliens oldali factory. Közvetlenül olvassa az entitás `attachments` JSON mezőjét — nincs szerver hívás.

```ts
import { makeAttachmentHandler } from '@atom-forge/attachment/client';

const h = makeAttachmentHandler(imageVariants);
// options: { servePrefix?: string, thumbPrefix?: string }  (alapért.: '/file', '/img')

const item = h.user(user).avatar.first;       // ItemView | undefined
const all  = h.user(user).gallery.all;        // ItemView[]

item?.filename          // 'photo.jpg'
item?.url               // '/file/k3x9q-AV-39x9-1r2jo3l/photo.jpg'
item?.meta              // unknown (cast-old szükség szerint)
item?.img.avatar()      // '/img/k3x9q-AV-39x9-1r2jo3l/e.400x400/photo.jpg.webp'
item?.img.avatar(2)     // '/img/k3x9q-AV-39x9-1r2jo3l/e.800x800/photo.jpg.webp'
item?.img.thumb(1, 'c') // '/img/k3x9q-AV-39x9-1r2jo3l/c.200x200/photo.jpg.webp'

h.user(user).gallery.find('*.jpg')     // ItemView[] — glob szűrő
h.user(user).gallery.last?.img.wide(2)
```

---

## Kézi fókusz végig

A fókuszos URL egy 4 karakteres hash-t tartalmaz; a kép szerver a `focusSecret`-tel újraszámolja, és eltérés esetén 403-at ad. Hogy a fókuszos URL-ek működjenek:

1. Feltöltéskor `imgstat(focus, createFocusHash(secret))` — a `createFocusHash` csak szerver oldali export, a `secret` ugyanaz az érték, mint a kép szerver `focusSecret`-je. Ez tárolja a `meta.img.c`-t (a fókuszt) és a `meta.img.ch`-t (a hash-t).
2. A kliensen mód nélkül építsd az URL-t (`item.img.avatar()`, `buildVariantUrl(...)`, `buildImageUrl(...)`): a tárolt fókusz és hash kerül bele.
3. Kiszolgálás `createImageServer({ ..., focusSecret: secret })`-tel.

```ts
// szerver
import { imgstat, createFocusHash, createImageServer } from '@atom-forge/attachment';

const FOCUS_SECRET = process.env.FOCUS_SECRET!;
const focusHash = createFocusHash(FOCUS_SECRET);
// kategória: { code: 'CV', middlewares: [mime('image/*'), imgstat({ x: 500, y: 300, s: { x: 0, y: 0, w: 1000, h: 1000 } }, focusHash)] }

const imageServer = createImageServer({ attachments, variants: imageVariants, thumbProvider, focusSecret: FOCUS_SECRET });
```

A `meta.img.ch` nélkül tárolt fókuszt (pl. hash függvény nélküli `imgstat(focus)`) a kliens figyelmen kívül hagyja, és `'e'`-re esik vissza. A titok megváltoztatása érvényteleníti a meglévő fókuszos URL-eket.

---

## Kép szerver

```ts
import { createImageServer, createLocalProvider } from '@atom-forge/attachment';

export const imageServer = createImageServer({
  attachments,                                    // a defineAttachments eredménye
  variants:      imageVariants,                   // ugyanaz a térkép, amit a kliens használ
  thumbProvider: createLocalProvider('./var/thumb'),
  thumbPrefix:   '/img',                          // opcionális, alapért. '/img'
  focusSecret:   process.env.FOCUS_SECRET!,
  eventManager,                                   // opcionális, megkapja a thumbnail:generated eseményt
});
```

| Opció           | Alapért. | Jelentés                                                                |
|-----------------|----------|-------------------------------------------------------------------------|
| `attachments`   | —        | A `defineAttachments` eredménye. Az eredeti kép a kategória providerjéből olvasódik (a group id-ban lévő kód alapján). |
| `variants`      | —        | Variáns térkép; ebből vezeti le az engedélyezett méreteket.             |
| `thumbProvider` | —        | Ide kerülnek cache-elésre a generált thumbnailek.                       |
| `thumbPrefix`   | `'/img'` | A thumbnailek URL prefixe.                                              |
| `focusSecret`   | —        | Titok a kézi fókusz hash-ekhez (ugyanaz, mint a `createFocusHash`-nél). |
| `eventManager`  | —        | Megkapja a `thumbnail:generated` eseményt.                              |

`sourceProvider` opció nincs. A kérés ellenőrzése a cache érintése előtt történik:

| Eset                                                              | Státusz |
|-------------------------------------------------------------------|---------|
| Hibás útvonal, group id, verzió (`[a-z0-9]+`) vagy fájlnév, nem szigorú formátumú mode szegmens, ismeretlen kategóriakód | 404 |
| A méret nem a `variants`-ból származik                             | 400     |
| A fókusz hash nem egyezik                                          | 403     |
| A kategóriának van `authorize`-a, és az `false`-t ad               | 403     |
| Hiányzik az eredeti fájl (törölt fájlok cache-elt thumbnailjeit nem szolgálja ki) | 404 |
| A generálás sikertelen                                             | 500     |

A thumbnailek WebP-ként, `X-Content-Type-Options: nosniff` és `Cache-Control: public, max-age=31536000, immutable` fejléccel mennek ki. Az `authorize`-zal rendelkező kategóriák is kapnak thumbnailt: minden thumbnail kérésnél lefut az `authorize`, a válasz pedig `Cache-Control: private, no-store`. Ezek thumbnailjei is a `thumbProvider` cache-be kerülnek, ezért a cache-t közvetlenül kiszolgáló reverse proxy csak publikus kódokat szolgálhat ki (lásd [Fájlkiszolgálás](serving.md) és [Hozzáférés-szabályozás](access-control.md)).

A thumbnaileket a `generateImage(source, mode, width?, height?)` állítja elő (exportált; WebP `Buffer`-t ad vissza), amely először az EXIF tájolást alkalmazza, és sosem nagyít.

---

## Animált képek

Animált GIF és animált WebP esetén az `e` (entropy) és `a` (attention) módok csendesen `c` (centre) módra degradálódnak — egykép-analízisen alapulnak és következetlen eredményt adnak több képkockán. A kézi fókusz mindig megmarad.

---

## Esemény: `thumbnail:generated`

Ha a `createImageServer` kap `eventManager`-t, a kép szerver egy új thumbnail generálása és cache-elése után (cache találatnál nem) meghívja annak `trigger` metódusát a `thumbnail:generated` eseménnyel — monitoringhoz hasznos:

```ts
// payload
{ type: 'thumbnail:generated', groupId, filename, modeSeg }
```
