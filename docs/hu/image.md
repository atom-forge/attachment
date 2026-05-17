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

A thumbnail szerviz ebből a térképből automatikusan levezetei az összes engedélyezett méretet (1×, 2×, 3× variansenként). Egy variáns hozzáadása vagy eltávolítása azonnal frissíti a szerver allowlist-et.

---

## Thumbnail URL séma

```
/{thumbPrefix}/{groupId}-{version}/{mode-szegmens}/{filename}.webp
```

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
| `b` | box / contain (nem nagyít)   |

**Méret jelölés:** `400x400` = fix, `400x0` = csak szélesség, `0x400` = csak magasság.

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

Típusbiztos URL-építő. Bármilyen `AttachmentData<unknown>`-t elfogad — nem szükséges `ImgStat`.

```ts
import { buildVariantUrl } from '@atom-forge/attachment';

buildVariantUrl(imageVariants, attachment, 'avatar')         // 1x, entropy fallback
buildVariantUrl(imageVariants, attachment, 'avatar', 2)      // 2x
buildVariantUrl(imageVariants, attachment, 'thumb', 1, 'c')  // középre vágás
```

Mód kiválasztás: explicit arg → `meta.img.c` (ha `imgstat` tárolta) → `'e'`.

---

## `buildThumbnailUrl(attachment, width, height, mode?, prefix?)`

Alacsony szintű URL-építő. `AttachmentData<{ img: ImgStat }>` szükséges, ha a `mode` nincs megadva.

```ts
import { buildThumbnailUrl } from '@atom-forge/attachment';

buildThumbnailUrl(attachment, 400, 400)        // meta.img.c-t használja
buildThumbnailUrl(attachment, 400, 400, 'e')   // explicit mód
buildThumbnailUrl(attachment, 400, 0, 'a')     // csak szélesség
```

Kézi fókusznál `meta.img.ch` szükséges (`imgstat` + `FocusHashFn` tölti fel).

---

## `makeAttachmentHandler<M, V>(variants, options?)`

Kliens oldali factory. Közvetlenül olvassa az entitás `attachments` JSON mezőjét — nincs szerver hívás.

```ts
import { makeAttachmentHandler } from '@atom-forge/attachment/client-handler';

const h = makeAttachmentHandler(imageVariants);
// options: { servePrefix?: string, thumbPrefix?: string }  (alapért.: '/file', '/img')

const item = h.course(course).avatar.first;   // ItemView | undefined
const all  = h.user(user).gallery.all;        // ItemView[]

item?.filename          // 'photo.jpg'
item?.url               // '/file/abc123-3/photo.jpg'
item?.meta              // unknown (cast-old szükség szerint)
item?.img.avatar()      // '/img/abc123-3/e.400x400/photo.jpg.webp'
item?.img.avatar(2)     // '/img/abc123-3/e.800x800/photo.jpg.webp'
item?.img.thumb(1, 'c') // '/img/abc123-3/c.200x200/photo.jpg.webp'

h.user(user).gallery.find('*.jpg')     // ItemView[] — glob szűrő
h.user(user).gallery.last?.img.wide(2)
```

---

## Animált képek

Animált GIF és animált WebP esetén az `e` (entropy) és `a` (attention) módok csendesen `c` (centre) módra degradálódnak — egykép-analízisen alapulnak és következetlen eredményt adnak több képkockán. A kézi fókusz mindig megmarad.

---

## Esemény: `thumbnail:generated`

A kép szerviz opcionálisan figyeli a `thumbnail:generated` eseményt cache fájl írása után — monitoringhoz vagy előmelegítéshez hasznos:

```ts
// payload
{ type: 'thumbnail:generated', groupId, filename, modeSeg }
```
