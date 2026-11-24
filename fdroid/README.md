# F-Droid-repository

De workflow *F-Droid* (`.github/workflows/pages.yml`) maakt na elke CI-run op `main` een
F-Droid-repository van de drie nieuwste releases met `huizenjacht.apk`, met
`.github/scripts/build_fdroid.sh`. Hij publiceert die met GitHub Pages:

- <https://brnl-claude.github.io/huizenjacht/>: een pagina met de knop *Toevoegen aan F-Droid*,
  het adres en de vingerafdruk.
- <https://brnl-claude.github.io/huizenjacht/fdroid/repo>: de repository zelf.

`metadata/app.huizenjacht.yml` bevat de naam, samenvatting en beschrijving in F-Droid.

## Eenmalig instellen

1. *Settings → Pages → Build and deployment → Source*: **GitHub Actions**.
2. Een sleutel voor de index van de repository. Dat is niet de sleutel van de app: hiermee
   controleert F-Droid dat de lijst met versies echt van jou komt.

   ```sh
   keytool -genkeypair -keystore fdroid.p12 -storetype PKCS12 -alias huizenjacht-fdroid \
     -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Huizenjacht F-Droid repository"
   base64 -w0 fdroid.p12   # de waarde voor FDROID_KEYSTORE_BASE64
   ```

   Repository-secrets (*Settings → Secrets and variables → Actions*):

   | Secret | Waarde |
   | --- | --- |
   | `FDROID_KEYSTORE_BASE64` | De keystore, base64 |
   | `FDROID_KEYSTORE_PASSWORD` | Het wachtwoord van de keystore |

   Bewaar `fdroid.p12`: met een nieuwe sleutel moet je de repository op elk toestel opnieuw
   toevoegen.
3. *Actions → F-Droid → Run workflow*.

Pull requests die de F-Droid-bestanden wijzigen, bouwen de repository alleen, met een tijdelijke
sleutel.
