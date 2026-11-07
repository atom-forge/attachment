# TODO

Tervezett munka, fontossági sorrendben. A részletek és az ötletek a `notes/` mappában vannak; a szabályok az `AGENTS.md`-ben.

1. **Release: váltás az `@atom-forge/ship`-re.** A `scripts/pub.ts`, `pub-check.ts` és `changelog-release.ts` helyett `ship-it`: devDependency, `package.json` `ship.verify` a csomag ellenőrző parancsaival, `pub` / `pub-check` scriptek, a publish workflow-ban `ship-it validate` (a `ship-it init` beállítja). Megoldja a tiszta munkakönyvtár ellenőrzését és az atomikus pusht is. Utána az `AGENTS/devrules.md` release-sorát frissíteni. Minta: date-format.
2. **`README-AI.md` az `AGENTS/documentation.md` szerint:** egyfájlos tömör referencia — alapszabályok, publikus API szignatúrákkal, minimális teljes példa, gyakori bővítések, buktatók, dokumentációs térkép, és hogy ütközésnél a `docs/en` a mérvadó. A „Working on this repository” szakasz fejlesztői tartalom: át az `AGENTS/devrules.md`-be.
3. **Atomi mód éles ellenőrzése:** a Prisma-példák (sorzár, összehasonlítás és csere) valódi PostgreSQL/MySQL ellen, az S3 provider feltételes írásai (`If-None-Match`, `If-Match`, `CopyObject`) AWS-en és MinIO-n, két külön folyamatból.
4. **Árva fájlok a soha többé nem módosított entitásoknál:** opcionális `sweep()` segéd, amit az app időnként futtat (az entitások vagy a tároló mappáinak bejárásával).
5. **Tesztek és CI:** van `test` script (`bun test`) és tesztek az atomi módhoz; hiányoznak az alapmód, a szerverek és a middleware-ek tesztjei (a `sharp` Bun alatt lefagy, ezekhez Node kell) és a CI-workflow.
