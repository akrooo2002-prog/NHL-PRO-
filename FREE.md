# Tout avoir gratuitement : Live + bouton Rafraîchir, 0 €

Le site est un dépôt de fichiers (Netlify Drop). Or le Live et le Rafraîchir ont besoin
d'un intermédiaire, parce que **l'API NHL ne renvoie aucun en-tête `access-control`** : un
navigateur bloque tout appel direct depuis le site. Vérifié :

```
$ curl -sI -H "Origin: https://exemple.netlify.app" https://api-web.nhle.com/v1/score/2026-09-19
HTTP/2 200          <- pas une seule ligne access-control-allow-origin
```

Il faut donc deux briques gratuites en plus du site. Aucune ne demande de carte bancaire.

```
   ton navigateur
        │
        ├──► Netlify Drop            le site (gratuit, 100 Go/mois)
        │
        ├──► Cloudflare Worker       /live  et  /refresh   (gratuit, 100 000 req/jour)
        │         │
        │         ├──► api-web.nhle.com     scores en direct
        │         └──► api.github.com       « régénère les données »
        │
        └──► GitHub Actions          fetch_pronos.py + engine.py + build_static.py
                                      puis redéploie sur Netlify
                                      (gratuit, 2 000 min/mois en dépôt public)
```

Résultat : **Live en direct** et **bouton Rafraîchir** qui régénère vraiment les stats,
pour 0 €. Le rafraîchissement prend 2 à 3 minutes (c'est une vraie collecte), contre ~80 s
avec un serveur qui tourne en continu.

---

## 1. GitHub — le moteur de rafraîchissement (10 min)

1. Crée un compte sur <https://github.com> puis un **dépôt public** (le plan gratuit donne
   2 000 minutes/mois en public, 200 en privé — cette exécution prend ~3 min, soit
   ~40 rafraîchissements/jour en public).
2. Upload **tout le projet** (bouton *Add file → Upload files*, ou `git push`).
3. Onglet **Settings → Secrets and variables → Actions** :
   - *Secrets* : `NETLIFY_AUTH_TOKEN` et `NETLIFY_SITE_ID` (voir étape 2).
   - *Variables* : `WORKER_URL` = l'URL de ton Worker (voir étape 3).
4. Onglet **Actions** → *Rafraîchir les analyses* → **Run workflow** : ça doit passer au vert
   en ~3 minutes.

Le workflow `.github/workflows/refresh.yml` fait : collecte → moteur → **tests** →
construction du dossier → envoi à Netlify par son API. Le dépôt Git ne grossit jamais,
puisque les données partent directement chez Netlify.

**Pour que ce soit automatique**, décommente les deux lignes `cron` en haut du workflow :
l'analyse se régénère alors à 07 h 10 et 19 h 10 UTC sans que tu cliques.

## 2. Netlify — le site (5 min)

1. <https://app.netlify.com/drop> → glisse le dossier **`dist`**. Tu obtiens
   `https://quelque-chose.netlify.app`.
2. Pour que GitHub puisse redéployer à ta place :
   - **User settings → Applications → New access token** → copie-le dans
     `NETLIFY_AUTH_TOKEN` ;
   - **Site configuration → General → Site ID** → copie-le dans `NETLIFY_SITE_ID`.

## 3. Cloudflare Worker — le proxy (5 min)

Le plus simple, sans rien installer :

1. <https://dash.cloudflare.com> → **Workers & Pages → Create → Worker**.
2. Colle le contenu de `worker/worker.js`, déploie. Tu obtiens
   `https://nhl-pronos-proxy.<ton-compte>.workers.dev`.
3. Onglet **Settings → Variables and Secrets**, ajoute :
   | Nom | Valeur |
   |---|---|
   | `GITHUB_REPO` | `ton-pseudo/ton-depot` |
   | `GITHUB_TOKEN` | un jeton GitHub avec le droit **Actions: write** (Settings → Developer settings → Fine-grained tokens) |
   | `GITHUB_WORKFLOW` | `refresh.yml` |
   | `REFRESH_TOKEN` | *(facultatif)* une longue phrase au hasard |

En ligne de commande, c'est encore plus court :

```bash
npm i -g wrangler && wrangler login
cd worker && wrangler deploy
wrangler secret put GITHUB_REPO
wrangler secret put GITHUB_TOKEN
```

## 4. Relier le site au proxy (1 min)

Dans le dossier `dist`, crée `config.json` :

```json
{ "api": "https://nhl-pronos-proxy.<ton-compte>.workers.dev/" }
```

Puis redépose `dist` sur Netlify (ou mets `WORKER_URL` dans les variables GitHub : le
workflow écrit ce fichier tout seul à chaque déploiement).

Au chargement suivant, l'app affiche **« Proxy actif »** en haut, l'onglet Live se remplit,
et le bouton Rafraîchir relance une vraie collecte.

---

## Ce qui est gratuit, et jusqu'où

| Service | Gratuit | Notre consommation |
|---|---|---|
| Netlify | 100 Go/mois | ~2 Mo par visiteur, dérisoire |
| Cloudflare Workers | 100 000 requêtes/jour | ~4 300/jour si tu laisses un onglet Live ouvert en continu |
| GitHub Actions | 2 000 min/mois (public) | ~3 min par rafraîchissement, soit ~650/mois |
| API NHL | publique, sans clé | ~300 appels par collecte |

Le Live interroge l'API toutes les 20 s par écran ouvert, mais le Worker met la réponse en
cache 20 s : dix écrans ouverts ne font qu'un appel vers la NHL par tranche de 20 s.

## Limites honnêtes de ce montage

- Le rafraîchissement prend **2 à 3 minutes**, pas 80 secondes : il passe par une file
  GitHub. L'app le dit et recharge toute seule dès que les nouvelles données arrivent.
- **Un Worker gratuit s'interrompt après 10 ms de CPU** : il ne peut pas faire la collecte
  lui-même (75 s). C'est pour ça que le calcul est délégué à GitHub Actions.
- Le Worker est sur `*.workers.dev`, donc **public** : n'importe qui connaissant l'URL peut
  déclencher un rafraîchissement. Mets `REFRESH_TOKEN` pour verrouiller, et remplace
  `ORIGINE_AUTORISEE = "*"` par l'URL de ton site dans `worker/worker.js`.
- Un dépôt GitHub **privé** ne donne que 200 minutes/mois (~60 rafraîchissements).

---

## Les deux autres options gratuites

**A. Rien qu'un serveur chez toi.** `python3 server.py 8000` sur un PC ou un Raspberry Pi
qui reste allumé, et tu ouvres `http://localhost:8000`. Toutes les fonctions, instantané,
zéro compte, zéro limite. Ajoute Tailscale (`DEPLOY.md`, option A) pour y accéder depuis ton
téléphone sans rien exposer sur Internet.

**B. Oracle Cloud Always Free.** Une vraie VM gratuite à vie (4 cœurs ARM, 24 Go de RAM),
carte bancaire demandée à l'inscription pour vérification mais jamais débitée. Tu y poses le
projet et tu suis `DEPLOY.md` : Live, Rafraîchir instantané, HTTPS, et tu peux même garder
l'accès privé. C'est l'option la plus complète, au prix d'une inscription Oracle — réputée
pénible.

---

## Vérifier que tout fonctionne

```bash
node test_gratuit.js      # le montage complet, avec un proxy qui appelle la VRAIE API NHL
node test_static.js       # le dossier Netlify seul, sans proxy
node test_app.js          # la version serveur, avec rafraîchissement réel
node test_env.js          # la tenue dans chaque environnement
./deploy/deploy.sh check  # le kit serveur (systemd, Caddy)
```

`test_gratuit.js` (37 vérifications) sert le dossier `dist` avec un simple serveur de
fichiers, lance `test_proxy_stub.py` (qui imite le Worker et appelle réellement l'API
NHL), puis exécute l'app dedans : le Live affiche les vrais matchs, le bouton Rafraîchir
déclenche la régénération. Il teste ensuite les deux pannes : sans `config.json`, puis
avec un proxy qui répond 503 — l'app doit expliquer, jamais mentir.

### Depuis un téléphone, ou sans rien installer

Le dossier `dist` peut être récupéré en **un seul fichier** : le serveur expose

```
GET /dist.zip      →  nhl-pronos-netlify.zip (~2,6 Mo, 160 fichiers)
```

L'archive est régénérée à chaque téléchargement si les données ont changé, donc jamais
périmée. Ensuite :

- **Netlify Drop ne fonctionne pas depuis un navigateur mobile** : le glisser-déposer
  n'existe pas sur mobile et Netlify ne propose pas de bouton « choisir un dossier ».
  Il faut un ordinateur, ou `netlify-cli` dans Termux (Android).
- **Tout le reste se fait au navigateur du téléphone** : créer le dépôt GitHub, coller
  `worker.js` dans l'éditeur en ligne de Cloudflare, créer les secrets, lire les logs
  d'Actions, ouvrir le site.
- **Sans aucun appareil à toi** : les API Netlify, Cloudflare et GitHub sont joignables
  depuis l'environnement de travail — avec tes jetons, le déploiement peut être fait là,
  sans que tu installes quoi que ce soit.

### Ce que l'app fait quand le proxy n'est pas encore configuré

Aucun blocage, aucun écran vide :

| Situation | Comportement |
|---|---|
| `config.json` absent | l'app démarre normalement en mode statique, le bouton devient « **Recharger** » (il relit le dépôt), l'onglet Live explique pourquoi il est indisponible et donne les deux voies (proxy gratuit de `FREE.md`, ou `python3 server.py 8000` chez toi) |
| `config.json` présent mais Worker éteint | le Live affiche « Live indisponible : https://…workers.dev/live?date=… — réponse HTTP 503 » (ou « délai dépassé (20 s) ») au lieu de rester vide ; Rafraîchir affiche « Proxy injoignable : … — réponse HTTP 503 » |
| Worker refuse (mauvais `REFRESH_TOKEN`) | Rafraîchir affiche « Refusé : … » |
| données périmées | un bandeau indique depuis quand, avec l'heure exacte de génération |

