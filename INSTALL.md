# Installation en 3 étapes — tout gratuit, aucun serveur à laisser allumé

Détail complet dans **`FREE.md`**. Cette page est le pense-bête.

| Étape | Où | Durée | Ce que ça donne |
|---|---|---|---|
| **1. Le site** | [app.netlify.com/drop](https://app.netlify.com/drop) | 5 min | une URL publique, les analyses, les podiums |
| **2. Le moteur** | [github.com/new](https://github.com/new) | 10 min | le bouton **Rafraîchir** (régénère les stats) |
| **3. Le proxy** | [dash.cloudflare.com](https://dash.cloudflare.com) → Workers | 5 min | l'onglet **Live** |

Faites-les dans cet ordre : chaque étape donne l'information dont la suivante a besoin.

---

## Étape 1 — Netlify (le site)

1. Récupérez `dist.zip` (depuis le projet, ou `GET /dist.zip` si le serveur local tourne),
   **dézippez-le** : vous obtenez un dossier `dist/`.
2. Allez sur <https://app.netlify.com/drop> (compte gratuit, carte non demandée).
3. Glissez le **dossier `dist`** — pas le zip — dans la zone. `index.html` doit être à
   sa racine.
4. Notez l'URL obtenue : `https://quelque-chose.netlify.app`.

À ce stade : les analyses et les podiums fonctionnent, le bouton s'appelle **Recharger**,
et l'onglet Live explique qu'il lui faut le proxy de l'étape 3. C'est normal.

## Étape 2 — GitHub (le rafraîchissement)

1. Créez un dépôt **public** (2 000 minutes/mois gratuites ; en privé ce serait 200).
2. Uploadez `depot-github.zip` **dézippé** — il contient `.github/workflows/refresh.yml`,
   qui est le moteur.
3. Onglet **Settings → Secrets and variables → Actions** :
   - *Secrets* : `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`
     (<https://app.netlify.com/user/applications#personal-access-tokens> et
     *Site configuration → General → Site ID*).
4. Onglet **Actions → Rafraîchir les analyses → Run workflow**.
   ~3 minutes, puis le site Netlify est mis à jour.

## Étape 3 — Cloudflare Worker (le Live)

1. Workers & Pages → **Create** → **Hello World** → renommez-le `nhl-proxy`.
2. **Edit code** : collez le contenu de `worker/worker.js`, **Deploy**.
   L'URL ressemble à `https://nhl-proxy.VOTRE-NOM.workers.dev`.
3. Onglet **Settings → Variables and Secrets**, ajoutez :
   `GITHUB_REPO` (`pseudo/depot`), `GITHUB_TOKEN` (jeton GitHub avec droit `workflow`),
   `GITHUB_WORKFLOW` (`refresh.yml`), `REFRESH_TOKEN` (un mot de passe à vous).
4. Redeployez. Vérifiez : `https://nhl-proxy.VOTRE-NOM.workers.dev/healthz` → `{"ok":true}`.
5. Retour sur GitHub, dépôt → **Settings → Secrets and variables → Actions → Variables** :
   ajoutez `WORKER_URL` = l'adresse du Worker.
6. Relancez le workflow. Netlify reçoit alors un `config.json` : **le Live et le bouton
   Rafraîchir apparaissent sur le site.**

---

## Vérifier

```
https://VOTRE-SITE.netlify.app                      → les analyses
https://VOTRE-PROXY.workers.dev/healthz             → {"ok":true}
GitHub → Actions → dernière exécution               → verte, ~3 min
```

Et sur le site : bandeau « Proxy actif », onglet Live avec les matchs du jour, bouton
**Rafraîchir** qui annonce « compte 2 à 3 minutes ».
