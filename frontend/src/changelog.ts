/**
 * What changed in each version, newest first, for Instellingen → Over.
 *
 * A pull request that changes what Bram sees or can do adds a version at the top, following
 * semantic versioning: the next minor version (0.2.0 after 0.1.0) for new things, the next
 * patch version for fixes only, the next major version for changes that break existing data
 * or deployments. Date it the day it is merged and write each change as one short line in
 * Dutch for the person using the app. CI tags the image with the newest version and creates a
 * GitHub release v<version> with these lines as its notes.
 *
 * A version that changes the Android app (android/) also lists those changes under `android`.
 * Only such a version gets a new APK: CI builds the app with the newest version that has
 * `android` and attaches it to that release only, so Obtainium and F-Droid offer an update
 * just when the app itself changed. Web changes reach the app without a new APK.
 */

export type Release = {
  version: string
  // The day it was merged, as YYYY-MM-DD.
  date: string
  title: string
  changes: string[]
  // What changed in the Android app; set only when this version comes with a new APK.
  android?: string[]
}

export const CHANGELOG: Release[] = [
  {
    version: '0.29.0',
    date: '2026-11-28',
    title: 'Huis delen zonder inloggen',
    changes: [
      'Met de knop Delen bij een huis maak je een link die iemand zonder account kan openen.',
      'Die ziet alleen het adres, de kenmerken en de link naar de advertentie, en als je dat aanzet de foto\'s en de samenvatting uit het rapport.',
      'Notities, checklist, cijfers, bod, bezichtiging, eigen foto\'s en memo\'s en documenten blijven privé.',
      'Maak een nieuwe link of stop met delen wanneer je wilt; de oude link werkt dan meteen niet meer.',
    ],
  },
  {
    version: '0.28.0',
    date: '2026-11-27',
    title: 'Genummerde checklist',
    changes: [
      'Elk punt in de checklist heeft een nummer, zodat je samen makkelijk naar een punt verwijst.',
      'Het nummer blijft hetzelfde bij Korte bezichtiging, Alleen open punten en zonder de standaardlijst.',
      'Het PDF-rapport toont dezelfde nummers.',
    ],
  },
  {
    version: '0.27.1',
    date: '2026-11-27',
    title: 'Zonder klok',
    changes: ['De aftellende klok bij Korte bezichtiging is weg; de tijdkeuze en de prioriteiten blijven.'],
  },
  {
    version: '0.27.0',
    date: '2026-11-26',
    title: 'Korte bezichtiging',
    changes: [
      'Elk checklistpunt heeft een prioriteit: Moet, Belangrijk, Optioneel of Later (thuis of vóór het bieden).',
      'Met Korte bezichtiging zie je alleen wat in je tijd past (15 tot 60 minuten), de moet-punten eerst; de rest staat ingeklapt eronder.',
      'Wat de documenten al in orde vinden zakt een stap, een probleem uit de documenten wordt een moet-punt.',
      'Tik op de prioriteit bij een punt om die voor dit huis te veranderen; dat geldt voor jullie allebei.',
      'Een klok telt de bezichtiging af vanaf het moment dat je op Start de klok tikt.',
      'Punten uit het rapport onder Vóór het bieden staan op Later; Huizen beoordelen kan een punt beginnen met (moet), (optioneel) of (later).',
      'Bij Instellingen → Checklist zet je de prioriteit van de standaardpunten.',
    ],
  },
  {
    version: '0.26.0',
    date: '2026-11-26',
    title: 'Mooier PDF-rapport',
    changes: [
      'Het PDF-rapport begint met de foto van het huis en een kaartje van de buurt ernaast.',
      'Iconen bij de kenmerken, de beoordeling, de checklist en elk antwoord, en sterren voor de onderdelen.',
      'Score, cijfers, bezichtiging en bod staan als duidelijke blokken bovenaan.',
      'Het kaartje komt via de eigen server en wordt bewaard; met map.enabled: false in de Helm chart gaat er niets over een huis naar buiten.',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-11-26',
    title: 'Naar het vorige of volgende huis',
    changes: [
      'Rechtsboven op een huis staan twee pijlen naar het vorige en volgende huis, in de volgorde van het overzicht, met dezelfde zoekterm en hetzelfde filter. Terug gaat nog steeds naar Alle huizen.',
      'Zoekterm en filter op het overzicht blijven staan als je een huis opent en weer teruggaat.',
    ],
  },
  {
    version: '0.24.2',
    date: '2026-11-26',
    title: 'Kleinere knoppen op de huiskaarten',
    changes: [
      'Vergelijk en Advertentie op de huiskaarten zijn nu kleine icoonknoppen. Vergelijk heeft het kolommen-icoon uit het menu, zodat er weer ruimte is voor de voortgang.',
    ],
  },
  {
    version: '0.24.1',
    date: '2026-11-26',
    title: 'Geen onverwacht herladen meer',
    changes: [
      'Een nieuwe versie laadt alleen nog vanzelf als je de app vers opstart. Keer je terug naar de app die nog openstond, dan blijft alles staan en zie je de melding dat er een nieuwe versie klaarstaat.',
    ],
  },
  {
    version: '0.24.0',
    date: '2026-11-26',
    title: 'Advertentie vanaf het overzicht',
    changes: [
      'Op de huiskaarten in het overzicht staat nu een knop Advertentie met gele rand, rechts naast Vergelijk. Die opent de Funda-advertentie in een nieuw tabblad.',
    ],
  },
  {
    version: '0.23.0',
    date: '2026-11-26',
    title: 'Elke nacht een back-up',
    changes: [
      'De server maakt elke nacht om 03:00 een volledige back-up, met alle foto’s, video’s, spraakmemo’s, documenten en advertenties, en bewaart die 5 dagen.',
      'Onder Instellingen → Gegevens en back-up zie je die back-ups. Je kunt ze daar downloaden of terugzetten.',
      'Back-ups maken, downloaden en terugzetten kan alleen wie in de groep admins zit. Log na deze update één keer opnieuw in, zodat de app je groepen kent.',
    ],
  },
  {
    version: '0.22.0',
    date: '2026-11-26',
    title: 'Alle foto’s van een advertentie',
    changes: [
      'De bladwijzer neemt nu alle foto’s van een Funda-advertentie mee, niet alleen de eerste paar: hij haalt zelf ook de fotopagina van het huis op. Dat werkt op de advertentie en op de fotopagina (…/media/fotos/).',
      'Foto’s worden opgeslagen op 1440 pixels breed: scherp genoeg om in te zoomen, zonder dat een huis met veertig foto’s veel ruimte inneemt.',
      'De bladwijzer is daarvoor vernieuwd (versie 3). Zet hem opnieuw neer via Instellingen → Bladwijzer; de oude zegt op Funda dat hij verouderd is.',
      'Zoeken naar updates onder Instellingen → Over staat niet meer in een grijs vlak.',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-11-26',
    title: 'Zien wat ruimte inneemt, en een back-up met alles erin',
    changes: [
      'Onder Instellingen → Gegevens en back-up zie je hoeveel ruimte de app op de server gebruikt, verdeeld over foto’s, video’s, spraakmemo’s, documenten, advertenties en gegevens, en hoeveel er nog vrij is.',
      'De back-up kan nu ook alles meenemen: foto’s, video’s, spraakmemo’s, documenten en advertenties, samen in één ZIP-bestand. Alleen de gegevens als klein JSON-bestand kan nog steeds.',
      'Zo’n ZIP-back-up zet je ook weer terug, met alle bestanden erbij.',
      'Zoeken naar updates staat nu in het blok van de app onder Instellingen → Over, en zegt of je de nieuwste versie hebt.',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-11-26',
    title: 'Inloggen met je telefoon, en niets kwijt zonder bereik',
    changes: [
      'Lukt inloggen op een apparaat niet, zoals op een tablet? Kies daar Inloggen met je telefoon, scan de QR-code met je telefoon en bevestig dat de code klopt. Het apparaat is dan ingelogd met jouw account.',
      'Onder Instellingen → Account zie je op welke apparaten je bent ingelogd, en kun je een apparaat uitloggen.',
      'Vink je zonder bereik iets af, of geef je een cijfer of notitie, dan blijft dat op je telefoon bewaard en gaat het vanzelf mee zodra er weer verbinding is. Ook als je de app tussendoor sluit.',
      'Snel achter elkaar afvinken gaat altijd in de goede volgorde naar de server, zodat er geen vinkje meer verdwijnt.',
      'Een foto of video wordt niet meer dubbel opgeslagen als de verbinding net op het verkeerde moment wegvalt, of als de app in twee tabbladen open staat.',
    ],
  },
  {
    version: '0.19.8',
    date: '2026-11-26',
    title: 'Veiligheidsverbeteringen na een review',
    changes: [
      'Een kapotte back-up terugzetten wist je huizen niet meer: het gaat helemaal goed of er verandert niets.',
      'De server neemt van de bladwijzer nooit meer dan een pagina aan, zodat niemand hem met een enorme upload kan laten vastlopen.',
      'Foto\'s en documenten kunnen geen script meer draaien in de app; onbekende soorten documenten worden alleen gedownload.',
      'Bij een advertentiepagina haalt de server alleen foto\'s van funda.nl op, geen andere adressen.',
      'Uitloggen haalt de offline kopie van je huizen van het apparaat.',
    ],
  },
  {
    version: '0.19.7',
    date: '2026-11-26',
    title: 'Niet meer per ongeluk verversen',
    changes: [
      'Heb je al getikt kort na het openen, dan laadt een nieuwe versie niet meer vanzelf onder je vinger. Je krijgt dan de melding om te vernieuwen.',
    ],
    android: [
      'Omlaag trekken om te verversen werkt alleen nog bij een duidelijke trek recht omlaag, ver genoeg over het scherm. Een tik, of een vinger die bij het tikken een beetje schuift, ververst niet meer.',
    ],
  },
  {
    version: '0.19.6',
    date: '2026-11-26',
    title: 'Sorteren geldt ook voor favorieten',
    changes: [
      'Sorteren in het overzicht werkt weer zoals je verwacht: favorieten staan niet meer altijd bovenaan, maar op hun plek in de gekozen volgorde. Alleen favorieten zien kan met de filterknop Favorieten.',
    ],
  },
  {
    version: '0.19.5',
    date: '2026-11-26',
    title: 'Geen oude melding Ophalen mislukt meer',
    changes: [
      'De server probeert advertenties niet meer zelf op te halen, want Funda blokkeert dat. Advertenties komen alleen nog binnen via de bladwijzer of een opgeslagen pagina.',
      'Mislukt een nieuwe poging, dan blijft de goede kopie gewoon staan, zonder rode melding. Je krijgt de fout alleen te zien op het moment zelf.',
      'Oude meldingen Ophalen mislukt bij huizen die al een goede kopie hebben, zijn opgeruimd.',
    ],
  },
  {
    version: '0.19.4',
    date: '2026-11-26',
    title: 'Nieuwe versie meteen bij openen',
    changes: [
      'Staat er een nieuwe versie klaar als je de app opent of er na een tijdje naar terugkeert, dan laadt die meteen. Je hoeft dan niet meer op Vernieuwen te tikken.',
      'Komt er een nieuwe versie terwijl je de app al even gebruikt, dan zie je nog steeds de melding, zodat je niets kwijtraakt.',
    ],
  },
  {
    version: '0.19.3',
    date: '2026-11-26',
    title: 'Geen waarschuwing meer in Obtainium',
    changes: [
      'Releases zonder nieuwe Android-app zijn op GitHub een pre-release. Obtainium slaat ze over en waarschuwt niet meer dat updates misschien niet doorkomen.',
    ],
  },
  {
    version: '0.19.2',
    date: '2026-11-26',
    title: 'Vloeiender rondkijken op een ingezoomde foto',
    changes: [
      'Rondkijken op een ingezoomde foto gaat soepeler. Na een veeg glijdt de foto nog even door, zoals bij het scrollen door een pagina.',
    ],
    android: [
      'Knijpen om te zoomen laadt de pagina niet meer per ongeluk opnieuw. In een geopend venster, zoals een foto, een document of de galerij, werkt omlaag trekken om te verversen niet meer. Op de pagina zelf werkt het nog wel.',
    ],
  },
  {
    version: '0.19.1',
    date: '2026-11-26',
    title: 'Uitzoomen stopt bij 100%',
    changes: [
      'In de fotoweergave en de documentenviewer zoom je niet meer kleiner uit dan 100%. Zo ben je makkelijk weer terug op de gewone grootte.',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-11-26',
    title: 'Foto\'s schermvullend bekijken en inzoomen',
    changes: [
      'Tik in de galerij op een foto: die opent dan schermvullend.',
      'Daar zoom je met twee vingers of door twee keer te tikken, en sleep je om rond te kijken. Op de computer werkt het scrollwiel en dubbelklikken.',
      'Veeg naar links of rechts voor de volgende of vorige foto. Op de computer gebruik je de pijltjes.',
      'Terug of een klik naast de foto brengt je terug in de galerij. In de lijst onder elkaar zoom je niet meer, dat scrolt rustiger.',
      'De knoppen Opnieuw ophalen en Nu ophalen zijn weg, want ze werkten niet. De advertentie komt binnen via je bladwijzer.',
    ],
  },
  {
    version: '0.18.1',
    date: '2026-11-26',
    title: 'Fotogalerij sluiten door ernaast te klikken',
    changes: [
      'Klik je op een groot scherm naast de foto\'s in de galerij, of buiten het venster, dan sluit het en ben je terug bij het huis.',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-11-26',
    title: 'Foto\'s swipen, onder elkaar bekijken en inzoomen',
    changes: [
      'Bij een huis veeg je met je vinger naar links of rechts door de foto\'s. De pijltjes werken nog steeds.',
      'Tik op een foto: alle foto\'s staan dan groot onder elkaar, zodat je er doorheen scrolt. Je begint bij de foto waarop je tikte.',
      'In die weergave zoom je in met twee vingers, of met de knoppen − en + rechtsonder.',
    ],
  },
  {
    version: '0.17.2',
    date: '2026-11-26',
    title: 'Rustigere huiskaarten in het overzicht',
    changes: [
      'Huiskaarten hebben een vaste indeling: prijs met het energielabel rechts ernaast, de kenmerken op één regel met puntjes ertussen.',
      'Je bezichtiging staat als datum op de foto, onder de status.',
      'Cijfers, voortgang en Vergelijk staan onderaan onder een dun lijntje, ook bij de grootste letters netjes uitgelijnd.',
      'Op je telefoon is de foto iets minder hoog en lopen de filterknoppen door tot de rand, zodat je ziet dat je ze kunt schuiven.',
    ],
  },
  {
    version: '0.17.1',
    date: '2026-11-26',
    title: 'Nieuwtjes sluiten door ernaast te tikken, korter blok Android-app',
    changes: [
      'Het venster met nieuwtjes na een update sluit je nu ook door ernaast te tikken.',
      'Het blok Android-app in Instellingen → Over is korter. In de app zelf staat alleen welke versie je hebt.',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-11-26',
    title: 'Nieuwtjes na een update',
    changes: [
      'Na een update zie je één keer kort wat er nieuw is. Zijn er meer versies sinds je laatste bezoek, dan zie je ze samen. De link brengt je naar alles in Instellingen → Over.',
      'In het overzicht van versies staat nu bij welke versie er een nieuwe Android-app kwam, en wat er in de app veranderde.',
      'Een nieuwe Android-app komt er voortaan alleen als de app zelf verandert. Al het andere krijg je vanzelf via de website, zonder de app bij te werken.',
    ],
  },
  {
    version: '0.16.1',
    date: '2026-11-26',
    title: 'Huizen-knop en logo werken weer overal',
    changes: [
      'De knop Huizen en het logo brengen je weer naar alle huizen, ook als je via een huis bij Vergelijken of Instellingen kwam.',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-11-26',
    title: 'Rustiger kop bij een huis',
    changes: [
      'De kop bij een huis is compacter: adres en plaats, dan prijs en prijs per m² op één regel met de status ernaast.',
      'De status is een klein label geworden; tik erop om hem te wijzigen.',
      'Vergelijk, Advertentie, Kaart, Gegevens en PDF staan als één rij icoontjes, in plaats van losse knoppen over drie regels.',
      'Moet de advertentie nog met de bladwijzer worden opgehaald, dan staat dat als korte melding onder de knoppen.',
    ],
  },
  {
    version: '0.15.1',
    date: '2026-11-26',
    title: 'Terug sluit de documentviewer',
    changes: [
      'De terugknop sluit nu eerst een open venster, zoals de documentviewer, de advertentie, een foto of Gegevens. Je komt terug waar je was, bijvoorbeeld in het documentenoverzicht.',
      'Een venster sluiten met het kruisje of Esc laat geen extra stap achter in de terugknop.',
    ],
  },
  {
    version: '0.15.0',
    date: '2026-11-25',
    title: 'Terug gaat een niveau omhoog, notities passen zich aan',
    changes: [
      'De terugknop (ook die van Android) gaat nu een niveau omhoog: van een tabblad naar het overzicht van het huis, van daar naar alle huizen. Bij Instellingen net zo.',
      'Wisselen tussen tabbladen stapelt geen stappen meer op in de terugknop.',
      'Het notitieveld bij een checklistpunt is precies zo hoog als de tekst en groeit mee terwijl je typt.',
      'De bezichtiging kies je nu altijd met een 24-uursklok, ook als je telefoon of browser op Engels staat.',
      'Geen streepje pagina meer tussen de bovenbalk en de compacte balk met tabbladen bij het scrollen.',
    ],
  },
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
    android: [
      'Huizenjacht staat in het deelmenu van Android, voor foto\'s, video\'s en audio.',
      'In het eigen venster (zonder Chrome) opent Opnemen de camera-app, kies je meerdere bestanden tegelijk en vraagt de app om toestemming voor camera en microfoon.',
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
    android: [
      'De eerste Android-app: opent Huizenjacht in Chrome zonder adresbalk, of in een eigen venster.',
      'Vraagt bij de eerste start het serveradres; wijzigen via het app-icoon ingedrukt houden.',
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

/** The newest version that came with a new Android app (APK). */
export function latestAndroidRelease(): Release | undefined {
  return CHANGELOG.find((r) => r.android?.length)
}

const SEEN_KEY = 'hj.changelogSeen'

/**
 * The versions to show once after an update: those newer than the last one seen, newest
 * first. Someone who never saw a version (or one this changelog no longer knows) gets only
 * the newest.
 */
export function releasesSince(seen: string | null, changelog: Release[] = CHANGELOG): Release[] {
  if (seen === changelog[0]?.version) return []
  const index = seen ? changelog.findIndex((r) => r.version === seen) : -1
  return changelog.slice(0, index === -1 ? 1 : index)
}

export function lastSeenVersion(): string | null | undefined {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    // private mode: no news pop-up, since it could not be remembered
    return undefined
  }
}

export function markChangelogSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, currentVersion())
  } catch {
    // private mode: nothing to remember
  }
}
