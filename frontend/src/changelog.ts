/**
 * What changed in each version, newest first, for Instellingen → Over.
 *
 * A pull request that changes what Bram sees or can do adds a version at the top, following
 * semantic versioning: the next minor version (0.2.0 after 0.1.0) for new things, the next
 * patch version for fixes only, the next major version for changes that break existing data
 * or deployments. Date it the day it is merged and write each change as one short line in
 * Dutch for the person using the app. CI tags the image with the newest version and creates a
 * GitHub release v<version> with these lines as its notes.
 */

export type Release = {
  version: string
  // The day it was merged, as YYYY-MM-DD.
  date: string
  title: string
  changes: string[]
}

export const CHANGELOG: Release[] = [
  {
    version: '0.14.0',
    date: '2026-11-25',
    title: 'Inzoomen met twee vingers in de documentviewer',
    changes: [
      'In de documentviewer zoom je nu in en uit door met twee vingers te knijpen, net als bij foto\'s. Waar je vingers staan blijft staan; als je loslaat wordt de PDF weer scherp getekend.',
      'Inzoomen kan nu tot 400%.',
      'Bij Documenten staat het oogje om een document te bekijken nu rechts van de downloadknop.',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-11-25',
    title: 'Documenten als tab, vegen tussen tabs en documenten bekijken in de app',
    changes: [
      'Rapport, Checklist, Beoordeling en Documenten beginnen meteen met de compacte kop: adres, plaats en prijs op één regel boven de tabs. De grote kop met status en knoppen staat bij Overzicht.',
      'De documenten hebben een eigen tab Documenten, rechts van Beoordeling. Op een telefoon heet die tab Docs.',
      'Veeg naar links of rechts om naar de volgende of vorige tab te gaan. Op foto\'s en dingen die zelf opzij scrollen werkt vegen zoals altijd.',
      'Documenten openen nu in de app: tik op de naam of op het oogje links van de downloadknop. PDF\'s en afbeeldingen zie je direct, met in- en uitzoomen; andere bestanden kun je daar downloaden.',
      'Ook de documenten bovenaan de checklist openen in de app.',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-11-25',
    title: 'PDF van een huis, notities ingeklapt en lettergrootte',
    changes: [
      'Met de knop PDF bij een huis maak je een PDF van de beoordeling en de hele checklist, met alle notities van iedereen. Altijd licht, compact en goed te printen.',
      'In de PDF staan ook wat het rapport zegt (score, advies, plus- en minpunten) en de antwoorden uit de documenten die nog niet zijn overgenomen.',
      'De notities in de checklist zijn nu standaard ingeklapt. Een blauw notitie-icoon laat zien waar een notitie staat; tik erop om hem te lezen.',
      'Met Notities uitklappen bovenaan de checklist open je ze allemaal tegelijk, en klap je ze ook weer in.',
      'Bij Instellingen → Weergave kies je de lettergrootte in vijf stappen. De middelste is de oude grootte.',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-11-25',
    title: 'Documenten van de makelaar bij het huis',
    changes: [
      'Huizen beoordelen zet de documenten van de makelaar in de rapporten-repo. Je vindt ze onder Overzicht bij het huis, met een duidelijke titel en de originele bestandsnaam.',
      'Tik op een document om het te openen, of op het pijltje om het te downloaden.',
      'Bovenaan de checklist zijn de documenten waar de vooraf ingevulde antwoorden uit komen nu ook aan te klikken.',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-11-25',
    title: 'Zoeken op de pagina',
    changes: [
      'Met het vergrootglas rechtsboven zoek je in de tekst van de pagina die openstaat, zoals het rapport of de checklist. Handig in de app, die geen zoekfunctie van de browser heeft.',
      'Gevonden woorden worden geel gemarkeerd, de huidige oranje. Met de pijltjes of Enter ga je naar de volgende of vorige.',
      'Hoofdletters en accenten maken niet uit: "e" vindt ook "é".',
      'Ga je naar een ander tabblad, dan blijft de zoekbalk open en zoekt hij daar verder.',
    ],
  },
  {
    version: '0.9.1',
    date: '2026-11-25',
    title: 'Overgenomen antwoord verdwijnt',
    changes: [
      'Neem je een vooraf ingevuld antwoord over, dan verdwijnt het grijze blok "Uit de documenten" bij dat punt. Oordeel, toelichting en bron staan dan in je eigen antwoord.',
      'Wis je je antwoord weer helemaal, dan komt het blok terug.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-11-25',
    title: 'Checklist vooraf ingevuld uit de documenten',
    changes: [
      'Huizen beoordelen kan uit de documenten van de makelaar antwoorden op checklistpunten vooraf invullen, met oordeel, toelichting en bron.',
      'Vooraf ingevulde antwoorden staan grijs gestippeld onder het punt en tellen niet als jullie eigen antwoord. Met Overnemen maak je er je eigen antwoord van.',
      'Nieuwe vragen uit de documenten komen in een eigen onderdeel, of in het onderdeel dat het rapport noemt.',
      'Bovenaan de checklist staat hoeveel punten vooraf zijn ingevuld en uit welke documenten.',
    ],
  },
  {
    version: '0.8.4',
    date: '2026-11-25',
    title: 'Huis verwijderen naast Opslaan',
    changes: ['In het venster Gegevens staat Huis verwijderen nu links op dezelfde regel als Annuleren en Opslaan; op de telefoon als prullenbakje.'],
  },
  {
    version: '0.8.3',
    date: '2026-11-25',
    title: 'Verouderde bladwijzer herkennen, verwijderen onder Gegevens',
    changes: [
      'De bladwijzer stuurt zijn versie mee. Gebruik je een oude bladwijzer, dan meldt hij op Funda dat hij verouderd is, met een link om hem opnieuw neer te zetten.',
      'Zet de bladwijzer na deze update één keer opnieuw neer via Instellingen → Bladwijzer.',
      'De knop Huis verwijderen staat nu onder Gegevens bij het huis, niet meer onderaan Mijn beoordeling.',
    ],
  },
  {
    version: '0.8.2',
    date: '2026-11-25',
    title: 'Bladwijzer alleen voor Funda',
    changes: [
      'De bladwijzer werkt alleen nog op een huis op funda.nl. Op een andere site meldt hij dat en stuurt hij niets.',
      'De bladwijzer voegt geen nieuwe huizen meer toe: hij slaat de advertentie alleen op bij een huis dat al in de app staat. Nieuwe huizen komen erin via de rapporten.',
    ],
  },
  {
    version: '0.8.1',
    date: '2026-11-24',
    title: "Foto's, video's en memo's in de Android-app",
    changes: [
      "In de Android-app staat Huizenjacht nu in het deelmenu: deel foto's, video's of spraakmemo's vanuit je galerij of een andere app, en kies daarna het huis.",
      "Zonder Chrome opent de app voor Opnemen meteen de camera (foto of video) en kun je meerdere bestanden tegelijk kiezen.",
      'Zonder Chrome vraagt de app de eerste keer toestemming voor de camera en de microfoon, voor foto\'s en spraakmemo\'s.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-11-24',
    title: "Foto's, video's en spraakmemo's",
    changes: [
      "Maak bij een checklistpunt een foto of spraakmemo met de knoppen naast het punt. Via de notitieknop neem je ook een video op of kies je bestanden van je toestel.",
      "Bovenaan de checklist staan foto's, video's en memo's over het huis in het algemeen. Tik erop om ze groot te zien, er een notitie bij te zetten of ze bij een ander punt te hangen.",
      "Zonder bereik bewaart de app wat je opneemt en stuurt hij het zelf door zodra er weer verbinding is.",
      "Deel foto's en video's vanuit je galerij met Huizenjacht; de app vraagt bij welk huis ze horen.",
      "Wat de één toevoegt, ziet de ander meteen.",
    ],
  },
  {
    version: '0.7.3',
    date: '2026-11-24',
    title: 'Android-app via F-Droid',
    changes: [
      'De Android-app staat nu ook in een eigen F-Droid-repository, voor F-Droid, Droid-ify en Neo Store. Hoe je die toevoegt, staat in Instellingen → Over.',
    ],
  },
  {
    version: '0.7.2',
    date: '2026-11-24',
    title: 'Uitleg bij knoppen',
    changes: [
      'Houd je vinger op een knop om te zien wat hij doet; met de muis zie je dat als je even stilstaat. Het tikken zelf doet dan niets.',
      'Op je telefoon staan zoeken en sorteren op één regel. Sorteren is een knop met pijltjes.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-11-24',
    title: 'Rustiger overzicht',
    changes: ['De knop "Huis toevoegen" staat niet meer boven het overzicht: huizen komen binnen via de rapporten.'],
  },
  {
    version: '0.7.0',
    date: '2026-11-24',
    title: 'Android-app',
    changes: [
      'Huizenjacht is er nu als Android-app. Je vindt hem bij elke release op GitHub en houdt hem bij met Obtainium; zie Instellingen → Over.',
      'De app vraagt de eerste keer op welk adres jouw Huizenjacht draait. Inloggen gaat in de app zoals in de browser.',
      'Met Chrome op je telefoon opent de app Huizenjacht in Chrome, zonder adresbalk, en blijf je ingelogd zoals in Chrome. Zonder Chrome gebruikt hij een eigen venster.',
      'Het serveradres wijzig je door het app-icoon ingedrukt te houden en Server wijzigen te kiezen.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-11-24',
    title: 'Ieders eigen antwoorden, live bijgewerkt',
    changes: [
      'Iedereen die inlogt, heeft een eigen checklist, cijfer, sterren en notities per huis. Status, favoriet, bezichtiging en bod zijn gedeeld.',
      'In de checklist en bij Mijn beoordeling zie je de antwoorden van de ander eronder, met een eigen kleur en de eerste letter van de naam.',
      'Wat de ander invult, verschijnt direct, zonder de pagina te verversen.',
      'Je eerdere antwoorden blijven van jou. Kan de app niet zien van wie ze zijn, dan staan ze onder "Eerder ingevuld" en zet je ze met één knop op je naam.',
      'De tabbladen van een huis staan nu in de volgorde Overzicht, Rapport, Checklist, Mijn beoordeling.',
      'In het overzicht staat de favorietenster als rode knop rechtsboven in de foto, en de knop Vergelijk staat een regel hoger.',
    ],
  },
  {
    version: '0.5.2',
    date: '2026-11-24',
    title: 'Fotogalerij van Funda',
    changes: ['"Open in nieuw tabblad" bij de foto\'s opent de fotogalerij van de advertentie op Funda.'],
  },
  {
    version: '0.5.1',
    date: '2026-11-24',
    title: 'Link naar de bladwijzer bij een huis',
    changes: [
      'Zijn de advertentie en foto\'s van een huis nog niet opgehaald, dan staat bij dat huis de knop "Ophalen met bladwijzer". Die brengt je naar de bladwijzer in Instellingen.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-24',
    title: 'Checklist uit het rapport, vaste kop en bladwijzer op de achtergrond',
    changes: [
      'De checklist van een huis begint nu met de afvinklijst en open vragen uit het rapport van dat huis, per onderdeel zoals in het rapport (bij de bezichtiging, vóór het bieden).',
      'Met "Ook de standaardlijst" kies je of de algemene punten er daarna nog bij staan.',
      'Bij het scrollen op de pagina van een huis blijven het adres en de tabbladen bovenin staan, ook op je telefoon.',
      'Op een telefoon staan lange checklistpunten over de volle breedte, met de knoppen eronder.',
      'De knop Advertentie opent Funda weer direct in een nieuw tabblad.',
      'De bladwijzer stuurt de pagina op de achtergrond naar Huizenjacht en laat rechtsonder op Funda zien of het gelukt is; je blijft op Funda. Een huis dat nog niet in de app staat, wordt toegevoegd.',
      'Zet de bladwijzer opnieuw in je bladwijzerbalk: hij bevat nu een eigen sleutel, die je in Instellingen kunt vernieuwen.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-11-24',
    title: 'Bladwijzer voor Funda',
    changes: [
      'Funda geeft servers een captcha. Met de nieuwe bladwijzer "Naar Huizenjacht" stuur je de advertentie die jij op Funda ziet met één klik naar de app, met de foto\'s. Instellen doe je onder Instellingen → Bladwijzer voor Funda.',
      'Je kunt ook een opgeslagen Funda-pagina (Ctrl+S) uploaden in het advertentievenster.',
      'Mag de app een foto niet zelf downloaden, dan laat je browser hem rechtstreeks van Funda zien.',
      'De app probeert een geblokkeerde advertentie nog maar eens per drie dagen zelf op te halen.',
    ],
  },
  {
    version: '0.3.2',
    date: '2026-11-24',
    title: 'Ophalen van advertenties zichtbaar',
    changes: [
      'In het advertentievenster zie je nu wanneer de advertentie is opgehaald, hoeveel foto\'s er zijn en wat er misging, met een knop Opnieuw ophalen.',
      'Lukt het ophalen niet, dan staat er een waarschuwing op de huispagina. Met "Wat de site stuurde" kun je de pagina downloaden die de site teruggaf.',
      'Een pagina zonder advertentie of foto\'s (zoals een blokkade) telt niet meer als gelukt.',
      'Nieuwe huizen worden binnen vijf minuten opgehaald, en de serverlog laat elke poging zien.',
    ],
  },
  {
    version: '0.3.1',
    date: '2026-11-24',
    title: 'Inloggen probeert het opnieuw',
    changes: [
      'Komt een login terug die in een ander tabblad of een andere browsercontainer begon, dan probeert de app het eerst zelf nog één keer voordat je een foutmelding ziet.',
      'Een oude login-link terwijl je al bent ingelogd brengt je gewoon terug naar de app.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-11-24',
    title: "Foto's en advertentie in de app",
    changes: [
      "De app haalt zelf de foto's en een kopie van de advertentie op, en bewaart ze. Bekijk alle foto's op de huispagina of in de fotogalerij.",
      'Nieuwe knop Google Maps naast Advertentie.',
      'De advertentie opent in een venster binnen de app, met een knop om hem toch in een nieuw tabblad te openen. Ctrl+klik of middelste muisknop opent meteen een nieuw tabblad.',
      'Lukt het ophalen niet, dan zie je waarom en kun je het met "Nu ophalen" opnieuw proberen.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-11-24',
    title: 'Inloggen met Authelia',
    changes: [
      'Huizenjacht kan nu zelf laten inloggen via OIDC, zoals met Authelia. Wie niet is ingelogd, gaat eerst naar de login en komt daarna terug op dezelfde pagina.',
      'Alleen de groepen of gebruikers die je kiest krijgen toegang.',
      'Onder Instellingen → Account zie je met welk account je bent ingelogd en kun je uitloggen.',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-11-24',
    title: 'Rapporten uit Huizen beoordelen netter getoond',
    changes: [
      'Eigendom toont “Eigen grond” of “Erfpacht” in plaats van “False”.',
      'Het id van een rapport staat niet meer onder Overige gegevens.',
      'Een wijk met dezelfde naam als de plaats staat niet meer dubbel onder het adres.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-11-24',
    title: 'De eerste versie van Huizenjacht',
    changes: [
      'Overzicht van alle huizen met zoeken, filteren op status en sorteren op prijs, prijs per m², oppervlakte en cijfers.',
      'Per huis de kenmerken, het rapport, je eigen notities, een cijfer en de bezichtigingsdatum.',
      'Bezichtigingschecklist per huis, met punten uit het rapport erbij. Het sjabloon pas je aan onder Instellingen.',
      'Vergelijk tot vier huizen naast elkaar; de beste waarde per regel valt op.',
      'Rapporten komen binnen uit de private rapporten-repo of via uploaden, en komen nooit in de publieke code.',
      'Back-up downloaden en terugzetten, licht en donker thema, en installeren als app.',
    ],
  },
]

export function currentVersion(): string {
  return CHANGELOG[0].version
}

export function formatReleaseDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const SEEN_KEY = 'hj.changelogSeen'

export function unseenCount(): number {
  let seen: string | null = null
  try {
    seen = localStorage.getItem(SEEN_KEY)
  } catch {
    return 0
  }
  if (!seen) return 0
  const index = CHANGELOG.findIndex((r) => r.version === seen)
  return index === -1 ? 0 : index
}

export function markChangelogSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, currentVersion())
  } catch {
    // private mode: nothing to remember
  }
}
