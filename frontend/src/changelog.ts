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
