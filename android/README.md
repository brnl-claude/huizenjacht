# Huizenjacht voor Android

Een kleine Android-app rond de Huizenjacht-PWA op je eigen server. De app toont de PWA
schermvullend, dus alles werkt zoals op de website. Daarbovenop geeft hij een app-icoon en
updates via [Obtainium](https://obtainium.imranr.dev/).

## Eerste start: het serveradres

De app vraagt de eerste keer op welk adres jouw Huizenjacht draait (bijvoorbeeld
`huizen.voorbeeld.nl`). Hij controleert met `/api/health` of daar Huizenjacht antwoordt en
onthoudt het. Wijzigen: houd het app-icoon ingedrukt en kies **Server wijzigen** (ook op het
foutscherm als de server niet bereikbaar is). Zo werkt één APK voor elke server.

## Chrome of de eigen WebView

Met Chrome op het toestel (of Edge of Samsung Internet; standaardbrowser hoeft niet) opent de
app Huizenjacht in Chrome als
[Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity): je
logt in via OIDC (Authelia) in Chrome en blijft daar ingelogd, wachtwoordbeheer en passkeys
werken. Chrome toont geen adresbalk zodra de server de app noemt in
`/.well-known/assetlinks.json` (zie [Ondertekening](#ondertekening)); zonder dat werkt alles
hetzelfde, met een smalle adresbalk bovenaan.

Zonder zo'n browser (bijvoorbeeld /e/OS, of alleen Firefox) gebruikt de app Androids eigen
WebView:

- Je logt één keer in de app in. Het inloggen bij Authelia blijft in de app; links naar andere
  sites (zoals Funda) openen in de browser.
- Omlaag trekken bovenaan een pagina laadt hem opnieuw.
- De back-up downloadt naar Downloads; uploaden en terugzetten kiezen een bestand.
- Kan een pagina niet laden, dan zegt de app waarom en wat je kunt doen, en probeert hij het
  opnieuw als het netwerk terugkomt.

## Installeren en bijwerken

Obtainium: **Add App** met `https://github.com/brnl-claude/huizenjacht`. Obtainium leest de
GitHub-releases en installeert `huizenjacht.apk` uit de nieuwste. Eenmalig handmatig kan ook:
<https://github.com/brnl-claude/huizenjacht/releases/latest/download/huizenjacht.apk>.

F-Droid (of Droid-ify, Neo Store): open <https://brnl-claude.github.io/huizenjacht/> op je
telefoon en tik op *Toevoegen aan F-Droid*. Die repository heeft dezelfde APK's als de releases,
dus je kunt tussen Obtainium en F-Droid wisselen zonder opnieuw te installeren. Zie
[`fdroid/`](../fdroid/README.md).

De app heeft hetzelfde versienummer als de rest van Huizenjacht (de nieuwste versie in
`frontend/src/changelog.ts`). De versiecode volgt daaruit: `1.2.3` wordt `1002003`, dus elke
nieuwe versie installeert over de vorige. CI bouwt de app bij elke push naar `main` en hangt
hem aan de release van die versie.

## Ondertekening

Elke update moet met dezelfde sleutel ondertekend zijn, anders weigert Android hem. Maak de
sleutel één keer en bewaar hem goed: zonder sleutel moet je de app verwijderen en opnieuw
installeren.

```sh
keytool -genkeypair -v -keystore huizenjacht.jks -alias huizenjacht \
  -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 huizenjacht.jks   # de waarde voor ANDROID_KEYSTORE_BASE64
```

Repository-secrets (*Settings → Secrets and variables → Actions*):

| Secret | Waarde |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | De keystore, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Het wachtwoord van de keystore |
| `ANDROID_KEY_ALIAS` | `huizenjacht` |
| `ANDROID_KEY_PASSWORD` | Het wachtwoord van de sleutel (bij een PKCS12-keystore hetzelfde) |

Zonder deze secrets bouwt CI de app alleen om te controleren dat hij bouwt, en krijgt de
release geen APK. Voeg je ze later toe, start dan de laatste CI-run op `main` opnieuw (*Re-run
all jobs*): de release krijgt dan alsnog de APK.

De samenvatting van de CI-run toont de SHA-256-vingerafdruk van de sleutel. Zet die in de
Helm-values, dan noemt de server de app in `assetlinks.json` en verdwijnt de adresbalk:

```yaml
android:
  certFingerprints:
    - "AB:CD:…"
```

## Lokaal bouwen

Met JDK 17 of nieuwer en de Android SDK: `./gradlew assembleDebug` in deze map. De APK staat
in `app/build/outputs/apk/debug/`. Met `hj.defaultServer` in `gradle.properties` vult de app
dat adres alvast in.
