# Apple Health → Personal API

Ovo je ručni vodič za izradu Shortcutsa u Appleovoj aplikaciji na tvom iPhoneu. Nije automatski instaliran niti potpisan `.shortcut` paket. Za provjeru treba stvarni uređaj i dopuštenje čitanja odabranih Health kategorija.

## Priprema

1. Pokreni backend na adresi dostupnoj iPhoneu, za stalnu upotrebu preko HTTPS-a.
2. Prijavi se u Personal, otvori Integracije i generiraj novi Health ključ. Prikazuje se samo jednom. Spremi ga samo u svoj Shortcut; ne u javnu poveznicu, Git ili screenshot. Rotacija/revokacija poništava prethodni ključ.
3. U Shortcuts napravi novi prečac, primjerice „Pošalji Health”.

## Koraci u prečacu

1. Odredi datum za prijenos u formatu `yyyy-MM-dd` i vremensku zonu jednaku profilu aplikacije.
2. Dodaj `Find Health Samples`, odaberi Steps i filtriraj lokalni dan koji želiš prenijeti. Uz samo iPhone izaberi njegov izvor. Nakon dodavanja drugog izvora nemoj slijepo zbrojiti preklopljene zapise: izaberi pouzdan izvor i usporedi rezultat s Healthom.
3. Dobij ukupnu vrijednost koraka za odabrani dan. Po potrebi ponovi za Active Energy, Weight ili druge podržane metrike. Za težinu šalji odabrano posljednje mjerenje u kg. Za san šalji ukupne sate sna, ne zbroj sna i vremena u krevetu; preklapanja i faze treba objediniti prije slanja. Za početak je dovoljno poslati korake.
4. Izradi Dictionary/JSON objekt ispod. `externalId` neka bude stabilan za metriku i dan, npr. `iphone-steps-2026-10-15`; isto ponovno slanje mora koristiti istu vrijednost ID-ja. Vrijednost mora biti Number, ne tekst s jedinicom ili lokalnim zarezom.
5. Dodaj URL `https://TVOJA-DOMENA/api/v1/health/import`.
6. `Get Contents of URL`: metoda POST, Request Body JSON, header `Authorization: Bearer TVOJ_KLJUC`. Dodaj `Content-Type: application/json` ako ga alat ne postavi.
7. Prikaži rezultat ili obavijest o uspjehu tek kada dobiješ `ok: true`. Pogrešku zadrži vidljivom i pokušaj ponovno nakon otključavanja i provjere veze.

```json
{
  "timezone": "Europe/Lisbon",
  "records": [
    {
      "externalId": "iphone-steps-2026-10-15",
      "metric": "steps",
      "date": "2026-10-15",
      "value": 8340
    },
    {
      "externalId": "iphone-energy-2026-10-15",
      "metric": "activeCalories",
      "date": "2026-10-15",
      "value": 410
    }
  ]
}
```

Ovo su ilustrativne vrijednosti; zamijeni ih varijablama iz Healtha. Jedan batch smije imati 1–500 zapisa. Podržano: `steps`, `activeCalories`, `weightKg`, `sleepHours`, `nutritionCalories`, `proteinGrams`. Datum sna pripada danu buđenja. Isti dnevni iznos zamjenjuje prethodni; ne šalji promjenu kao da je ukupan iznos.

Automatizaciju možeš kasnije vezati uz odabrani događaj, ali Health čitanje može tražiti otključan uređaj i dodatno dopuštenje. Nemoj računati na neprekidno pozadinsko osvježavanje. Na dashboardu provjeri vrijeme posljednjeg uvoza. Ako ručno uneseš korekciju iste metrike, aplikacija daje prednost ručnom zapisu; pročitaj pravila u [API ugovoru](api.md).

## Screen Time

Ugrađeni Screen Time jednom konfiguriraj za zajednički limit od 60 minuta na odabrane društvene mreže i večernji raspored. Za početni cilj spavanja možeš odabrati blokadu od 00:30. Gumb u našoj web aplikaciji ne može uključiti tu blokadu. Focus način koji utišava obavijesti nije isto što i blokiranje aplikacija.

## Izvori

- [Apple: Find Health Samples](https://support.apple.com/en-il/guide/shortcuts/apd3c845e881/ios)
- [Apple: slanje HTTP/JSON zahtjeva](https://support.apple.com/en-az/guide/shortcuts/apd58d46713f/ios)
- [Apple: Screen Time rasporedi](https://support.apple.com/en-ae/guide/iphone/iphb0c7313c9/ios)
