# Pronos NHL — buteur, passeur, pointeur

App web (et future APK) qui référence **chaque match à venir** et, pour chaque joueur des
deux équipes, dit **quel marché jouer (buteur / passeur / pointeur)**, avec une
**probabilité chiffrée**, un **indice de confiance à 5 paliers** et le **pourquoi** en une
phrase de chiffres réels.

100 % statistiques officielles NHL. Aucune cote, aucune clé API, aucune IA externe :
tout est calculé localement et de façon déterministe.

## Démarrage

```bash
python3 fetch_pronos.py          # aspire l'API officielle (35 jours de calendrier)
python3 engine.py                # calcule les analyses -> data/analyse.json
python3 server.py 8000           # http://localhost:8000
```

Dépendance : aucune (bibliothèque standard Python + `urllib`). `node` n'est requis que
pour lancer les tests.

## Version gratuite : dossier à déposer sur Netlify Drop

```bash
python3 refresh.py           # collecte + analyse (ou fetch_pronos.py && engine.py)
python3 build_static.py      # construit le dossier dist/
node test_static.js          # vérifie que le dossier tient debout sans serveur
```

Puis glisse **`dist/`** sur <https://app.netlify.com/drop>. C'est gratuit, sans compte
obligatoire, et l'app est installable comme application sur Chrome et Safari
(manifeste + service worker : elle s'ouvre en plein écran et reste lisible hors ligne).

Le dossier est découpé pour rester léger sur mobile :

| Fichier | Poids transmis | Chargé |
|---|---|---|
| `data/analyse.json` (index : calendrier, contexte, top 10 par marché) | ~490 Ko | au démarrage |
| `data/match-<id>.json` (fiche complète d'un match) | ~13 Ko | à l'ouverture de l'onglet Analyse |
| `app.html` | ~18 Ko | au démarrage |

**Contrepartie à connaître** : un dépôt statique n'a pas de serveur, donc
- **pas de suivi en direct** (l'API NHL bloque les appels directs depuis un navigateur) ;
- **pas de bouton Rafraîchir** : les données sont figées à la date affichée en haut de
  l'écran. Pour les mettre à jour : `python3 refresh.py && python3 build_static.py`,
  puis redépose le dossier.

L'app le dit elle-même dans un bandeau et dans l'onglet Méthode — elle ne prétend pas
être à jour quand elle ne l'est pas.

## Le Live et le Rafraîchir, gratuitement

Un dépôt statique ne peut pas appeler l'API NHL directement (aucun en-tête CORS). Deux
briques gratuites suffisent à retrouver les deux fonctions : un **Cloudflare Worker** comme
proxy (100 000 requêtes/jour) et **GitHub Actions** pour régénérer les données
(2 000 minutes/mois). Aucune carte bancaire.

→ **[FREE.md](FREE.md)** : le montage pas à pas, les limites, et les deux autres options
gratuites (serveur chez toi, Oracle Cloud Always Free).

```bash
node test_gratuit.js       # vérifie le montage complet, proxy appelant la VRAIE API NHL
```

## Version avec serveur (Live + Rafraîchir instantané)

**Pour l'héberger proprement et en privé** (service systemd, HTTPS, accès privé, collecte
planifiée) : voir **[DEPLOY.md](DEPLOY.md)**. En résumé :

```bash
./deploy/deploy.sh check                                   # tout vérifier sans rien installer
sudo ./deploy/deploy.sh install --tailscale-only           # 100 % privé, rien d'exposé
sudo ./deploy/deploy.sh install --domain pronos.exemple.fr # VPS + TLS + mot de passe
python3 server.py --selftest                               # autotest du serveur déployé
```

## Les 5 onglets

| Onglet | Contenu |
|---|---|
| **Podium** | les 3 joueurs les plus probables du jour, par marché, avec leur photo et leur probabilité |
| **Matchs** | tous les matchs du jour, top 3 (ou top 5) par marché, gardien probable de chaque côté |
| **Analyse** | un match en profondeur : contexte, correction du gardien, absences, top 5 justifié, tableau complet triable + export CSV |
| **Live** | scores, période et horloge en direct, avec les buts déjà marqués par les joueurs proposés |
| **Méthode** | le modèle, le barème des paliers, le traitement des recrues, les limites |

## Rafraîchir

Deux façons :

- **dans l'app** : bouton **Rafraîchir** en haut à droite (ou « Ré-analyser ce match » dans
  l'onglet Analyse). Il relance la collecte puis le moteur côté serveur (~80 s), puis
  recharge les nouvelles données tout seul. À faire quelques heures avant le match, quand
  les gardiens et les effectifs sont connus.
- **en ligne de commande** : `python3 fetch_pronos.py && python3 engine.py`

Le serveur recharge `data/analyse.json` automatiquement après chaque rafraîchissement.
Un badge en haut de l'écran indique l'âge de l'analyse et passe en orange au-delà de 12 h.

## Routes du serveur

| Route | Rôle |
|---|---|
| `GET /` , `/app` | l'interface |
| `GET /data/analyse.json` | le résultat du moteur (mis en cache, **gzip**) |
| `GET /api/health` , `/healthz` | état du serveur (cible de supervision) |
| `GET /api/live?date=AAAA-MM-JJ` | scores en direct (proxy NHL, cache 20 s) |
| `POST /api/refresh` ou `GET /api/refresh?lancer=1` | relance `fetch_pronos.py` puis `engine.py` |
| `GET /api/refresh` | état du rafraîchissement en cours |
| `GET /dist.zip` | le dossier Netlify complet en une archive (~2,6 Mo), régénérée si les données ont changé |

Les deux méthodes sont acceptées pour lancer la collecte : certains proxys d'aperçu
refusent `POST`, l'app utilise donc `GET ?lancer=1`.

Le proxy `/api/live` est nécessaire : `api-web.nhle.com` refuse les appels directs depuis
un navigateur (CORS). Sans serveur, l'onglet Live affiche un message explicite au lieu de
planter.

## Test

```bash
node test_app.js http://127.0.0.1:8000              # complet (relance vraiment la collecte)
node test_app.js http://127.0.0.1:8000 --skip-refresh
node test_env.js http://127.0.0.1:8000              # matrice d'environnements
```

`test_env.js` couvre les environnements réels : moteur seul sans réseau, collecte sans DNS,
app avec données mais sans `/api`, app sans rien, page ouverte en `file://`, routes
inconnues, collecte lancée en `GET` et en `POST`, collecte concurrente, gzip demandé ou non,
dates invalides (texte, mois 13, 30 février), URL de 2 000 caractères, syntaxe du JS.

Le harnais extrait le `<script>` de `app.html` **tel quel**, l'exécute dans un DOM simulé
avec les vraies données, puis vérifie :

| Contrôle | Dernier résultat |
|---|---|
| Rendu des 5 onglets | OK (podium 412 blocs, détail 58 lignes, méthode 6 paliers, live 81 458 car.) |
| Client == moteur Python sur 12 600 couples marché/joueur | **écart 0** sur probabilité, score, indice, palier et rang |
| Podium : 3 joueurs par marché, triés, identiques au moteur | OK |
| Recrues : présentes, plafonnées au palier 2, jamais devant un joueur établi | 1 119 fiches, 0 cas sur 444 |
| Historique contre l'adversaire / joueurs en hausse | 146 joueurs / 515 |
| Override gardien : λ et probabilité recalculés | 1,155 → 1,364 · 68,5 % → 74,4 % |
| Absent déclaré : probabilité et indice | 67 % → 20 %, indice 84,2 → 39,1 |
| Le n°1 a toujours la meilleure confiance | 453/453 |
| Paliers conformes au barème affiché | 0 hors barème |
| Chaque analyse a une justification concise | 0 vide, max 402 caractères |
| `GET /api/live` | 200, 7 matchs |
| `POST /api/refresh` → collecte + moteur + rechargement de l'app | OK (151 matchs, 9 731 analyses) |
| `/data/analyse.json` compressé | gzip |

## Y a-t-il une IA derrière ?

**Non.** Aucune IA générative, aucun réseau de neurones, aucun modèle entraîné, aucun appel
à un service d'IA. Le classement sort de formules explicites — loi de Poisson, régression du
pourcentage de tir, facteurs multiplicatifs bornés — dont chaque coefficient est écrit dans
`engine.py`. Les mêmes données produisent exactement les mêmes pronostics à chaque exécution.

Le revers : le modèle ne « comprend » pas le hockey. Il ne connaît ni les trios, ni les
blessures non déclarées, ni l'effet d'un changement d'entraîneur. D'où les corrections
manuelles (gardien, absents) et le bouton Rafraîchir.

## La logique, en 7 étapes

1. **Rythme de base** — buts, passes, tirs, points par match, en séparant le 5 contre 5 de
   l'avantage numérique (pour ne pas confondre productif et porté par son power play).
2. **Efficacité de tir régressée** — le % de tir constaté est ramené vers la moyenne de ses
   5 dernières saisons et celle de la ligue. Un joueur à 21,8 % alors que sa base dit 15 %
   voit ses buts projetés sur 16,5 %, pas sur 21,8 %. À l'inverse, une réussite froide remonte.
3. **Adversaire** — trois effets distincts : le gardien (part des tirs qu'il laisse passer,
   relative à la ligue), la défense (buts et tirs concédés), le désavantage numérique adverse.
4. **Historique contre CET adversaire** — les 10 derniers duels du joueur contre l'équipe du
   jour : si son rythme y est différent de sa moyenne, λ est ajusté (borné à 0,75× – 1,35×),
   et le détail est écrit dans l'analyse.
5. **Contexte** — forme sur 5 matchs (et drapeau « en hausse » si elle dépasse de 30 % sa
   moyenne), absence, back-to-back.
6. **Objectifs** — à 1 ou 2 unités d'un palier rond (30/40/50 buts, 50/75/100 points),
   +8 % sur les buts ou passes attendus, et l'objectif est cité dans l'analyse.
7. **Probabilité** — les buts, passes et points attendus (λ) passent par une loi de Poisson :
   `P = 1 − e^(−λ)`. Marché pointeur : λ = λbuts + λpasses.

## Les 5 paliers

Barème appliqué à **l'indice de confiance** (0-100) :

| Palier | Indice | Lecture |
|---|---|---|
| ★★★★★ | 88 et plus | forte conviction |
| ★★★★☆ | 75 à 88 | solide |
| ★★★☆☆ | 62 à 75 | correct |
| ★★☆☆☆ | 50 à 62 | risqué |
| ★☆☆☆☆ | moins de 50 | très spéculatif |

Indice = 80 % × (100 × P^0,55) + 20 % × (fiabilité des données). Malus : absence ×0,30 · petit échantillon ×0,88 · forme non mesurée
×0,90 · back-to-back ×0,93 · présaison ×0,80. Un joueur à λ = 0 n'est **pas classé**.

## Les recrues

1 119 fiches de joueurs sans référence NHL sont maintenant analysées (elles étaient exclues
avant). Projection depuis leur dernière saison en ligue mineure, avec un facteur de
conversion : AHL × 0,40 (buts) / × 0,30 (passes), KHL et Suisse × 0,55 / 0,46, ligues
suédoise et finlandaise × 0,42 / 0,34, junior et NCAA × 0,20 / 0,15. Le temps de glace est
estimé selon le poste et l'année de repêchage.

**Ces fiches sont volontairement plafonnées au palier 2** : sans match NHL, c'est une
indication, pas un signal. Elles portent le badge « recrue » et leur ligue d'origine.

## Ce que tu peux corriger dans l'interface

- **Le gardien.** Il est *estimé* (celui qui a le plus démarré sur les 4 derniers matchs),
  jamais confirmé — l'API officielle ne publie pas les gardiens probables. Dès que
  l'annonce tombe, choisis-le dans la liste : λ, probabilités, indices, paliers et rangs se
  recalculent instantanément. Puis relance l'analyse pour que tout le monde en profite.
- **Les absents.** L'endpoint officiel des blessés a été retiré. Le drapeau « absent » est
  déduit du dernier match joué ; déclare toi-même les forfaits confirmés (recherche +
  puce), l'indice est divisé par ~3.

Les deux sont mémorisés dans le navigateur (localStorage), match par match.

## Limites assumées

- **Aucune composition avant le match.** `/gamecenter/<id>/line-combination` renvoie 404
  même pour un match terminé : les trios ne sont visibles que via les feuilles de temps de
  glace, pendant ou après la rencontre. C'est la principale source d'erreur.
- **Le Live confirme les buts, pas les passes décisives** : l'API de scores ne liste pas les
  assistances.
- Pas de xG ni de Corsi : l'API publique ne les publie pas. Croiser avec Natural Stat Trick.
- La forme n'est mesurée que pour les 25 meilleurs pointeurs de chaque équipe.
- Hockey = forte variance : un palier 5 à 80 % échoue plus d'une fois sur cinq.

## Fichiers

| Fichier | Rôle |
|---|---|
| `fetch_pronos.py` | calendrier, effectifs, stats, game-logs, gardiens partants, carrières et dernières saisons des recrues → `data/pronos.json` |
| `engine.py` | le moteur d'analyse → `data/analyse.json` |
| `server.py` | serveur + proxy live + rafraîchissement + gzip |
| `app.html` | l'interface, zéro dépendance front, mobile-first |
| `test_app.js` | harnais de test : justesse du calcul et de l'interface |
| `test_env.js` | harnais de test : tenue dans chaque environnement |
| `test_static.js` | harnais de test : version statique servie sans serveur |
| `build_static.py` | construit le dossier `dist/` à déposer sur Netlify Drop |
| `worker/` | proxy Cloudflare Worker (Live + Rafraîchir), gratuit |
| `.github/workflows/refresh.yml` | régénère les données et redéploie, gratuit |
| `test_proxy_stub.py` | proxy de test, appelle la vraie API NHL |
| `test_gratuit.js` | harnais de test : montage 100 % gratuit |
| `FREE.md` | le montage gratuit pas à pas |
| `sw.js`, `manifest.webmanifest`, `_headers`, `icons/` | PWA : installable sur Chrome et Safari |
| `refresh.py` | collecte planifiée (verrou, journal, refus des données incomplètes) |
| `deploy/` | unités systemd, Caddyfile, `deploy.sh` (check / install / uninstall) |
| `DEPLOY.md` | les trois options d'hébergement privé, la sécurité, le dépannage |
| `logs/` | `refresh.log` et `access.log` (créés à l'exécution, rotation à 5 Mo) |

## Devenir une APK

L'interface est un fichier unique, mobile-first (navigation basse, cibles tactiles de
40 px, `viewport-fit=cover`, aucune dépendance externe). Deux options :

1. **WebView** : embarquer `app.html` et pointer sur le serveur (le plus simple, les onglets
   Live et Rafraîchir fonctionnent tels quels).
2. **PWA** : ajouter un manifeste et un service worker. Attention, le Live et le
   rafraîchissement exigent que `server.py` soit joignable — sans lui, l'app reste
   consultable sur les dernières données chargées, avec un message explicite.
