# Huizenjacht

Een Progressive Web App om je zoektocht naar een huis bij te houden: een overzicht van de huizen
die je overweegt, een bezichtigingschecklist per huis en vergelijkingen naast elkaar. De app is
in het Nederlands en werkt op telefoon en desktop, ook zonder verbinding tijdens een bezichtiging.

## Rapporten blijven buiten deze repository

Deze repository is openbaar. De rapporten over huizen staan in een **aparte, private repository**
en komen nooit hier terecht:

- Op Kubernetes haalt een [git-sync](https://github.com/kubernetes/git-sync) sidecar de private
  repository op met een read-only token uit een Secret. Na elke synchronisatie (standaard elke
  minuut) importeert de app nieuwe en gewijzigde rapporten.
- In de app kun je ook rapporten uploaden (Instellingen → Rapporten importeren).
- `.gitignore` en de CI-job `no-reports` weigeren bestanden die op rapporten of data lijken.

Een rapport is Markdown met YAML front matter, één bestand per huis. Velden als `adres`,
`vraagprijs`, `woonoppervlakte`, `energielabel`, `score`, `pluspunten`, `minpunten` en
`aandachtspunten_bezichtiging` worden herkend; de rest verschijnt als "Overige gegevens". Je eigen
checklist, cijfer en notities blijven staan als een rapport wordt bijgewerkt.

## Ontwikkelen

```bash
# API op :8000
cd backend && uv sync && HJ_DATA_DIR=./data HJ_REPORTS_DIR=/pad/naar/rapporten uv run uvicorn app.main:app --reload
# PWA op :5173, stuurt /api door naar :8000
cd frontend && npm install && npm run dev
```

Tests: `uv run pytest` en `uv run ruff check .` in `backend/`, `npm test`, `npm run lint` en
`npm run build` in `frontend/`.

## Installeren op Kubernetes

Elke push naar `main` publiceert het image `ghcr.io/brnl-claude/huizenjacht` (tags `latest`,
`sha-…` en de versie uit de changelog) en de Helm chart op `oci://ghcr.io/brnl-claude/charts`.

```bash
kubectl create secret generic huizenjacht-reports \
  --from-literal=username=x-access-token --from-literal=password=github_pat_...
kubectl create secret generic huizenjacht-oidc --from-literal=client-secret=...

helm install huizenjacht oci://ghcr.io/brnl-claude/charts/huizenjacht \
  --set auth.oidc.enabled=true \
  --set auth.oidc.issuer=https://auth.example.com \
  --set auth.oidc.existingSecret=huizenjacht-oidc \
  --set auth.oidc.allowedUsers=bram \
  --set auth.publicUrl=https://huizen.example.com \
  --set reports.git.enabled=true \
  --set reports.git.repo=https://github.com/brnl-claude/huizenjacht_rapporten \
  --set reports.git.existingSecret=huizenjacht-reports \
  --set ingress.enabled=true --set ingress.host=huizen.example.com
```

Gebruik voor het rapporten-token een fine-grained personal access token met alleen
*Contents: read* op de rapporten-repository. Zie `deploy/helm/huizenjacht/values.yaml` voor alle
opties.

### Inloggen met Authelia (OIDC)

De app logt zelf in via OIDC (authorization code flow met PKCE). Voeg in Authelia een client toe:

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: huizenjacht
        client_name: Huizenjacht
        client_secret: '$pbkdf2-sha512$...'  # hash van het geheim in huizenjacht-oidc
        authorization_policy: two_factor
        require_pkce: true
        pkce_challenge_method: S256
        redirect_uris:
          - https://huizen.example.com/api/auth/callback
        scopes: [openid, profile, email, groups]
        token_endpoint_auth_method: client_secret_basic
```

Met `auth.oidc.allowedGroups` of `auth.oidc.allowedUsers` beperk je wie binnen mag. Zonder login
draaien kan ook (`auth.acknowledgeNoLogin=true`), bijvoorbeeld achter forward-auth of alleen
intern.

## Versies

Semantic versioning. Elke wijziging die je in de app ziet, krijgt een regel in
`frontend/src/changelog.ts`; die staat in de app onder Instellingen → Over. CI maakt voor elke
nieuwe versie een GitHub-release `v<versie>` en tagt het image.
