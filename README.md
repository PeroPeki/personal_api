# Personal

Privatni dnevnik za učenje, san, fitness i prehranu. Next.js/React PWA, TypeScript, PostgreSQL i zakazani poslovi. Sučelje je na hrvatskom i prilagođeno telefonu i računalu. Bez Apple Developer članarine: Apple Health povezuje se preko Shortcutsa, a blokiranje aplikacija ostaje u ugrađenom Screen Timeu.

## Ponovno pokretanje na ovom Macu, korak po korak

Za lokalni rad koristiš tri dijela:

| Dio | Kako ga pokrećeš | Čemu služi |
|---|---|---|
| PostgreSQL baza | Docker | Čuva tvoje zapise i račun |
| Web aplikacija i API | Terminal, `npm run dev` | Sučelje i obrada zahtjeva |
| Worker | Drugi terminal, `npm run worker` | Dohvat članaka i zakazani poslovi |

**Pokretanje baze kroz Docker Desktop nije dovoljno za otvaranje aplikacije. Pokreni i web aplikaciju u terminalu.** Za ove korake trebaju ti instalirani Node.js 24 i Docker Desktop.

### 1. Otvori Docker Desktop

Pokreni **Docker Desktop** iz Applications i pričekaj da Docker engine bude spreman.

### 2. Otvori terminal u mapi projekta

U Terminalu ili ugrađenom terminalu editora upiši:

```sh
cd /Users/petarcar/Desktop/projekti/personal_api
```

### 3. Pokreni bazu

```sh
docker compose up -d db
docker compose ps db
```

Pričekaj da u ispisu vidiš `healthy`. Ponovi drugu naredbu ako još piše `starting`. Docker čuva postojeće podatke u volumeu `personal_data`, pa nakon običnog zaustavljanja zadržavaš račun i zapise.

### 4. Pokreni web aplikaciju

U istom terminalu pokreni:

```sh
npm run dev
```

Pričekaj poruku `Ready`. Ostavi terminal otvoren dok koristiš aplikaciju.

Ako terminal javi da naredba `next` nije pronađena ili nedostaje `node_modules`, prvo pokreni `npm ci`, pa ponovi `npm run dev`.

### 5. Otvori aplikaciju i prijavi se

U pregledniku otvori **http://localhost:3000**. Koristi tu adresu jer lokalni `.env` postavlja `APP_ORIGIN=http://localhost:3000`.

Podatke za prijavu pronađi u datoteci **`.local-credentials`** u mapi projekta. U Finderu pritisni **Command + Shift + .** za prikaz skrivenih datoteka. Račun je već kreiran; nakon ponovnog pokretanja koristiš istu prijavu.

### 6. Pokreni worker u drugom terminalu

Otvori novu karticu terminala i pokreni:

```sh
cd /Users/petarcar/Desktop/projekti/personal_api
npm run worker
```

Ostavi i ovaj terminal otvoren. Worker dohvaća NASA/JSTOR Daily RSS, bira dnevni tekst i nakon konfiguracije šalje večernju obavijest te tjedni AI sažetak. Za unos podataka i timer možeš koristiti aplikaciju i bez workera.

Za samo jedan ciklus dohvata, nakon kojeg se proces zatvara, koristi:

```sh
npm run worker -- --once
```

## Zaustavljanje projekta

1. U terminalu s web aplikacijom pritisni **Control + C**.
2. U terminalu s workerom pritisni **Control + C**.
3. Zaustavi bazu iz mape projekta:

```sh
docker compose stop db
```

Nakon toga možeš zatvoriti Docker Desktop. Za sljedeće pokretanje ponovi korake 1–6. Zaustavljanje Dockera zaustavlja bazu; aplikaciju i worker pokrenute kroz terminal zaustavljaš zasebno.

**Nemoj koristiti `docker compose down -v` za obično zaustavljanje:** opcija `-v` briše Docker volumene, uključujući spremljene podatke baze.

## Pokretanje gotove verzije bez razvojnog načina rada

Ako želiš koristiti produkcijski build na Macu, nakon pokretanja baze u koraku 3 zamijeni `npm run dev` ovim naredbama:

```sh
npm run build
npm run start
```

Otvori istu adresu **http://localhost:3000**. Nakon promjena koda zaustavi server, ponovi `npm run build` i pokreni `npm run start`. Koristi jedan način rada u isto vrijeme jer oba koriste port 3000. Worker pokrećeš u drugom terminalu kao u koraku 6.

## Prva instalacija ili ažuriranje

Ovaj dio koristiš pri novoj instalaciji ili nakon promjene ovisnosti i baze. Za redovno ponovno pokretanje dovoljni su prethodni koraci.

### Na ovom već pripremljenom projektu

Zadrži postojeće `.env` i `.local-credentials`. Uz pokrenutu bazu i zaustavljenu aplikaciju/worker pokreni:

```sh
npm ci
npm run db:migrate
```

Zatim pokreni aplikaciju i worker. Migracija priprema strukturu baze; nakon običnog zaustavljanja Dockera ne trebaš je ponovno pokretati.

### Na novoj instalaciji s praznom bazom

1. Kopiraj `.env.example` u `.env`.
2. Zamijeni `CHANGE_ME` jakom lozinkom u `POSTGRES_PASSWORD` i uskladi lozinku u `DATABASE_URL`. Pri korištenju posebnih znakova u URL-u moraš ih URL-kodirati.
3. Za lokalno pokretanje postavi `APP_ORIGIN=http://localhost:3000` i `APP_HOST=localhost`.
4. Iz mape projekta pokreni:

```sh
npm ci
docker compose up -d db
```

5. Pričekaj da `docker compose ps db` pokaže `healthy`, pa pokreni:

```sh
npm run db:migrate
npm run account:create -- --generate
```

6. Nastavi od koraka 4 u odjeljku za ponovno pokretanje.

Naredbu za stvaranje računa koristiš jednom na praznoj bazi. Generirane podatke pronađi u `.local-credentials` (prava 0600). Za vlastitu lozinku koristi interaktivni `npm run account:create`. Spremi prijavu u password manager. `.env` i datoteke s ključevima čuvaj privatno.

## Ako se aplikacija ne otvara

| Poruka ili simptom | Što napraviti |
|---|---|
| `Cannot connect to the Docker daemon` | Otvori Docker Desktop i pričekaj da engine bude spreman. |
| Preglednik ne otvara `localhost:3000` | Provjeri radi li `npm run dev` ili `npm run start` i je li terminal otvoren. |
| Baza nije dostupna / greška pri prijavi | Pokreni `docker compose up -d db` i provjeri `docker compose ps db`. Za logove koristi `docker compose logs --tail=50 db`. |
| Port 3000 je zauzet | Zaustavi prethodni proces aplikacije s Control + C u njegovu terminalu. Ako koristiš drugu aplikaciju na tom portu, oslobodi port prije pokretanja ovog projekta. |
| `Production build missing` | Pokreni `npm run build` prije `npm run start`. |
| Članci se ne osvježavaju | Pokreni worker i provjeri njegov ispis u drugom terminalu. |

Ako razvojni server zbog zauzetog porta ponudi port 3001, oslobodi port 3000 i ponovno ga pokreni. Lokalna konfiguracija očekuje adresu s portom 3000.

## Funkcionalnosti

- Jedan privatni račun, opozive sesije, provjera izvora zahtjeva i ograničenje pokušaja prijave.
- Pregled dana i povijest 7/30/90 dana; prazni zdravstveni podaci prikazuju se kao nedostajući.
- Timer s pauzama, trajnim vremenskim oznakama, jednom aktivnom sesijom i ispravkom završenih sesija.
- Unos težine, kratkog treninga, sna, prehrane, društvenih mreža, opsega struka, koraka i aktivne energije.
- Izračuni jasno označeni kao procjene; kalorijska procjena traži popunjen profil, energija uređaja ne dodaje se automatski unosu hrane.
- Odabrani novi unosi čuvaju se offline i sinkroniziraju s istim identifikatorom. Izmjene i brisanje postojećih zapisa traže vezu; sukobi zahtijevaju potvrdu korisnika.
- Health API uvoz s opozivim ključem koji dopušta samo slanje, atomskim batchom i zamjenom dnevnih zbrojeva bez dupliranja.
- Izvoz/povrat osobnih zapisa, brisanje praćenih podataka i šifrirane pune sigurnosne kopije.
- Lokalni savjeti po pravilima; vanjski AI i Web Push ostaju isključeni dok ih ne konfiguriraš i odobriš.

**Ograničenja:** web aplikacija ne čita Health sama, ne blokira druge iPhone aplikacije i ne dobiva automatski detaljni Screen Time izvještaj. Offline pohrana preglednika nije backup; čišćenje browser podataka može obrisati neposlane zapise. Sinkronizacija se pokušava dok je aplikacija otvorena. Timer mjeri prijavljenu sesiju, ne dokazuje učenje. San iz ručnog unosa je samoprocjena. Fitbit i nativni Screen Time API ostaju kasnija nadogradnja.

## Pristup s iPhonea i instalacija

Za isti račun s oba uređaja oba moraju pristupati istom backendu. `localhost` na telefonu znači sam telefon, a ne Mac. Za lokalni test postavi `APP_ORIGIN` na adresu Maca, pristupi istom adresom i na Macu i na iPhoneu, pa ponovno pokreni aplikaciju. To je razvojni test; za sigurnu stalnu upotrebu koristi HTTPS.

PWA instalacija, service worker i push trebaju siguran HTTPS kontekst (desktop localhost je razvojna iznimka). Na iPhoneu u Safariju odaberi Share → Add to Home Screen. Na Macu Safari → Add to Dock. Obavijesti se uključuju u postavkama aplikacije nakon konfiguracije Web Pusha. Dok Mac spava, lokalni backend ne radi.

## Apple Health

U aplikaciji pod Integracije generiraj ključ, kopiraj ga u svoj Shortcut i čuvaj ga privatno. Svaka rotacija poništava prethodni ključ. [Postupak i JSON primjer](docs/shortcuts.md), [potpuni API ugovor](docs/api.md).

Shortcuts može tražiti dopuštenje i otključan uređaj. Početno provjeri ručno pokretanje jednim dodirom; pouzdanost automatizacije treba provjeriti na fizičkom iPhoneu. Nemoj zbrajati preklopljene iPhone/Fitbit izvore bez pravila izbora izvora. Koraci i aktivna energija šalju se kao dnevni ukupni iznosi, ne kao dodatak prethodnom prijenosu.

## Vanjski AI

U `.env` odaberi pružatelja koji podržava Chat Completions HTTP format:

```dotenv
AI_API_KEY=your-private-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-model-id
AI_PROVIDER_NAME=Your provider
AI_MONTHLY_LIMIT_CENTS=500
AI_CALL_RESERVATION_CENTS=100
```

`AI_BASE_URL` je povjerljiva administratorska konfiguracija; ne može se zadavati iz korisničkih zahtjeva. Nije konfiguriran niti kupljen vanjski servis. Nakon konfiguracije ponovno pokreni server/worker, u postavkama pročitaj opis podataka i uključi izričitu dozvolu. Time dopuštaš odabranom vanjskom pružatelju obradu sažetih osobnih podataka. Opoziv zaustavlja buduće pozive; već poslane podatke nije moguće povući iz vanjskog servisa ovom aplikacijom.

Limit koristi konzervativnu rezervaciju troška po pozivu; prilagodi rezervaciju cijeni modela. To nije jamstvo stvarnog računa pružatelja. Postavi i limit potrošnje na računu pružatelja. Pogrešni i prekinuti pozivi također troše rezervaciju. Aplikacija ne mijenja ciljeve sama i bez AI-ja i dalje radi.

## Web Push (opcionalno)

Generiraj VAPID par pomoću `npx web-push generate-vapid-keys` i ručno spremi ga u `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Privatni ključ ostaje na serveru. U aplikaciji uključi obavijesti. Worker pokušava slati 30 minuta prije zadanog spavanja; isporuka ovisi o sustavu. Podržani su Apple, Google FCM i Mozilla push endpointi. Poruke ne sadrže zdravstvene vrijednosti.

## Sigurnosne kopije i povrat

```sh
npm run backup
```

Naredba pokreće `pg_dump` iz PostgreSQL containera i šifrira rezultat AES-256-GCM ključem iz `.backup-key`. Prva kopija automatski stvara privatni nasumični ključ. Kopiraj **backup i ključ odvojeno** na sigurno mjesto izvan servera; gubitak ključa znači da se šifrirana kopija ne može vratiti. Backup sadrži i račune/sesije/tokene; osobni JSON izvoz iz aplikacije ih izostavlja.

Za puni povrat prvo zaustavi `app` i `worker`. Sljedeća naredba **zamjenjuje bazu** i zahtijeva eksplicitnu potvrdu:

```sh
npm run backup -- --restore backups/your-backup.pgdump.enc --confirm-overwrite
```

Koristi izvornu `.backup-key`. Povrat vraća i stare sesije i integracijske ključeve iz kopije: opozovi ih prije ponovnog javnog pristupa. Nemoj pokretati povrat nad bazom koju želiš zadržati. Za selektivni povrat praćenih zapisa koristi osobni JSON izvoz/povrat u aplikaciji; i taj povrat zamjenjuje postojeće zapise uz potvrdu.

## Produkcija na vlastitom serveru

Deploy nije automatski pokrenut. Pripremi domenu i server s Dockerom te `.env` s `APP_HOST=your-domain.example`, `APP_ORIGIN=https://your-domain.example` i jakim DB tajnama.

```sh
docker compose --profile production build
docker compose --profile production run --rm worker npm run db:migrate
# Na novoj bazi kreiraj račun interaktivno:
docker compose --profile production run --rm -it worker npm run account:create
docker compose --profile production up -d
```

Caddy daje HTTPS za domenu. DB port vezan je samo za loopback; aplikacija se izvana izlaže kroz Caddy. Baza ima trajni volume. Nemoj koristiti development `.env` niti `COOKIE_SECURE=false` u produkciji. Pokreni backup prije ažuriranja/migracije i čuvaj ga izvan tog servera. Provjeri HTTPS i stvarni iPhone prije redovnog korištenja.

## Provjere i struktura

```sh
npm test
npm run typecheck
npm run build
# Uz pokrenutu aplikaciju i prethodno kreiran lokalni račun:
npx playwright install chromium
npm run test:e2e
```

Testovi pokrivaju domenska pravila, ulazne granice, uvoz i privatnost te šifriranje. Integracijski testovi koriste zasebnu testnu bazu. Playwright scenarij u `tests/e2e` koristi `.local-credentials`, provjerava unos, timer nakon ponovnog učitavanja, offline ponovno otvaranje, sinkronizaciju, mobilni raspored i odjavu u više kartica. U završnom čišćenju uklanja samo zapise koje je sam stvorio; pokreći ga na lokalnoj razvojnoj instanci bez aktivne osobne sesije učenja.

| Mapa | Odgovornost |
|---|---|
| `src/app` | Next.js stranice i API |
| `src/components` | Korisničko sučelje |
| `src/lib` | Domenska pravila, podaci, sinkronizacija i poslovi |
| `db` | SQL migracije |
| `scripts` | Kreiranje računa, worker i backup |
| `tests` | Automatizirane provjere |
| `docs` | API, Shortcut i implementacijske bilješke |

[Ciljevi, istraživanje i arhitektura](pocetak.md). Nema nativne iOS aplikacije, javnog launchanja niti pretplate na AI servis samim postavljanjem projekta.
