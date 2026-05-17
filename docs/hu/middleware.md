# Upload Middleware

A middleware-ek sorban futnak le az `add()` és `replace()` előtt. `AttachmentValidationError` dobásával megszakítható a feltöltés.

```ts
type UploadMiddleware<TMeta = unknown> = (
	file: File,
	meta: TMeta,
	files: AttachmentData<TMeta>[],   // meglévő fájlok a kategóriában
) => Promise<{ file: File; meta: TMeta }>;
```

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

A feltöltött képet WebP formátumba konvertálja.

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

Olvassa a kép méretét, domináns színét, animált jelzőjét és vágási módját. Egy `ImgStat` objektumot injektál a `meta.img`-be.

| Paraméter   | Típus                        | Alapért. | Leírás                                             |
|-------------|------------------------------|----------|----------------------------------------------------|
| `cropMode`  | `'e' \| 'a' \| 'c' \| Focus` | `'e'`    | Tárolt vágási stratégia a thumbnail URL építéshez  |
| `focusHash` | `FocusHashFn`                | —        | Szükséges `meta.img.ch` tárolásához kézi fókusznál |

```ts
imgstat()        // entropy vágás (alapértelmezett)
imgstat('a')     // attention vágás
imgstat('c')     // középre vágás
imgstat({x: 500, y: 300, s: {x: 0, y: 0, w: 1000, h: 1000}})  // kézi fókuszpont
```

Az injektált `ImgStat`:

```ts
interface ImgStat {
	w: number;                    // szélesség px
	h: number;                    // magasság px
	d: string;                    // domináns szín (#rrggbb)
	a: boolean;                   // animált (GIF / animált WebP)
	c: 'e' | 'a' | 'c' | Focus;  // tárolt vágási mód
	ch?: string;                    // HMAC hash a focus12-ből (csak kézi fókusznál)
}
```

A `meta.img` fordítási időben nem jelenik meg a `TMeta`-ban — cast-old a hívás helyén:

```ts
const meta = attachment.meta as { img: ImgStat };
```

Peer függőség: `sharp`

### `getMp3Duration(metaKey?)`

Olvassa az MP3 időtartamát és injektálja a `meta[metaKey]`-be (másodpercben, szám). Alapértelmezett `metaKey`: `'duration'`.

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
