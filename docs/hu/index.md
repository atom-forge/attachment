# @atom-forge/attachment

Hordozható, frameworkfüggetlen fájlcsatoló rendszer Prisma entitásokhoz.

A legtöbb alkalmazásnak előbb-utóbb fájlokat kell csatolnia az adataihoz: avatart egy felhasználóhoz, galériát egy termékhez, PDF-et egy számlához. Az `@atom-forge/attachment` ezt egyszerűen tartja. Nincs külön fájltábla; minden fájl metaadata egyetlen `Json?` oszlopban él azon az entitáson, amelyhez tartozik, maguk a fájlok pedig egy általad választott tárolóban vannak: a helyi lemezen vagy S3/MinIO-ban.

## Kinek szól ez a dokumentáció

Azoknak a fejlesztőknek, akik egy TypeScript szerveralkalmazásban (Node.js vagy Bun) Prisma entitásokhoz tárolnak fájlokat, olyan frameworkkel, mint a SvelteKit, a Hono, az Express, a Next.js vagy a Nuxt, és feltöltést, képvariánsokat és fájlkiszolgálást szeretnének fájltábla vagy külön médiaszolgáltatás építése nélkül. A dokumentáció feltételezi, hogy ismered valamennyire a Prismát és a frameworköd kéréskezelését.

## Hogyan olvasd ezt a dokumentációt

A fejezetek egymásra épülnek, ezért érdemes sorrendben olvasni őket:

1. **[Kezdeti lépések](getting-started.md)**: néhány perc alatt végigvezet a sémától a feltöltésen át az URL-ig.
2. **[Handler API](handler-api.md)**: minden műveletet bemutat, amit egy entitás fájljain futtathatsz.
3. **[Middleware](middleware.md)**: elmagyarázza, hogyan validálódnak és transzformálódnak a feltöltések.
4. **[Képkezelés](image.md)**: bemutatja, hogyan működnek a thumbnailek és a képvariánsok.
5. **[Fájlkiszolgálás](serving.md)**: mindezt bekötöd a frameworködbe és a reverse proxyba.
6. **[Tárolás](storage.md)**: leírja a JSON formátumot, a providereket és az eseményeket, amelyek mindez mögött állnak.
7. **[Hozzáférés-szabályozás](access-control.md)**: elmagyarázza, hogyan lesz egy kategória publikus vagy jogosultsághoz kötött, és hogyan védi a reverse proxy és a tároló a jogosultsághoz kötött fájlokat.

Ha korábbi verzióról frissítesz, olvasd el a **[Frissítés](upgrading.md)** fejezetet: verzióról verzióra felsorol minden változást, amely teendővel jár. Az **[AI jegyzetek](ai-notes.md)** másolható utasításokat ad a csomagot használó projektekben dolgozó kódoló ágenseknek.

> **Sietsz?** Olvasd el a [Kezdeti lépések](getting-started.md) fejezetet, aztán ugorj az aktuális feladatodhoz tartozó fejezetre. Az első után minden fejezet önállóan is megállja a helyét.
