#!/usr/bin/env bash
# Installation et vérification du déploiement de Pronos NHL.
#
#   sudo ./deploy/deploy.sh check                      # vérifie tout, sans rien installer
#   sudo ./deploy/deploy.sh install --domain pronos.exemple.fr --user moi
#   sudo ./deploy/deploy.sh install --tailscale-only   # privé : aucune exposition Internet
#   sudo ./deploy/deploy.sh uninstall
#
# check ne touche à rien : il compile, lance l'autotest du serveur, vérifie la
# syntaxe Caddy et celle des unités systemd. À lancer avant et après install.
set -euo pipefail

APPDIR_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPDIR="/opt/nhl-pronos"
PORT="8000"
SVC_USER="nhlpronos"
DOMAIN=""
AUTH_USER=""
TAILSCALE_ONLY=0
PY="python3"

ok()   { printf '  \033[32mOK\033[0m    %s%s\n' "$1" "${2:+  $2}"; }
ko()   { printf '  \033[31mECHEC\033[0m %s%s\n' "$1" "${2:+  $2}"; ERREURS=$((ERREURS+1)); }
info() { printf '  \033[36mINFO\033[0m  %s%s\n' "$1" "${2:+  $2}"; }
die()  { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }
ERREURS=0

usage() { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------- vérification
cmd_check() {
  echo
  echo "=== 1. Python et syntaxe ==="
  command -v "$PY" >/dev/null || die "python3 introuvable"
  ok "python3 présent" "$($PY -V 2>&1)"
  for f in fetch_pronos.py engine.py server.py refresh.py; do
    if $PY -m py_compile "$APPDIR_SRC/$f" 2>/dev/null; then ok "$f compile"; else ko "$f ne compile pas"; fi
  done

  echo
  echo "=== 2. données présentes ==="
  if [ -f "$APPDIR_SRC/data/analyse.json" ]; then
    $PY - "$APPDIR_SRC/data/analyse.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"  OK    analyse.json lisible  {len(d['games'])} matchs, "
      f"{sum(len(g['players']) for g in d['games'])} analyses, {d['generatedUtc']}")
PY
  else
    info "analyse.json absente" "lance : python3 fetch_pronos.py && python3 engine.py"
  fi

  echo
  echo "=== 3. autotest du serveur (port éphémère, sans collecte) ==="
  if ( cd "$APPDIR_SRC" && $PY server.py --selftest --skip-refresh ); then
    ok "autotest du serveur"
  else
    ko "autotest du serveur"
  fi

  echo
  echo "=== 4. Caddyfile ==="
  local cf="$APPDIR_SRC/deploy/Caddyfile"
  if command -v caddy >/dev/null; then
    sed -e 's/__DOMAIN__/pronos.test.invalid/' -e 's/__USER__/testeur/' \
        -e 's/__HASH__/$2a$14$0000000000000000000000000000000000000000000000000000/' \
        -e 's/__PORT__/8000/' "$cf" > /tmp/nhl-caddyfile-test
    if caddy validate --config /tmp/nhl-caddyfile-test --adapter caddyfile >/dev/null 2>&1; then
      ok "Caddyfile valide" "caddy $(caddy version 2>/dev/null | cut -d' ' -f1)"
    else
      ko "Caddyfile invalide" "caddy validate --config /tmp/nhl-caddyfile-test"
    fi
  else
    info "caddy absent" "la syntaxe du Caddyfile n'a pas pu être vérifiée ici"
  fi

  echo
  echo "=== 5. unités systemd ==="
  local tmpd
  tmpd="$(mktemp -d)"
  for u in nhl-pronos.service nhl-pronos-refresh.service nhl-pronos-refresh.timer; do
    sed -e "s|__APPDIR__|$APPDIR|g" -e "s/__PORT__/$PORT/g" \
        "$APPDIR_SRC/deploy/$u" > "$tmpd/$u"
    if command -v systemd-analyze >/dev/null; then
      if systemd-analyze verify "$tmpd/$u" >/dev/null 2>&1; then
        ok "$u" "systemd-analyze verify"
      else
        ko "$u" "systemd-analyze verify échoue"
      fi
    else
      info "$u" "systemd-analyze absent : syntaxe non vérifiée"
    fi
  done
  rm -rf "$tmpd"

  echo
  echo "=== 6. scripts d'installation ==="
  if bash -n "$APPDIR_SRC/deploy/deploy.sh"; then ok "deploy.sh : syntaxe bash valide"; else ko "deploy.sh"; fi

  echo
  if [ "$ERREURS" -eq 0 ]; then
    echo "RESULTAT : TOUT EST PRET POUR L'INSTALLATION"
  else
    echo "RESULTAT : $ERREURS PROBLEME(S)"
  fi
  return "$ERREURS"
}

# ---------------------------------------------------------------- installation
cmd_install() {
  [ "$(id -u)" -eq 0 ] || die "install doit être lancé en root (sudo ./deploy/deploy.sh install …)"
  [ -n "$DOMAIN$TAILSCALE_ONLY" ] || die "manque --domain <hote> (ou --tailscale-only)"

  echo "=== 1. utilisateur de service ==="
  if id "$SVC_USER" >/dev/null 2>&1; then
    ok "utilisateur $SVC_USER déjà créé"
  else
    useradd --system --home-dir "$APPDIR" --shell /usr/sbin/nologin "$SVC_USER"
    ok "utilisateur $SVC_USER créé" "shell nologin, compte système"
  fi

  echo
  echo "=== 2. fichiers dans $APPDIR ==="
  mkdir -p "$APPDIR"
  for f in fetch_pronos.py engine.py server.py refresh.py app.html README.md DEPLOY.md deploy; do
    [ -e "$APPDIR_SRC/$f" ] && cp -a "$APPDIR_SRC/$f" "$APPDIR/"
  done
  mkdir -p "$APPDIR/data" "$APPDIR/logs"
  [ -f "$APPDIR_SRC/data/analyse.json" ] && cp -a "$APPDIR_SRC/data/analyse.json" "$APPDIR/data/" || true
  chown -R "$SVC_USER:$SVC_USER" "$APPDIR"
  chmod 750 "$APPDIR"
  ok "copie terminée" "$(du -sh "$APPDIR" | cut -f1)"

  echo
  echo "=== 3. secrets et environnement ==="
  local envf="$APPDIR/deploy/nhl-pronos.env"
  if [ ! -f "$envf" ]; then
    local jeton
    jeton="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    cp "$APPDIR_SRC/deploy/nhl-pronos.env.example" "$envf"
    if [ "$TAILSCALE_ONLY" -eq 1 ]; then
      sed -i "s/^NHL_BIND=.*/NHL_BIND=127.0.0.1/" "$envf"
    fi
    sed -i "s/^NHL_REFRESH_TOKEN=.*/NHL_REFRESH_TOKEN=$jeton/" "$envf"
    chmod 600 "$envf"
    ok "deploy/nhl-pronos.env créé" "chmod 600, jeton généré"
    printf '\n  Jeton de déclenchement à distance (à conserver) :\n  %s\n\n' "$jeton"
  else
    ok "deploy/nhl-pronos.env conservé"
  fi
  chown "$SVC_USER:$SVC_USER" "$envf"

  echo
  echo "=== 4. unités systemd ==="
  for u in nhl-pronos.service nhl-pronos-refresh.service nhl-pronos-refresh.timer; do
    sed -e "s|__APPDIR__|$APPDIR|g" -e "s/__PORT__/$PORT/g" \
        "$APPDIR/deploy/$u" > "/etc/systemd/system/$u"
    ok "/etc/systemd/system/$u"
  done
  systemctl daemon-reload
  systemctl enable --now nhl-pronos.service >/dev/null 2>&1 || true
  systemctl enable --now nhl-pronos-refresh.timer >/dev/null 2>&1 || true
  sleep 2
  if systemctl is-active --quiet nhl-pronos.service; then
    ok "service actif" "systemctl status nhl-pronos"
  else
    ko "service inactif" "journalctl -u nhl-pronos -n 30"
  fi
  info "prochain rafraîchissement" "$(systemctl list-timers nhl-pronos-refresh.timer --no-pager | sed -n 2p | awk '{print $1,$2,$3,$4}')"

  echo
  echo "=== 5. accès ==="
  if [ "$TAILSCALE_ONLY" -eq 1 ]; then
    command -v tailscale >/dev/null || die "tailscale absent : installe-le, ou relance avec --domain"
    tailscale serve --bg --https=443 --set-path / "http://127.0.0.1:$PORT" >/dev/null 2>&1 \
      || tailscale serve --bg "http://127.0.0.1:$PORT" >/dev/null 2>&1 \
      || die "tailscale serve a échoué : tailscale serve --bg http://127.0.0.1:$PORT"
    ok "exposé uniquement sur ton tailnet" "$(tailscale status 2>/dev/null | head -1)"
    info "URL" "https://$(hostname).<ton-tailnet>.ts.net/"
  else
    command -v caddy >/dev/null || {
      info "caddy absent : installation depuis cloudsmith.io"
      apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null 2>&1 || true
      curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      echo 'deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main' \
        > /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq && apt-get install -y -qq caddy
    }
    local mdp hash
    mdp="$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    hash="$(caddy hash-password --plaintext "$mdp")"
    sed -e "s/__DOMAIN__/$DOMAIN/" -e "s/__USER__/${AUTH_USER:-admin}/" \
        -e "s|__HASH__|$hash|" -e "s/__PORT__/$PORT/" \
        "$APPDIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
    if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
      ok "Caddyfile écrit et valide" "/etc/caddy/Caddyfile"
    else
      ko "Caddyfile invalide" "corrige /etc/caddy/Caddyfile puis systemctl reload caddy"
    fi
    systemctl reload caddy 2>/dev/null || systemctl restart caddy
    printf '\n  Identifiant : %s\n  Mot de passe : %s\n  (change-les : caddy hash-password, puis /etc/caddy/Caddyfile)\n\n' \
      "${AUTH_USER:-admin}" "$mdp"
    info "URL" "https://$DOMAIN/"
  fi

  echo
  echo "=== 6. autotest final ==="
  if ( cd "$APPDIR" && sudo -u "$SVC_USER" $PY server.py --selftest --skip-refresh ); then
    ok "autotest du serveur déployé"
  else
    ko "autotest du serveur déployé"
  fi

  echo
  if [ "$ERREURS" -eq 0 ]; then
    echo "RESULTAT : INSTALLE. Commandes utiles :"
    echo "  journalctl -u nhl-pronos -f          suivre le serveur"
    echo "  journalctl -u nhl-pronos-refresh -n 50   dernières collectes"
    echo "  systemctl restart nhl-pronos         redémarrer"
    echo "  sudo -u $SVC_USER $APPDIR/refresh.py     forcer une collecte"
  else
    echo "RESULTAT : $ERREURS PROBLEME(S) A REGLER"
  fi
  return "$ERREURS"
}

cmd_uninstall() {
  [ "$(id -u)" -eq 0 ] || die "uninstall doit être lancé en root"
  systemctl disable --now nhl-pronos-refresh.timer 2>/dev/null || true
  systemctl disable --now nhl-pronos.service 2>/dev/null || true
  rm -f /etc/systemd/system/nhl-pronos.service \
        /etc/systemd/system/nhl-pronos-refresh.service \
        /etc/systemd/system/nhl-pronos-refresh.timer
  systemctl daemon-reload
  ok "unités retirées" "$APPDIR et l'utilisateur $SVC_USER sont conservés"
}

# ---------------------------------------------------------------------- main
cmd="${1:-check}"; shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)         DOMAIN="${2:?}"; shift 2 ;;
    --user)           AUTH_USER="${2:?}"; shift 2 ;;
    --port)           PORT="${2:?}"; shift 2 ;;
    --tailscale-only) TAILSCALE_ONLY=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *)                die "option inconnue : $1" ;;
  esac
done

case "$cmd" in
  check)     cmd_check ;;
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  *)         usage; die "commande inconnue : $cmd" ;;
esac
