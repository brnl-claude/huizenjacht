#!/usr/bin/env bash
# Builds the F-Droid repository from the APKs in $2 into fdroid/repo, with its index signed by
# the keystore in $FDROID_KEYSTORE (see fdroid/README.md), and the page site/ next to it.
# Usage: build_fdroid.sh <site url> <directory with APKs> <output directory>
set -euo pipefail
site_url="${1%/}"
apks="$2"
out="$3"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root/fdroid"

: "${FDROID_KEYSTORE:?Set FDROID_KEYSTORE to the index signing keystore}"
: "${FDROID_KEYSTORE_PASSWORD:?Set FDROID_KEYSTORE_PASSWORD}"
# The key's alias: huizenjacht-fdroid as in fdroid/README.md, or else the keystore's only key.
if ! aliases=$(keytool -list -keystore "$FDROID_KEYSTORE" -storepass "$FDROID_KEYSTORE_PASSWORD" 2>&1); then
  echo "::error::Can't open the F-Droid keystore: check FDROID_KEYSTORE_PASSWORD and FDROID_KEYSTORE_BASE64 (see fdroid/README.md). keytool says: $(echo "$aliases" | grep -v '^Picked up' | tail -n 1)" >&2
  exit 1
fi
aliases=$(echo "$aliases" | sed -n 's/^\([^,]*\), .*, PrivateKeyEntry,.*/\1/p')
alias="${FDROID_KEY_ALIAS:-huizenjacht-fdroid}"
if ! grep -qxF "$alias" <<< "$aliases"; then
  if [ "$(grep -c . <<< "$aliases")" -eq 1 ]; then
    alias="$aliases"
    echo "Using the keystore's only key, $alias"
  else
    echo "::error::The F-Droid keystore has no key huizenjacht-fdroid; it has: $(echo $aliases)" >&2
    exit 1
  fi
fi

rm -rf repo archive tmp
mkdir -p repo
cp "$apks"/*.apk repo/
# fdroid copies the repository icon from here into repo/icons.
cp "$root/frontend/public/icon-512.png" icon.png
# The app's icon in F-Droid; it can't take it from the APK's adaptive icon.
mkdir -p metadata/app.huizenjacht/en-US
cp "$root/frontend/public/icon-512.png" metadata/app.huizenjacht/en-US/icon.png

cat > config.yml <<CONFIG
repo_url: ${site_url}/fdroid/repo
repo_name: Huizenjacht
repo_description: >-
  De Android-app van Huizenjacht.
repo_icon: icon.png
archive_older: 0
repo_keyalias: ${alias}
keystore: ${FDROID_KEYSTORE}
keystorepass: ${FDROID_KEYSTORE_PASSWORD}
keypass: ${FDROID_KEYSTORE_PASSWORD}
keydname: CN=Huizenjacht F-Droid repository
CONFIG
if [ -n "${ANDROID_HOME:-}" ]; then
  echo "sdk_path: ${ANDROID_HOME}" >> config.yml
  # The newest build-tools' apksigner signs the index.
  apksigner=$(ls -d "${ANDROID_HOME}"/build-tools/*/apksigner | sort -V | tail -1)
  echo "apksigner: ${apksigner}" >> config.yml
fi
chmod 600 config.yml

fdroid update --pretty

# Fail when the app didn't make it into the index, for instance because an APK was rejected.
version=$(python3 - <<'CHECK'
import json
packages = json.load(open("repo/index-v2.json"))["packages"]
versions = packages.get("app.huizenjacht", {}).get("versions", {})
if not versions:
    raise SystemExit("app.huizenjacht is missing from the F-Droid index")
best = max(versions.values(), key=lambda v: v["manifest"]["versionCode"])
print(best["manifest"]["versionName"])
CHECK
)
echo "F-Droid index has Huizenjacht $version"

# F-Droid checks the index against this fingerprint: the SHA-256 of the key's certificate.
fingerprint=$(keytool -exportcert -keystore "$FDROID_KEYSTORE" -alias "$alias" \
  -storepass "$FDROID_KEYSTORE_PASSWORD" | sha256sum | cut -d' ' -f1)
fingerprint="${fingerprint^^}"
echo "F-Droid fingerprint $fingerprint"

mkdir -p "$out/fdroid"
cp -r repo "$out/fdroid/repo"
cp icon.png "$out/icon.png"
host_path="${site_url#https://}/fdroid/repo"
sed -e "s|__VERSION__|$version|g" -e "s|__FINGERPRINT__|$fingerprint|g" \
  -e "s|__REPO_URL__|$site_url/fdroid/repo|g" -e "s|__REPO_HOST_PATH__|$host_path|g" \
  site/index.html > "$out/index.html"
touch "$out/.nojekyll"
rm -f config.yml
