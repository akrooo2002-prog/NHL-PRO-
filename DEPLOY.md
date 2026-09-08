# Héberger Pronos NHL proprement et en privé

L'app a besoin d'un **processus qui tourne** : le Live et le bouton Rafraîchir passent par
`server.py`. Un simple hébergement statique (Netlify, GitHub Pages, OVH mutualisé) ne suffit
donc pas. Trois options, de la plus privée à la plus accessible.

| Option | Exposition Internet | Difficulté | Pour qui |
|---|---|---|---|
| **A. Tailscale** | **aucune** | facile | toi seul, depuis tes appareils |
| **B. VPS + Caddy** | domaine public + mot de passe | moyen | accès depuis n'importe où, partage à 2-3 personnes |
| **C. Cloudflare Tunnel** | aucune (tunnel chiffré) | moyen | comme B, sans ouvrir de port |

Prérequis commun : Debian/Ubuntu (ou Raspberry Pi OS), Python 3.9+, `systemd`.
Aucune dépendance Python à installer.

---

## Option A — Tailscale : 100 % privé, rien d'exposé

Le serveur n'écoute que sur `127.0.0.1` et Tailscale le publie **uniquement sur ton
tailnet** (ton réseau privé chiffré). Aucune IP publique, aucun port ouvert, aucun mot de
passe à gérer : l'accès suit les appareils que tu as toi-même autorisés.

```bash
# 1. installer Tailscale sur la machine et sur ton téléphone/PC
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 2. récupérer le projet sur la machine
git clone <ton-depot> nhl-pronos && cd nhl-pronos     # ou scp -r

# 3. vérifier, puis installer
./deploy/deploy.sh check
sudo ./deploy/deploy.sh install --tailscale-only
```

Accès : `https://<nom-de-la-machine>.<ton-tailnet>.ts.net/` — TLS géré par Tailscale.

Pour partager avec une personne de confiance : `sudo tailscale up --operator` ou ajoute son
appareil au tailnet, puis `tailscale serve` lui donne accès sans rien exposer publiquement.

---

## Option B — VPS + Caddy : TLS automatique et mot de passe

Un VPS à 4 €/mois suffit largement (l'app consomme ~60 Mo de RAM). Le port 8000 reste
interne ; Caddy fait le HTTPS et l'authentification.

```bash
# 1. pointer ton domaine (ou sous-domaine) sur l'IP du VPS :  A  pronos.exemple.fr  ->  1.2.3.4

# 2. sur le VPS
sudo apt-get update && sudo apt-get install -y python3 curl
git clone <ton-depot> nhl-pronos && cd nhl-pronos

# 3. vérifier, puis installer (Caddy est installé par le script s'il manque)
./deploy/deploy.sh check
sudo ./deploy/deploy.sh install --domain pronos.exemple.fr --user moi
```

Le script affiche **un mot de passe à conserver**. Accède à `https://pronos.exemple.fr/`,
puis change-le :

```bash
caddy hash-password --plaintext 'nouveau-mot-de-passe'   # copie le hash
sudo nano /etc/caddy/Caddyfile                           # remplace le hash
sudo systemctl reload caddy
```

Pare-feu : n'ouvre que 80, 443 et 22. Le port 8000 ne doit **jamais** être public.

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

---

## Option C — Cloudflare Tunnel : privé sans ouvrir de port

Utile si le VPS est derrière un NAT, ou si tu refuses d'exposer 80/443.

```bash
sudo apt-get install -y cloudflared
cloudflared tunnel login
cloudflared tunnel create nhl-pronos
cloudflared tunnel route dns nhl-pronos pronos.exemple.fr

sudo tee /etc/cloudflared/config.yml >/dev/null <<'YAML'
tunnel: nhl-pronos
credentials-file: /root/.cloudflared/<UUID>.json
ingress:
  - hostname: pronos.exemple.fr
    service: http://127.0.0.1:8000
  - service: http_status:404
YAML

cloudflared service install
sudo systemctl enable --now cloudflared
```

Garde `NHL_BIND=127.0.0.1` dans `deploy/nhl-pronos.env` et mets l'authentification côté
Cloudflare Access (Zero Trust → Access → Applications), sinon l'app est ouverte à tous ceux
qui devinent l'URL.

---

## Ce que fait `deploy.sh install`

1. crée l'utilisateur système `nhlpronos` (shell `nologin`) ;
2. copie l'app dans `/opt/nhl-pronos` (droits 750) ;
3. génère `deploy/nhl-pronos.env` en **chmod 600** avec un jeton aléatoire de 48 caractères ;
4. installe trois unités systemd : `nhl-pronos.service` (le serveur, `Restart=always`),
   `nhl-pronos-refresh.service` + `.timer` (collecte à **07 h 10 et 19 h 10 UTC**, avec
   rattrapage si la machine était éteinte) ;
5. configure Caddy (ou `tailscale serve`) ;
6. relance l'autotest du serveur déployé.

Les unités sont durcies : `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
`PrivateTmp`, `CapabilityBoundingSet=` vide, `RestrictNamespaces`, `ProtectProc=invisible`,
`SystemCallFilter=@system-service`, et écriture autorisée **uniquement** dans `/opt/nhl-pronos`.

---

## Vérifier que tout va bien

```bash
sudo ./deploy/deploy.sh check                 # tout revérifier sans rien toucher
systemctl status nhl-pronos                   # le serveur tourne ?
systemctl list-timers nhl-pronos-refresh.timer  # prochaine collecte
journalctl -u nhl-pronos-refresh -n 30        # dernières collectes
tail -f /opt/nhl-pronos/logs/refresh.log      # journal des rafraîchissements
tail -f /opt/nhl-pronos/logs/access.log       # qui accède à l'app
curl -s -u moi:TONMDP https://ton-domaine/healthz
```

`/healthz` répond `{"ok": true, …}` : c'est la cible à donner à un superviseur
(Uptime Kuma, Better Stack, Healthchecks.io).

Autotest complet du serveur, à lancer après chaque mise à jour :

```bash
sudo -u nhlpronos python3 /opt/nhl-pronos/server.py --selftest              # avec collecte réelle (~90 s)
sudo -u nhlpronos python3 /opt/nhl-pronos/server.py --selftest --skip-refresh
```

---

## Mettre à jour

```bash
cd /opt/nhl-pronos
git pull                                       # ou recopier les fichiers
sudo ./deploy/deploy.sh check
sudo systemctl restart nhl-pronos
sudo -u nhlpronos python3 server.py --selftest --skip-refresh
```

Les données (`data/analyse.json`) et les secrets (`deploy/nhl-pronos.env`) ne sont jamais
écrasés par une mise à jour.

---

## Sécurité — à lire avant d'exposer

- **HTTPS obligatoire.** L'authentification HTTP envoie le mot de passe encodé en base64 :
  sans TLS, il est lisible sur le réseau. Caddy et Tailscale le font pour toi ; ne mets
  **jamais** le port 8000 directement sur Internet.
- **Le déclenchement à distance est protégé.** Si `NHL_REFRESH_TOKEN` est défini (c'est le
  cas après `install`), `GET /api/refresh?lancer=1` exige `&token=…`, comparé à temps
  constant. Le bouton de l'interface, lui, est déjà derrière l'authentification.
- **Une collecte coûte ~80 s et appelle l'API NHL.** Le verrou de `refresh.py` empêche deux
  collectes simultanées, et le serveur refuse une seconde demande (`deja_en_cours`).
- **Le Live interroge l'API NHL toutes les 20 s par onglet ouvert.** Avec le cache de 20 s
  côté serveur, dix écrans ouverts ne font qu'un appel par tranche de 20 s.
- **Aucune donnée personnelle n'est collectée.** `logs/access.log` ne contient que des
  adresses IP et des chemins, avec rotation à 5 Mo.
- **Mises à jour de sécurité du système** : `sudo apt-get install -y unattended-upgrades`.

---

## Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| « Serveur injoignable » dans l'app | `nhl-pronos.service` arrêté | `systemctl status nhl-pronos`, `journalctl -u nhl-pronos -n 50` |
| 502 derrière Caddy | le port 8000 n'écoute pas | même chose ; vérifie `NHL_BIND` dans `deploy/nhl-pronos.env` |
| 401 partout | mauvais identifiant/mot de passe | `caddy hash-password` puis `systemctl reload caddy` |
| Erreur TLS | DNS pas encore propagé, ou port 80 fermé | `dig +short ton-domaine`, ouvre 80/tcp |
| Onglet Live vide | le proxy n'atteint pas l'API NHL | `curl -I https://api-web.nhle.com/v1/score/now` depuis le serveur |
| Analyse qui date | la collecte échoue | `tail -50 logs/refresh.log` ; `refresh.py` renvoie 2 (collecte) ou 3 (moteur) |
