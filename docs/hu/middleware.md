# Upload Middleware

A middleware-ek sorban futnak le az `add()` és `replace()` előtt. `AttachmentValidationError` dobásával megszakítható a feltöltés.

```ts
type UploadMiddleware<TMeta = unknown> = (
	file: File,
	meta: TMeta,
	files: AttachmentData<TMeta>[],   // meglévő fájlok a kategóriában
) => Promise<{ file: File; meta: TMeta }>;
```

A middleware-eket kategóriánként adod meg, a kategória objektum `middlewares` tömbjében (minden kategóriának kötelező a kétkarakteres `code` is, lásd [Handler API](handler-api.md)):

```ts
import { defineAttachments, createLocalProvider, count, mime, toWebP, imgstat } from '@atom-forge/attachment';

const attachments = defineAttachments({
  user: defineAttachments.entity({
    avatar:  { code: 'AV', middlewares: [count(1), mime('image/*'), toWebP(80, 400, 400), imgstat()] },
    gallery: { code: 'GA', middlewares: [mime('image/*'), toWebP(80)] },
  }),
}, { provider: createLocalProvider('./var/uploads') });
```

A middleware a kapott `meta` módosítása helyett új `meta` objektumot adjon vissza: a hívó ugyanazt a meta objektumot több feltöltéshez is felhasználhatja. A beépített transzformátorok így működnek.

---

## Validátorok

### `count(max)`

Elutasítja a feltöltést, ha a kategóriában már `max` vagy több fájl van.

```ts
count(1)   // legfeljebb egy fájl (avatar eset)
count(10)  // legfeljebb tíz
```

### `size(maxBytes)`

Elutasítja a `maxBytes`-nál nagyobb fájlokat.

```ts
size(2 * 1024 * 1024)   // 2 MB
```

### `sumSize(maxBytes)`

Elutasítja, ha a meglévő fájlok + az új fájl együttes mérete meghaladja a `maxBytes`-t.

```ts
sumSize(50 * 1024 * 1024)   // 50 MB összesen a kategóriában
```

### `mime(pattern)`

Csak a MIME típus szerint egyező fájlokat engedi át. Wildcard altípust támogat.

```ts
mime('image/*')
mime(['image/jpeg', 'image/png', 'image/webp'])
```

### `ext(extensions)`

Csak a megadott kiterjesztésű fájlokat engedi át (kis-nagybetű független, vezető pont szükséges).

```ts
ext(['.jpg', '.jpeg', '.png', '.webp'])
```

---

## Transzformátorok

Peer függőségeket igényelnek (`sharp`, `music-metadata`).

### `toWebP(lossy?, width?, height?)`

A feltöltött képet WebP formátumba konvertálja. Alkalmazza az EXIF tájolást (a telefonos fotók nem kerülnek oldalra fordítva tárolásra), az animált GIF/WebP képek pedig megtartják az összes képkockájukat.

| Paraméter | Típus             | Alapért. | Leírás                                                                                     |
|-----------|-------------------|----------|--------------------------------------------------------------------------------------------|
| `lossy`   | `false \| number` | `false`  | `false` = veszteségmentes; `0–100` = veszteséges minőség                                   |
| `width`   | `number`          | —        | Max szélesség. Csak egyik megadva → arányos átméretezés (nem nagyít). Mindkettő → contain. |
| `height`  | `number`          | —        | Max magasság.                                                                              |

```ts
toWebP()              // veszteségmentes, nincs átméretezés
toWebP(80)            // veszteséges q80
toWebP(false, 1280)   // veszteségmentes, max szélesség 1280
toWebP(80, 800, 600)  // veszteséges q80, contain 800×600-ban
```

Peer függőség: `sharp`

### `imgstat(cropMode?, focusHash?)`

Olvassa a kép méretét, domináns színét, animált jelzőjét és vágási módját. Új meta objektumot ad vissza, benne egy `ImgStat`-tal a `meta.img` alatt (a hívó meta objektumát nem módosítja). A méretek a megjelenített méretek: 5–8-as EXIF tájolásnál a szélesség és a magasság felcserélődik.

| Paraméter   | Típus                               | Alapért. | Leírás                                             |
|-------------|-------------------------------------|----------|----------------------------------------------------|
| `cropMode`  | `'e' \| 'a' \| 'c' \| 'b' \| Focus` | `'e'`    | Tárolt vágási stratégia a thumbnail URL építéshez  |
| `focusHash` | `FocusHashFn`                       | —        | Szükséges `meta.img.ch` tárolásához kézi fókusznál |

```ts
imgstat()        // entropy vágás (alapértelmezett)
imgstat('a')     // attention vágás
imgstat('c')     // középre vágás
imgstat('b')     // box: belefér, nincs vágás
imgstat({x: 500, y: 300, s: {x: 0, y: 0, w: 1000, h: 1000}}, focusHash)  // kézi fókuszpont (lásd lent)
```

**Kézi fókusz.** A kép szerver fókuszos URL-t csak érvényes hash-sel fogad el. A hash függvényt a `createFocusHash(secret)` hozza létre (csak szerver oldali export); ugyanazt a titkot használd, mint a `createImageServer({ focusSecret })`:

```ts
import { imgstat, createFocusHash } from '@atom-forge/attachment';

const focusHash = createFocusHash(process.env.FOCUS_SECRET!);   // ugyanaz a titok, mint a kép szervernél
imgstat({x: 500, y: 300, s: {x: 0, y: 0, w: 1000, h: 1000}}, focusHash)
```

Az `imgstat` a hash-t a `meta.img.ch`-ba menti, a kliens ezt teszi az URL-be. `focusHash` nélkül a `meta.img.ch` hiányzik, és a kliens a tárolt fókusz helyett `'e'`-re esik vissza.

A tárolt `ImgStat`:

```ts
interface ImgStat {
	w: number;                    // megjelenített szélesség px
	h: number;                    // megjelenített magasság px
	d: string;                    // domináns szín (#rrggbb)
	a: boolean;                   // animált (GIF / animált WebP)
	c: 'e' | 'a' | 'c' | 'b' | Focus;  // tárolt vágási mód
	ch?: string;                    // HMAC hash a focus12-ből (csak kézi fókusznál)
}
```

A `meta.img` fordítási időben nem jelenik meg a `TMeta`-ban — cast-old a hívás helyén:

```ts
const meta = attachment.meta as { img: ImgStat };
```

Peer függőség: `sharp`

### `getMp3Duration(metaKey?)`

Olvassa az MP3 időtartamát, és új meta objektumot ad vissza, benne a `meta[metaKey]` alatt (másodpercben, szám; a hívó meta objektumát nem módosítja). Alapértelmezett `metaKey`: `'duration'`.

```ts
getMp3Duration()                  // → meta.duration
getMp3Duration('durationSeconds') // → meta.durationSeconds
```

Peer függőség: `music-metadata`

---

## Névhelpek

### `randname()`

A feltöltött fájl nevét véletlenszerű UUID-alapú névre cseréli, megtartva a kiterjesztést.

```ts
randname()
// 'photo.jpg' → 'f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg'
```

Nincs extra függőség — `crypto.randomUUID()`-t használ.
