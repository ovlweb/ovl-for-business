#!/usr/bin/env bash
# OVL For Business — server setup.
#
# Installs and manages the platform on a Linux server: Docker, the code, the settings (.env) and
# the running stack (PostgreSQL, API, web client, admin panel, Caddy with automatic HTTPS, backups).
#
#   curl -fsSL https://raw.githubusercontent.com/ovlweb/ovl-for-business/main/setup.sh | sudo bash
#   sudo ./setup.sh                    # from a checkout; run it again later to update or manage
#   sudo ./setup.sh --help             # every option, including unattended installs
#
# The questions appear as windows on a desktop (zenity), as dialogs in a terminal or over SSH
# (whiptail or dialog), or as plain prompts when neither is available.
#
# Supported: Debian, Ubuntu, Raspberry Pi OS, Fedora, RHEL, CentOS Stream, Rocky, AlmaLinux,
# Oracle Linux, Amazon Linux, openSUSE / SLES, Arch, Manjaro and Alpine (x86-64 and ARM64).
# macOS works for trying it out with Docker Desktop. On Windows, run it inside WSL 2.

set -Eeuo pipefail

REPO_URL="${OVL_REPO_URL:-https://github.com/ovlweb/ovl-for-business.git}"
BRANCH="${OVL_BRANCH:-main}"
DEFAULT_DIR="/opt/ovl-for-business"
TITLE="OVL For Business setup"

# ---------------------------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------------------------

usage() {
  cat <<'EOF'
Usage: sudo ./setup.sh [command] [options]

Commands (without one: install, or the menu when it is already installed)
  install        Install, or change the settings of, an installation
  update         Back up, download the latest version and restart
  status         Show what is running and where
  logs           Show the last lines of the server logs
  backup         Back up the database and uploaded files now
  restart        Restart everything
  stop           Stop everything (data stays)
  uninstall      Remove the containers (asks before deleting data)

Options
  --dir DIR               Where the platform lives (default: this checkout, or /opt/ovl-for-business)
  --domain NAME           Public address of the app, e.g. business.example.com (automatic HTTPS)
  --admin-domain NAME     Address of the admin panel (default: admin.<domain>)
  --local                 No domain: plain HTTP on this server's address, ports 8080 / 8081
  --web-port N            Port of the app in --local mode (default 8080)
  --admin-port N          Port of the admin panel in --local mode (default 8081)
  --owner NAME            Username of the owner account (default: owner)
  --owner-email EMAIL     Email of the owner account
  --owner-password PASS   Password of the owner account (default: a generated one)
  --smtp URL              Mail server, e.g. smtp://user:password@mail.example.com:587
  --mail-from ADDRESS     Sender of emails (default: OVL For Business <no-reply@domain>)
  --branch NAME           Version to install (default: main)
  --yes                   Unattended: ask nothing, use the options above and defaults
  --no-firewall           Do not open ports in ufw / firewalld
  --no-start              Write the settings but do not start the platform
  --gui | --tui | --plain Force windows, terminal dialogs or plain prompts
  -h, --help              This help
EOF
}

COMMAND=""
DIR=""
OPT_DOMAIN=""
OPT_ADMIN_DOMAIN=""
OPT_LOCAL=""
OPT_WEB_PORT=""
OPT_ADMIN_PORT=""
OPT_OWNER=""
OPT_OWNER_EMAIL=""
OPT_OWNER_PASSWORD=""
OPT_SMTP=""
OPT_MAIL_FROM=""
YES=""
NO_FIREWALL=""
NO_START=""
FORCE_UI=""

ORIGINAL_ARGS=("$@")
while [[ $# -gt 0 ]]; do
  case "$1" in
    install | update | status | logs | backup | restart | stop | uninstall) COMMAND="$1" ;;
    --dir) DIR="$2"; shift ;;
    --domain) OPT_DOMAIN="$2"; shift ;;
    --admin-domain) OPT_ADMIN_DOMAIN="$2"; shift ;;
    --local) OPT_LOCAL=1 ;;
    --web-port) OPT_WEB_PORT="$2"; shift ;;
    --admin-port) OPT_ADMIN_PORT="$2"; shift ;;
    --owner) OPT_OWNER="$2"; shift ;;
    --owner-email) OPT_OWNER_EMAIL="$2"; shift ;;
    --owner-password) OPT_OWNER_PASSWORD="$2"; shift ;;
    --smtp) OPT_SMTP="$2"; shift ;;
    --mail-from) OPT_MAIL_FROM="$2"; shift ;;
    --branch) BRANCH="$2"; shift ;;
    --yes | -y) YES=1 ;;
    --no-firewall) NO_FIREWALL=1 ;;
    --no-start) NO_START=1 ;;
    --gui) FORCE_UI=zenity ;;
    --tui) FORCE_UI=tui ;;
    --plain) FORCE_UI=plain ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# ---------------------------------------------------------------------------------------------
# Output and the three kinds of user interface
# ---------------------------------------------------------------------------------------------

LOG="/tmp/ovl-setup-$(date +%Y%m%d-%H%M%S).log"
: >"$LOG"
UI=plain
TTY=/dev/tty
[[ -r /dev/tty && -w /dev/tty ]] || TTY=""

if [[ -t 1 ]] && command -v tput >/dev/null && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold) GREEN=$(tput setaf 2) RED=$(tput setaf 1) RESET=$(tput sgr0)
else
  BOLD="" GREEN="" RED="" RESET=""
fi

log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"; }

pick_ui() {
  local tui=""
  command -v whiptail >/dev/null && tui=whiptail
  [[ -z "$tui" ]] && command -v dialog >/dev/null && tui=dialog
  case "$FORCE_UI" in
    zenity) command -v zenity >/dev/null && UI=zenity && return ;;
    plain) UI=plain && return ;;
  esac
  if [[ "$FORCE_UI" != tui && -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && command -v zenity >/dev/null; then
    UI=zenity
  elif [[ -n "$tui" && -n "$TTY" ]]; then
    UI="$tui"
  else
    UI=plain
  fi
}

# Dialog size that fits the terminal.
box() {
  local lines cols
  lines=$(tput lines 2>/dev/null || echo 24)
  cols=$(tput cols 2>/dev/null || echo 80)
  BOX_H=$((lines > 26 ? 22 : lines - 4))
  BOX_W=$((cols > 84 ? 78 : cols - 6))
  BOX_L=$((BOX_H - 8))
}

zen_escape() { local s=${1//&/&amp;}; s=${s//</&lt;}; printf '%s' "${s//>/&gt;}"; }

# A zenity window that cannot reach the display: fall back to the terminal and ask again.
zen() {
  local out rc
  set +e
  out=$(zenity --title "$TITLE" "$@" 2>>"$LOG")
  rc=$?
  set -e
  if [[ $rc -gt 1 && $rc -ne 5 ]]; then
    log "zenity failed ($rc), using the terminal"
    UI=plain
    [[ -n "$TTY" ]] && command -v whiptail >/dev/null && UI=whiptail
    return 100
  fi
  printf '%s' "$out"
  return $rc
}

# whiptail / dialog print the answer on stderr; swap it to stdout. They draw on the terminal.
# shellcheck disable=SC2094
tui() { "$UI" --title "$TITLE" "$@" 3>&1 1>&2 2>&3 <"$TTY" >"$TTY"; }

cancelled() {
  if [[ -z "$YES" ]] && confirm "Stop the setup? Nothing else will be changed." yes; then
    echo "Setup stopped." >&2
    exit 1
  fi
}

# say MESSAGE — a message to read.
say() {
  local text=$1
  [[ -n "$YES" ]] && { printf '%s\n\n' "$text"; return; }
  case "$UI" in
    zenity) zen --info --width 520 --text "$(zen_escape "$text")" >/dev/null || [[ $? -ne 100 ]] || say "$text" ;;
    whiptail | dialog) box; tui --msgbox "$text" "$BOX_H" "$BOX_W" || true ;;
    *) printf '\n%s\n\n' "$text" ;;
  esac
}

# show_text TITLE FILE — a long text (status, logs, summary).
# shellcheck disable=SC2094
show_text() {
  local title=$1 file=$2
  if [[ -n "$YES" || "$UI" == plain ]]; then printf '\n%s%s%s\n' "$BOLD" "$title" "$RESET"; cat "$file"; echo; return; fi
  case "$UI" in
    zenity) zen --text-info --width 760 --height 520 --filename "$file" >/dev/null || [[ $? -ne 100 ]] || show_text "$title" "$file" ;;
    whiptail) box; whiptail --title "$title" --scrolltext --textbox "$file" "$BOX_H" "$BOX_W" <"$TTY" >"$TTY" || true ;;
    *) box; dialog --title "$title" --textbox "$file" "$BOX_H" "$BOX_W" <"$TTY" >"$TTY" || true ;;
  esac
}

# confirm QUESTION [yes|no] — succeeds on yes.
confirm() {
  local question=$1 default=${2:-yes} answer rc
  [[ -n "$YES" ]] && { [[ "$default" == yes ]]; return; }
  case "$UI" in
    zenity)
      zen --question --width 480 --text "$(zen_escape "$question")" >/dev/null && return 0
      rc=$?
      [[ $rc -eq 100 ]] && { confirm "$question" "$default"; return; }
      return 1
      ;;
    whiptail | dialog)
      box
      if [[ "$default" == no ]]; then tui --defaultno --yesno "$question" "$BOX_H" "$BOX_W"; else tui --yesno "$question" "$BOX_H" "$BOX_W"; fi
      ;;
    *)
      local hint="[Y/n]"
      [[ "$default" == no ]] && hint="[y/N]"
      while :; do
        read -r -p "$question $hint " answer <"$TTY" || answer=""
        answer=${answer:-$default}
        [[ "$answer" =~ ^[YyДд] ]] && return 0
        [[ "$answer" =~ ^[NnНн] ]] && return 1
        echo "Please answer y or n." >&2
      done
      ;;
  esac
}

# ask VAR QUESTION [DEFAULT] — a line of text.
ask() {
  local __var=$1 question=$2 default=${3:-} answer rc
  if [[ -n "$YES" ]]; then printf -v "$__var" '%s' "$default"; return; fi
  case "$UI" in
    zenity)
      set +e
      answer=$(zen --entry --width 520 --text "$(zen_escape "$question")" --entry-text "$default")
      rc=$?
      set -e
      [[ $rc -eq 100 ]] && { ask "$__var" "$question" "$default"; return; }
      [[ $rc -ne 0 ]] && { cancelled; ask "$__var" "$question" "$default"; return; }
      ;;
    whiptail | dialog)
      box
      if ! answer=$(tui --inputbox "$question" "$BOX_H" "$BOX_W" "$default"); then
        cancelled
        ask "$__var" "$question" "$default"
        return
      fi
      ;;
    *)
      question=${question%:}
      if [[ -n "$default" ]]; then read -r -p "$question [$default]: " answer <"$TTY" || true; else read -r -p "$question: " answer <"$TTY" || true; fi
      answer=${answer:-$default}
      ;;
  esac
  printf -v "$__var" '%s' "$answer"
}

# ask_secret VAR QUESTION — hidden input.
ask_secret() {
  local __var=$1 question=$2 answer rc
  case "$UI" in
    zenity)
      set +e
      answer=$(zen --entry --hide-text --width 520 --text "$(zen_escape "$question")")
      rc=$?
      set -e
      [[ $rc -eq 100 ]] && { ask_secret "$__var" "$question"; return; }
      [[ $rc -ne 0 ]] && { cancelled; ask_secret "$__var" "$question"; return; }
      ;;
    whiptail | dialog)
      box
      if [[ "$UI" == dialog ]]; then
        answer=$(tui --insecure --passwordbox "$question" "$BOX_H" "$BOX_W") || { cancelled; ask_secret "$__var" "$question"; return; }
      else
        answer=$(tui --passwordbox "$question" "$BOX_H" "$BOX_W") || { cancelled; ask_secret "$__var" "$question"; return; }
      fi
      ;;
    *)
      read -r -s -p "${question%:}: " answer <"$TTY" || true
      echo >&2
      ;;
  esac
  printf -v "$__var" '%s' "$answer"
}

# choose VAR QUESTION DEFAULT TAG LABEL [TAG LABEL…] — one of several.
choose() {
  local __var=$1 question=$2 default=$3 answer rc i
  shift 3
  local -a items=("$@")
  if [[ -n "$YES" ]]; then printf -v "$__var" '%s' "$default"; return; fi
  case "$UI" in
    zenity)
      local -a rows=()
      for ((i = 0; i < ${#items[@]}; i += 2)); do
        rows+=("$([[ "${items[i]}" == "$default" ]] && echo TRUE || echo FALSE)" "${items[i]}" "${items[i + 1]}")
      done
      set +e
      answer=$(zen --list --radiolist --width 640 --height 340 --text "$(zen_escape "$question")" \
        --column "" --column "id" --column "Choice" --hide-column 2 --print-column 2 "${rows[@]}")
      rc=$?
      set -e
      [[ $rc -eq 100 ]] && { choose "$__var" "$question" "$default" "${items[@]}"; return; }
      [[ $rc -ne 0 || -z "$answer" ]] && { cancelled; choose "$__var" "$question" "$default" "${items[@]}"; return; }
      ;;
    whiptail | dialog)
      box
      local -a rows=()
      for ((i = 0; i < ${#items[@]}; i += 2)); do
        rows+=("${items[i]}" "${items[i + 1]}" "$([[ "${items[i]}" == "$default" ]] && echo on || echo off)")
      done
      answer=$(tui --radiolist "$question" "$BOX_H" "$BOX_W" "$BOX_L" "${rows[@]}") || {
        cancelled
        choose "$__var" "$question" "$default" "${items[@]}"
        return
      }
      answer=${answer//\"/}
      ;;
    *)
      printf '\n%s\n' "$question" >&2
      local n=0 pick=1
      for ((i = 0; i < ${#items[@]}; i += 2)); do
        n=$((n + 1))
        [[ "${items[i]}" == "$default" ]] && pick=$n
        printf '  %d) %s\n' "$n" "${items[i + 1]}" >&2
      done
      read -r -p "Choose 1-$n [$pick]: " answer <"$TTY" || true
      answer=${answer:-$pick}
      [[ "$answer" =~ ^[0-9]+$ && "$answer" -ge 1 && "$answer" -le $n ]] || answer=$pick
      answer=${items[$(((answer - 1) * 2))]}
      ;;
  esac
  printf -v "$__var" '%s' "$answer"
}

# choose_many VAR QUESTION TAG LABEL on|off [TAG LABEL on|off…] — any of several (space separated).
choose_many() {
  local __var=$1 question=$2 answer rc i
  shift 2
  local -a items=("$@")
  if [[ -n "$YES" ]]; then
    answer=""
    for ((i = 0; i < ${#items[@]}; i += 3)); do [[ "${items[i + 2]}" == on ]] && answer+="${items[i]} "; done
    printf -v "$__var" '%s' "${answer% }"
    return
  fi
  case "$UI" in
    zenity)
      local -a rows=()
      for ((i = 0; i < ${#items[@]}; i += 3)); do
        rows+=("$([[ "${items[i + 2]}" == on ]] && echo TRUE || echo FALSE)" "${items[i]}" "${items[i + 1]}")
      done
      set +e
      answer=$(zen --list --checklist --width 680 --height 380 --separator " " --text "$(zen_escape "$question")" \
        --column "" --column "id" --column "Option" --hide-column 2 --print-column 2 "${rows[@]}")
      rc=$?
      set -e
      [[ $rc -eq 100 ]] && { choose_many "$__var" "$question" "${items[@]}"; return; }
      [[ $rc -ne 0 ]] && answer=""
      ;;
    whiptail | dialog)
      box
      answer=$(tui --checklist "$question (Space to select, Enter to continue)" "$BOX_H" "$BOX_W" "$BOX_L" "${items[@]}") || answer=""
      answer=${answer//\"/}
      ;;
    *)
      printf '\n%s\n' "$question" >&2
      local n=0 defaults=""
      for ((i = 0; i < ${#items[@]}; i += 3)); do
        n=$((n + 1))
        [[ "${items[i + 2]}" == on ]] && defaults+="$n "
        printf '  %d) %s\n' "$n" "${items[i + 1]}" >&2
      done
      read -r -p "Numbers separated by spaces, or Enter for ${defaults:-none}: " answer <"$TTY" || true
      answer=${answer:-$defaults}
      local picked=""
      for n in $answer; do
        [[ "$n" =~ ^[0-9]+$ && "$n" -ge 1 && "$n" -le $((${#items[@]} / 3)) ]] && picked+="${items[$(((n - 1) * 3))]} "
      done
      answer=${picked% }
      ;;
  esac
  printf -v "$__var" '%s' "$answer"
}

# run_step MESSAGE COMMAND… — a long step with progress; its output goes to the log.
run_step() {
  local message=$1 pid rc=0 elapsed=0
  shift
  log "== $message: $*"
  ("$@") >>"$LOG" 2>&1 &
  pid=$!
  case "$UI" in
    zenity)
      if [[ -z "$YES" ]]; then
        (
          while kill -0 "$pid" 2>/dev/null; do
            echo "# $message"
            sleep 1
          done
          echo 100
        ) | zenity --title "$TITLE" --progress --pulsate --auto-close --no-cancel --width 460 --text "$message" 2>>"$LOG" || true
      fi
      ;;
    whiptail | dialog)
      if [[ -z "$YES" ]]; then
        box
        (
          # Fills slowly towards 95 % while the step runs.
          local pct=0
          while kill -0 "$pid" 2>/dev/null; do
            elapsed=$((elapsed + 1))
            pct=$((95 - 95 * 30 / (30 + elapsed)))
            printf 'XXX\n%d\n%s\n\n%s\nXXX\n' "$pct" "$message" "Working… ${elapsed}s (details: $LOG)"
            sleep 1
          done
          printf 'XXX\n100\n%s\nXXX\n' "$message"
        ) | "$UI" --title "$TITLE" --gauge "$message" 10 "$BOX_W" 0 >"$TTY" 2>/dev/null || true
      fi
      ;;
  esac
  if [[ "$UI" == plain || -n "$YES" ]]; then
    printf '%s… ' "$message" >&2
    while kill -0 "$pid" 2>/dev/null; do
      sleep 2
      printf '.' >&2
    done
  fi
  wait "$pid" || rc=$?
  if [[ "$UI" == plain || -n "$YES" ]]; then
    if [[ $rc -eq 0 ]]; then printf ' %sdone%s\n' "$GREEN" "$RESET" >&2; else printf ' %sfailed%s\n' "$RED" "$RESET" >&2; fi
  fi
  log "== $message: exit $rc"
  return $rc
}

fail() {
  local message=$1 tail_file
  tail_file=$(mktemp)
  {
    printf '%s\n\nThe last lines of %s:\n\n' "$message" "$LOG"
    tail -n 25 "$LOG"
  } >"$tail_file"
  if [[ "$UI" == plain || -n "$YES" ]]; then
    printf '\n%sSetup failed:%s ' "$RED" "$RESET" >&2
    cat "$tail_file" >&2
  else
    show_text "Setup failed" "$tail_file"
  fi
  rm -f "$tail_file"
  exit 1
}

# ---------------------------------------------------------------------------------------------
# The system
# ---------------------------------------------------------------------------------------------

OS_NAME="" OS_ID="" OS_LIKE="" PKG="" IS_WSL=""

detect_system() {
  if [[ "$(uname -s)" == Darwin ]]; then
    OS_ID=macos OS_NAME="macOS $(sw_vers -productVersion 2>/dev/null || true)" PKG=brew
    return
  fi
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID=${ID:-linux} OS_LIKE=${ID_LIKE:-} OS_NAME=${PRETTY_NAME:-Linux}
  fi
  grep -qi microsoft /proc/version 2>/dev/null && IS_WSL=1
  if command -v apt-get >/dev/null; then PKG=apt
  elif command -v dnf >/dev/null; then PKG=dnf
  elif command -v yum >/dev/null; then PKG=yum
  elif command -v zypper >/dev/null; then PKG=zypper
  elif command -v pacman >/dev/null; then PKG=pacman
  elif command -v apk >/dev/null; then PKG=apk
  fi
}

pkg_install() {
  case "$PKG" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$@" ;;
    dnf) dnf install -y -q "$@" ;;
    yum) yum install -y -q "$@" ;;
    zypper) zypper --non-interactive install --no-recommends "$@" ;;
    pacman) pacman -Sy --noconfirm --needed "$@" ;;
    apk) apk add --no-cache "$@" ;;
    brew) brew install "$@" ;;
    *) return 1 ;;
  esac
}

# The dialog tool for this system, installed quietly when missing.
ensure_dialog_tool() {
  [[ -n "$YES" || "$FORCE_UI" == plain || "$FORCE_UI" == zenity || -z "$TTY" ]] && return 0
  command -v whiptail >/dev/null || command -v dialog >/dev/null && return 0
  [[ $EUID -eq 0 ]] || return 0
  case "$PKG" in
    apt) pkg_install whiptail ;;
    dnf | yum | zypper | apk) pkg_install newt ;;
    pacman) pkg_install libnewt ;;
  esac >>"$LOG" 2>&1 || true
}

need_root() {
  [[ $EUID -eq 0 || "$OS_ID" == macos ]] && return 0
  if command -v sudo >/dev/null && [[ -f "${BASH_SOURCE[0]:-}" ]]; then
    exec sudo -E bash "${BASH_SOURCE[0]}" "${ORIGINAL_ARGS[@]}"
  fi
  echo "Run the setup as root: sudo bash setup.sh (or pipe it to sudo bash)." >&2
  exit 1
}

have_compose() { docker compose version >/dev/null 2>&1; }

install_compose_plugin() {
  local arch dir=/usr/local/lib/docker/cli-plugins
  arch=$(uname -m)
  [[ "$arch" == arm64 ]] && arch=aarch64
  mkdir -p "$dir"
  curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$arch" -o "$dir/docker-compose"
  chmod +x "$dir/docker-compose"
}

install_docker() {
  local family=$OS_ID
  case "$OS_ID" in
    ubuntu | debian | raspbian | fedora | centos | rhel | sles) family=official ;;
    rocky | almalinux | ol) family=rhel ;;
    *)
      [[ " $OS_LIKE " == *" ubuntu "* || " $OS_LIKE " == *" debian "* ]] && family=debian-like
      [[ " $OS_LIKE " == *" rhel "* || " $OS_LIKE " == *" centos "* ]] && family=rhel
      [[ " $OS_LIKE " == *" arch "* ]] && family=arch
      [[ " $OS_LIKE " == *" suse "* ]] && family=suse
      ;;
  esac
  case "$family" in
    rhel)
      if command -v dnf >/dev/null; then
        dnf install -y -q dnf-plugins-core
        dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo ||
          dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/centos/docker-ce.repo
        dnf install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      else
        yum install -y -q yum-utils
        yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        yum install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      fi
      ;;
    amzn) pkg_install docker ;;
    arch | manjaro | endeavouros) pkg_install docker docker-compose docker-buildx ;;
    suse | opensuse*) pkg_install docker docker-compose ;;
    alpine) pkg_install docker docker-cli-compose ;;
    debian-like)
      # Linux Mint, Pop!_OS, elementary…: Docker from the distribution.
      pkg_install docker.io
      pkg_install docker-compose-v2 || true
      ;;
    *)
      # Debian, Ubuntu, Raspberry Pi OS, Fedora, CentOS, SLES: Docker's own installer.
      curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
      sh /tmp/get-docker.sh
      ;;
  esac
  have_compose || install_compose_plugin
  if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
    systemctl enable --now docker
  elif command -v rc-update >/dev/null; then
    rc-update add docker default && rc-service docker start
  else
    service docker start
  fi
}

ensure_tools() {
  local missing=()
  command -v curl >/dev/null || missing+=(curl)
  command -v git >/dev/null || missing+=(git)
  command -v openssl >/dev/null || missing+=(openssl)
  [[ ${#missing[@]} -eq 0 ]] && return 0
  [[ "$PKG" == apt ]] && missing+=(ca-certificates)
  run_step "Installing ${missing[*]}" pkg_install "${missing[@]}" || fail "Could not install ${missing[*]}."
}

ensure_docker() {
  if command -v docker >/dev/null && docker info >/dev/null 2>&1 && have_compose; then return 0; fi
  if [[ "$OS_ID" == macos ]]; then
    fail "Install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, then run the setup again."
  fi
  if command -v docker >/dev/null && ! docker info >/dev/null 2>&1; then
    run_step "Starting Docker" bash -c 'systemctl start docker 2>/dev/null || rc-service docker start 2>/dev/null || service docker start' || true
    docker info >/dev/null 2>&1 && { have_compose || run_step "Installing Docker Compose" install_compose_plugin; } && have_compose && return 0
  fi
  confirm "Docker is needed to run the platform and is not installed. Install Docker now?" yes || fail "Docker is required."
  run_step "Installing Docker (a few minutes)" install_docker || fail "Docker could not be installed."
  docker info >/dev/null 2>&1 || fail "Docker was installed but does not run."
  have_compose || fail "Docker Compose is missing."
}

primary_ip() {
  local ip=""
  if [[ "$OS_ID" == macos ]]; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || true)
  elif command -v ip >/dev/null; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  fi
  [[ -z "$ip" ]] && ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  printf '%s' "${ip:-127.0.0.1}"
}

port_busy() {
  if command -v ss >/dev/null; then ss -ltnH "sport = :$1" 2>/dev/null | grep -q .
  elif command -v lsof >/dev/null; then lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else return 1
  fi
}

# Ports already taken by something other than this platform.
busy_ports() {
  local busy="" p
  for p in "$@"; do
    [[ -n "$p" ]] || continue
    port_busy "$p" || continue
    docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E "ovl-proxy.*:$p->" -q && continue
    busy+="$p "
  done
  printf '%s' "${busy% }"
}

check_resources() {
  local mem_mb=0 disk_gb=0 notes=""
  if [[ -r /proc/meminfo ]]; then mem_mb=$(($(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024)); fi
  mkdir -p "$(dirname "$DIR")"
  disk_gb=$(df -Pk "$(dirname "$DIR")" | awk 'NR == 2 {print int($4 / 1048576)}')
  [[ $mem_mb -gt 0 && $mem_mb -lt 1800 ]] && notes+="• Memory: ${mem_mb} MB. 2 GB or more is recommended (building needs it).\n"
  [[ $disk_gb -lt 8 ]] && notes+="• Free disk space: ${disk_gb} GB. 10 GB or more is recommended.\n"
  if [[ -n "$notes" ]]; then
    confirm "$(printf "This server is smaller than recommended:\n\n%b\nContinue anyway?" "$notes")" yes || exit 1
  fi
}

# ---------------------------------------------------------------------------------------------
# Settings (.env)
# ---------------------------------------------------------------------------------------------

ENV_FILE=""

random_hex() { if command -v openssl >/dev/null; then openssl rand -hex "$1"; else od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; fi; }
random_password() { local h; h=$(random_hex 10); printf '%s-%s-%s-%s' "${h:0:5}" "${h:5:5}" "${h:10:5}" "${h:15:5}"; }

get_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)
  line=${line#*=}
  line=${line#\'}
  line=${line%\'}
  line=${line#\"}
  printf '%s' "${line%\"}"
}

# set_env KEY VALUE — replaces the line (or a commented-out one) or adds it. Values are quoted
# with single quotes so docker compose takes them literally.
set_env() {
  local key=$1 value=$2 line
  if [[ -z "$value" ]]; then line="$key="; else line="$key='$value'"; fi
  if grep -qE "^#? ?$key=" "$ENV_FILE"; then
    KEY="$key" LINE="$line" awk '
      BEGIN { done = 0 }
      !done && ($0 ~ "^" ENVIRON["KEY"] "=" || $0 ~ "^# ?" ENVIRON["KEY"] "=") { print ENVIRON["LINE"]; done = 1; next }
      { print }
    ' "$ENV_FILE" >"$ENV_FILE.tmp"
    # Rewrite in place, so the file keeps its owner-only permissions.
    cat "$ENV_FILE.tmp" >"$ENV_FILE"
    rm -f "$ENV_FILE.tmp"
  else
    printf '%s\n' "$line" >>"$ENV_FILE"
  fi
}

urlencode() {
  local s=$1 out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case "$c" in [a-zA-Z0-9.~_-]) out+="$c" ;; *) out+=$(printf '%%%02X' "'$c") ;; esac
  done
  printf '%s' "$out"
}

valid_domain() { [[ "$1" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; }
valid_email() { [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; }
valid_port() { [[ "$1" =~ ^[0-9]+$ && "$1" -ge 1 && "$1" -le 65535 ]]; }

# The values the questions produce.
MODE="" DOMAIN="" ADMIN_DOMAIN="" WEB_PORT="" ADMIN_PORT="" OWNER="" OWNER_EMAIL="" OWNER_PASSWORD=""
PASSWORD_GENERATED="" SMTP_URL="" MAIL_FROM="" EXTRAS=""

ask_settings() {
  local current_mode=domain
  [[ -f "$ENV_FILE" && "$(get_env WEB_ADDRESS)" == :* ]] && current_mode=local
  [[ -n "$OPT_DOMAIN" ]] && current_mode=domain
  [[ -n "$OPT_LOCAL" ]] && current_mode=local

  choose MODE "How will people reach the platform?" "$current_mode" \
    domain "With domain names, e.g. business.example.com (automatic HTTPS)" \
    local "By this server's address, plain HTTP (local network or testing)"

  if [[ "$MODE" == domain ]]; then
    local current_domain
    current_domain=${OPT_DOMAIN:-$(get_env WEB_ADDRESS)}
    [[ "$current_domain" == :* ]] && current_domain=""
    while :; do
      ask DOMAIN "Domain of the app (its DNS A/AAAA record must point to this server):" "$current_domain"
      valid_domain "$DOMAIN" && break
      [[ -n "$YES" ]] && fail "--domain '$DOMAIN' is not a domain name."
      say "\"$DOMAIN\" is not a domain name. Use something like business.example.com."
    done
    local current_admin=${OPT_ADMIN_DOMAIN:-$(get_env ADMIN_ADDRESS)}
    [[ -z "$current_admin" || "$current_admin" == :* ]] && current_admin="admin.$DOMAIN"
    while :; do
      ask ADMIN_DOMAIN "Domain of the admin panel (staff only; also needs a DNS record):" "$current_admin"
      valid_domain "$ADMIN_DOMAIN" && [[ "$ADMIN_DOMAIN" != "$DOMAIN" ]] && break
      [[ -n "$YES" ]] && fail "--admin-domain must be a domain name other than the app's."
      say "Use a domain name other than the app's, e.g. admin.$DOMAIN."
    done
    if command -v getent >/dev/null; then
      local unresolved=""
      getent ahosts "$DOMAIN" >/dev/null 2>&1 || unresolved+="$DOMAIN "
      getent ahosts "$ADMIN_DOMAIN" >/dev/null 2>&1 || unresolved+="$ADMIN_DOMAIN"
      [[ -n "$unresolved" ]] && say "No DNS record found yet for: $unresolved

Create A (or AAAA) records pointing to this server. HTTPS certificates are issued automatically once they resolve; until then the sites are not reachable by name."
    fi
  else
    ask WEB_PORT "Port of the app:" "${OPT_WEB_PORT:-$(get_env WEB_PORT)}"
    WEB_PORT=${WEB_PORT:-8080}
    ask ADMIN_PORT "Port of the admin panel:" "${OPT_ADMIN_PORT:-$(get_env ADMIN_PORT)}"
    ADMIN_PORT=${ADMIN_PORT:-8081}
    if ! valid_port "$WEB_PORT" || ! valid_port "$ADMIN_PORT" || [[ "$WEB_PORT" == "$ADMIN_PORT" ]]; then
      fail "Ports must be two different numbers from 1 to 65535."
    fi
  fi

  local current_owner=${OPT_OWNER:-$(get_env OWNER_USERNAME)}
  while :; do
    ask OWNER "Username of the owner account (full control of the platform):" "${current_owner:-owner}"
    [[ "$OWNER" =~ ^[a-z][a-z0-9_]{2,31}$ ]] && break
    [[ -n "$YES" ]] && fail "--owner needs 3-32 lowercase letters, digits or _, starting with a letter."
    say "\"$OWNER\" cannot be a username: use 3-32 lowercase letters, digits or _, starting with a letter."
  done

  local current_email=${OPT_OWNER_EMAIL:-$(get_env OWNER_EMAIL)}
  [[ "$current_email" == owner@example.com ]] && current_email=""
  while :; do
    ask OWNER_EMAIL "Email of the owner account:" "$current_email"
    valid_email "$OWNER_EMAIL" && break
    [[ -n "$YES" ]] && fail "Give the owner's email with --owner-email."
    say "\"$OWNER_EMAIL\" is not an email address."
  done

  local existing_password
  existing_password=$(get_env OWNER_PASSWORD)
  [[ "$existing_password" == change-me* ]] && existing_password=""
  if [[ -n "$OPT_OWNER_PASSWORD" ]]; then
    OWNER_PASSWORD=$OPT_OWNER_PASSWORD
  elif [[ -n "$existing_password" ]] && confirm "Keep the owner's current password?" yes; then
    OWNER_PASSWORD=$existing_password
  elif confirm "Generate a strong password for the owner? (Choose No to type your own.)" yes; then
    OWNER_PASSWORD=$(random_password)
    PASSWORD_GENERATED=1
  else
    while :; do
      local again
      ask_secret OWNER_PASSWORD "Owner password (at least 12 characters):"
      ask_secret again "The same password again:"
      [[ ${#OWNER_PASSWORD} -ge 12 && "$OWNER_PASSWORD" == "$again" && "$OWNER_PASSWORD" != *"'"* ]] && break
      say "The passwords must match, have at least 12 characters and no ' character."
    done
  fi
  [[ ${#OWNER_PASSWORD} -ge 8 && "$OWNER_PASSWORD" != *"'"* ]] || fail "The owner password needs at least 8 characters and no ' character."

  SMTP_URL=${OPT_SMTP:-$(get_env SMTP_URL)}
  local smtp_login=""
  if [[ -z "$YES" ]]; then
    local mail_question="Send emails (address confirmations, password resets, monthly statements) through a mail server?"
    [[ -n "$SMTP_URL" ]] && mail_question="Emails go through ${SMTP_URL%%://*}://…@${SMTP_URL##*@}. Change the mail server?"
    if confirm "$mail_question" "$([[ -n "$SMTP_URL" ]] && echo no || echo yes)"; then
      local host port user pass scheme=smtp
      ask host "Mail server (SMTP) host, e.g. smtp.example.com:" ""
      ask port "Port (587 for STARTTLS, 465 for TLS):" "587"
      ask user "Username:" "$OWNER_EMAIL"
      ask_secret pass "Password:"
      [[ "$port" == 465 ]] && scheme=smtps
      if [[ -n "$host" ]]; then
        SMTP_URL="$scheme://$(urlencode "$user"):$(urlencode "$pass")@$host:$port"
        smtp_login=$user
      else
        SMTP_URL=""
      fi
    fi
  fi
  MAIL_FROM=${OPT_MAIL_FROM:-$(get_env MAIL_FROM)}
  if [[ -z "$MAIL_FROM" || "$MAIL_FROM" == *business.example.com* || "$MAIL_FROM" == *@localhost* ]]; then
    local mail_host=${SMTP_URL##*@}
    mail_host=${mail_host%%:*}
    mail_host=${mail_host#smtp.}
    MAIL_FROM="OVL For Business <no-reply@${DOMAIN:-${mail_host:-localhost}}>"
    # Without a domain of its own, the platform sends as the mail account it signs in with.
    [[ -z "$DOMAIN" && "$smtp_login" == *@* ]] && MAIL_FROM="OVL For Business <$smtp_login>"
  fi
  if [[ -n "$smtp_login" ]]; then
    ask MAIL_FROM "Sender of the emails (many mail servers accept only their own addresses):" "$MAIL_FROM"
  fi

  local relaxed=off
  [[ -z "$SMTP_URL" ]] && relaxed=on
  choose_many EXTRAS "Optional settings:" \
    relax "Let people submit applications before confirming their email" "$relaxed" \
    s3 "Store uploaded files in S3 / MinIO / R2 instead of on this server" off \
    sso "Single sign-on for staff (OpenID Connect)" off \
    allowlist "Allow the admin API only from certain IP addresses" off \
    metrics "Protect GET /metrics with a token (for Prometheus)" off
  ask_extras
}

# Values of the optional settings, written with the rest.
declare -A EXTRA=()

ask_extras() {
  local value
  EXTRA=()
  if [[ " $EXTRAS " == *" s3 "* ]]; then
    ask value "S3 endpoint URL (empty for AWS), e.g. https://s3.example.com:" "$(get_env S3_ENDPOINT)"; EXTRA[S3_ENDPOINT]=$value
    ask value "Bucket:" "$(get_env S3_BUCKET)"; EXTRA[S3_BUCKET]=$value
    ask value "Region:" "$(get_env S3_REGION)"; EXTRA[S3_REGION]=${value:-us-east-1}
    ask value "Access key ID:" "$(get_env S3_ACCESS_KEY_ID)"; EXTRA[S3_ACCESS_KEY_ID]=$value
    ask_secret value "Secret access key:"; EXTRA[S3_SECRET_ACCESS_KEY]=$value
    EXTRA[STORAGE_DRIVER]=s3
  fi
  if [[ " $EXTRAS " == *" sso "* ]]; then
    ask value "Issuer URL of the identity provider, e.g. https://login.example.com/realms/staff:" "$(get_env OIDC_ISSUER)"; EXTRA[OIDC_ISSUER]=$value
    ask value "Client ID:" "$(get_env OIDC_CLIENT_ID)"; EXTRA[OIDC_CLIENT_ID]=$value
    ask_secret value "Client secret:"; EXTRA[OIDC_CLIENT_SECRET]=$value
  fi
  if [[ " $EXTRAS " == *" allowlist "* ]]; then
    ask value "Addresses or networks allowed to use the admin API, separated by commas (e.g. 203.0.113.0/24):" "$(get_env ADMIN_IP_ALLOWLIST)"
    EXTRA[ADMIN_IP_ALLOWLIST]=$value
  fi
  if [[ " $EXTRAS " == *" metrics "* ]]; then
    value=$(get_env METRICS_TOKEN)
    EXTRA[METRICS_TOKEN]=${value:-$(random_hex 24)}
  fi
  if [[ " $EXTRAS " == *" relax "* ]]; then EXTRA[REQUIRE_VERIFIED_EMAIL]=false; else EXTRA[REQUIRE_VERIFIED_EMAIL]=true; fi
}

write_settings() {
  local fresh=""
  # The settings hold passwords and secrets: only root may read them.
  umask 077
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$DIR/.env.example" "$ENV_FILE"
    fresh=1
  else
    cp -p "$ENV_FILE" "$ENV_FILE.backup-$(date +%Y%m%d-%H%M%S)"
  fi
  chmod 600 "$ENV_FILE" "$ENV_FILE".backup-* 2>/dev/null || true
  # The database password and the signing secret are made once: changing them later would lock
  # the platform out of its own database and sign everybody out.
  local pg jwt
  pg=$(get_env POSTGRES_PASSWORD)
  jwt=$(get_env JWT_SECRET)
  [[ -z "$pg" || "$pg" == change-me* ]] && pg=$(random_hex 24)
  [[ -z "$jwt" || "$jwt" == change-me* ]] && jwt=$(random_hex 32)
  set_env POSTGRES_PASSWORD "$pg"
  set_env JWT_SECRET "$jwt"
  set_env OWNER_USERNAME "$OWNER"
  set_env OWNER_EMAIL "$OWNER_EMAIL"
  set_env OWNER_PASSWORD "$OWNER_PASSWORD"
  if [[ "$MODE" == domain ]]; then
    set_env WEB_ADDRESS "$DOMAIN"
    set_env ADMIN_ADDRESS "$ADMIN_DOMAIN"
    set_env PUBLIC_WEB_URL "https://$DOMAIN"
    set_env PUBLIC_ADMIN_URL "https://$ADMIN_DOMAIN"
    set_env WEB_PORT 8080
    set_env ADMIN_PORT 8081
  else
    local ip
    ip=$(primary_ip)
    set_env WEB_ADDRESS ":8080"
    set_env ADMIN_ADDRESS ":8081"
    set_env WEB_PORT "$WEB_PORT"
    set_env ADMIN_PORT "$ADMIN_PORT"
    set_env PUBLIC_WEB_URL "http://$ip:$WEB_PORT"
    set_env PUBLIC_ADMIN_URL "http://$ip:$ADMIN_PORT"
  fi
  set_env SMTP_URL "$SMTP_URL"
  set_env MAIL_FROM "$MAIL_FROM"
  set_env VAPID_SUBJECT "mailto:$OWNER_EMAIL"
  local key
  for key in "${!EXTRA[@]}"; do set_env "$key" "${EXTRA[$key]}"; done
  log "settings written to $ENV_FILE${fresh:+ (new)}"
}

review_settings() {
  local file
  file=$(mktemp)
  {
    echo "Please check the settings:"
    echo
    if [[ "$MODE" == domain ]]; then
      echo "  App:           https://$DOMAIN"
      echo "  Admin panel:   https://$ADMIN_DOMAIN"
    else
      echo "  App:           http://$(primary_ip):$WEB_PORT"
      echo "  Admin panel:   http://$(primary_ip):$ADMIN_PORT"
    fi
    echo "  Owner:         $OWNER <$OWNER_EMAIL>"
    echo "  Password:      $([[ -n "$PASSWORD_GENERATED" ]] && echo "generated (shown at the end)" || echo "set")"
    echo "  Emails:        $([[ -n "$SMTP_URL" ]] && echo "through ${SMTP_URL##*@}" || echo "not sent (only logged)")"
    echo "  Options:       ${EXTRAS:-none}"
    echo "  Installed in:  $DIR"
  } >"$file"
  if [[ -z "$YES" && "$UI" != plain ]]; then
    local text
    text=$(cat "$file")
    rm -f "$file"
    confirm "$text

Save these settings and start?" yes
  else
    cat "$file"
    rm -f "$file"
    [[ -n "$YES" ]] || confirm "Save these settings and start?" yes
  fi
}

# ---------------------------------------------------------------------------------------------
# The code and the stack
# ---------------------------------------------------------------------------------------------

# From the installation folder, so a docker-compose.override.yml there (your own changes, kept across
# updates) is used too.
compose() { (cd "$DIR" && docker compose "$@"); }

is_checkout() { [[ -f "$1/docker-compose.yml" && -f "$1/deploy/caddy/Caddyfile" && -f "$1/.env.example" ]]; }

locate_dir() {
  if [[ -z "$DIR" ]]; then
    local here
    here=""
    if [[ -f "${BASH_SOURCE[0]:-}" ]]; then here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); fi
    if [[ -n "$here" ]] && is_checkout "$here"; then DIR=$here; else DIR=$DEFAULT_DIR; fi
  fi
  ENV_FILE="$DIR/.env"
}

fetch_code() {
  is_checkout "$DIR" && return 0
  if [[ -e "$DIR" && -n "$(ls -A "$DIR" 2>/dev/null)" ]]; then
    fail "$DIR exists and is not an OVL For Business installation. Choose another folder with --dir."
  fi
  run_step "Downloading OVL For Business ($BRANCH)" git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$DIR" ||
    fail "Could not download $REPO_URL."
}

open_firewall() {
  [[ -n "$NO_FIREWALL" || "$OS_ID" == macos ]] && return 0
  local ports
  if [[ "$MODE" == domain ]]; then ports="80 443"; else ports="$WEB_PORT $ADMIN_PORT"; fi
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    confirm "The ufw firewall is on. Open ports ${ports// /, } for the platform?" yes || return 0
    local p
    for p in $ports; do ufw allow "$p/tcp" >>"$LOG" 2>&1; done
  elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    confirm "firewalld is on. Open ports ${ports// /, } for the platform?" yes || return 0
    local p
    for p in $ports; do firewall-cmd --permanent --add-port="$p/tcp" >>"$LOG" 2>&1; done
    firewall-cmd --reload >>"$LOG" 2>&1
  fi
}

wait_healthy() {
  local i
  for ((i = 0; i < 90; i++)); do
    compose exec -T api wget -qO- http://127.0.0.1:4000/health >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

start_stack() {
  local busy
  busy=$(busy_ports 80 443 "$(get_env WEB_PORT || true)" "$(get_env ADMIN_PORT || true)")
  if [[ -n "$busy" ]]; then
    confirm "These ports are used by another program: $busy

The platform's proxy needs them (80 and 443 for HTTPS). Stop that program (for example: sudo systemctl stop nginx apache2) and choose Yes to try, or No to stop the setup." yes || exit 1
  fi
  run_step "Building and starting the platform (5-10 minutes the first time)" compose up -d --build --remove-orphans ||
    fail "The platform did not start."
  run_step "Waiting for the server to answer" wait_healthy || fail "The server did not become healthy. See: docker compose logs api"
  docker image prune -f >>"$LOG" 2>&1 || true
}

addresses() {
  local web admin
  web=$(get_env PUBLIC_WEB_URL)
  admin=$(get_env PUBLIC_ADMIN_URL)
  printf '  App:           %s\n  Admin panel:   %s\n  API reference: %s/api/docs\n' "$web" "$admin" "$web"
}

finish_install() {
  local file hours
  file=$(mktemp)
  {
    echo "OVL For Business is running."
    echo
    addresses
    echo
    echo "Sign in to the admin panel as the owner:"
    echo "  Username:      $(get_env OWNER_USERNAME)"
    if [[ -n "$PASSWORD_GENERATED" ]]; then
      echo "  Password:      $(get_env OWNER_PASSWORD)"
      echo "                 (write it down; it is also in $ENV_FILE)"
    fi
    echo
    echo "The admin panel asks the owner to turn on two-step verification at the first sign-in."
    [[ -z "$(get_env SMTP_URL)" ]] && echo "Emails are not sent until a mail server is set: run this setup again and change the settings."
    echo
    hours=$(get_env BACKUP_INTERVAL_HOURS)
    echo "Everything restarts on its own after a reboot. Backups run every ${hours:-24} hours."
    echo "To update, back up or change settings later, run:  sudo $DIR/setup.sh"
    echo
    echo "The apps for phones and computers: on any computer with this repository, run ./build-clients.sh"
    echo "(on Windows: build-clients.cmd) and give it the address $(get_env PUBLIC_WEB_URL)."
    echo
    echo "Settings: $ENV_FILE   Setup log: $LOG"
  } >"$file"
  show_text "OVL For Business is ready" "$file"
  rm -f "$file"
}

# ---------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------

cmd_install() {
  say "This sets up OVL For Business on $OS_NAME:

  1. Docker (if missing)
  2. The platform, in $DIR
  3. A few questions: addresses, the owner account, email
  4. Start, with HTTPS certificates for your domains

It takes 10-15 minutes, mostly for the first build."
  check_resources
  ensure_tools
  ensure_docker
  fetch_code
  ENV_FILE="$DIR/.env"
  ask_settings
  review_settings || { echo "Nothing was changed." >&2; exit 1; }
  write_settings
  open_firewall
  if [[ -n "$NO_START" ]]; then
    say "Settings saved in $ENV_FILE. Start the platform with: sudo $DIR/setup.sh restart"
    return
  fi
  start_stack
  finish_install
}

cmd_update() {
  confirm "Back up, download the latest version and restart? The platform is unavailable for a minute or two." yes || return 0
  if ! run_step "Backing up first" compose exec -T backup sh /deploy/backup.sh; then
    confirm "The backup failed. Update anyway?" no || { say "Not updated: the backup failed (see $LOG)."; return 0; }
  fi
  if [[ -d "$DIR/.git" ]]; then
    run_step "Downloading the latest version" git -C "$DIR" pull --ff-only || fail "Could not update the code (local changes in $DIR?)."
  fi
  start_stack
  say "Updated. $(git -C "$DIR" log -1 --format='Version: %h, %cd' --date=short 2>/dev/null || true)"
}

cmd_status() {
  local file
  file=$(mktemp)
  {
    addresses
    echo
    if compose exec -T api wget -qO- http://127.0.0.1:4000/health >/dev/null 2>&1; then echo "Server: healthy"; else echo "Server: NOT answering"; fi
    echo
    compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' 2>&1
    echo
    git -C "$DIR" log -1 --format='Version: %h (%cd)' --date=short 2>/dev/null || true
    echo "Backups: $(compose exec -T backup sh -c 'ls -1 /backups/*.dump 2>/dev/null | wc -l' 2>/dev/null | tr -d '\r' || echo '?') kept"
  } >"$file"
  show_text "Status" "$file"
  rm -f "$file"
}

cmd_logs() {
  local file
  file=$(mktemp)
  compose logs --no-color --tail 150 api proxy >"$file" 2>&1 || true
  show_text "Logs (api, proxy)" "$file"
  rm -f "$file"
}

cmd_backup() {
  run_step "Backing up the database and uploaded files" compose exec -T backup sh /deploy/backup.sh || fail "The backup failed."
  say "Backed up into the 'backups' Docker volume. Copy it off this server regularly; see Backups in $DIR/README.md for restoring."
}

cmd_restart() {
  start_stack
  say "Restarted."
}

cmd_stop() {
  confirm "Stop the platform? Nobody can use it until it is started again." no || return 0
  run_step "Stopping" compose stop || fail "Could not stop."
  say "Stopped. Start again with: sudo $DIR/setup.sh restart"
}

cmd_uninstall() {
  confirm "Remove the platform's containers from this server?" no || return 0
  if confirm "Also DELETE ALL DATA (database, uploaded files, backups, certificates)? This cannot be undone." no; then
    local typed
    ask typed "Type DELETE to confirm:" ""
    [[ "$typed" == DELETE ]] || { say "Nothing was deleted."; return 0; }
    run_step "Removing containers and data" compose down -v --remove-orphans || fail "Could not remove."
    say "Removed, with all data. The code and settings are still in $DIR."
  else
    run_step "Removing containers" compose down --remove-orphans || fail "Could not remove."
    say "Removed. Data stays in Docker volumes; run the setup again to start it."
  fi
}

menu() {
  local action
  while :; do
    choose action "OVL For Business is installed in $DIR. What would you like to do?" status \
      status "Status and addresses" \
      update "Update to the latest version" \
      settings "Change settings" \
      backup "Back up now" \
      logs "Show logs" \
      restart "Restart" \
      stop "Stop" \
      uninstall "Uninstall" \
      quit "Quit"
    case "$action" in
      status) cmd_status ;;
      update) cmd_update ;;
      settings) ask_settings && review_settings && write_settings && open_firewall && start_stack && finish_install ;;
      backup) cmd_backup ;;
      logs) cmd_logs ;;
      restart) cmd_restart ;;
      stop) cmd_stop ;;
      uninstall) cmd_uninstall ;;
      *) return 0 ;;
    esac
  done
}

main() {
  detect_system
  if [[ -n "$IS_WSL" ]]; then log "running under WSL"; fi
  [[ "$(uname -s)" == Linux || "$OS_ID" == macos ]] || { echo "This setup runs on Linux (or macOS). On Windows, use WSL 2." >&2; exit 1; }
  need_root
  ensure_dialog_tool
  pick_ui
  log "setup on $OS_NAME ($PKG), interface: $UI"
  if [[ -z "$YES" && "$UI" == plain && -z "$TTY" ]]; then
    echo "No terminal to ask questions in. Run it in a terminal, or unattended with --yes (see --help)." >&2
    exit 2
  fi
  locate_dir
  local installed=""
  is_checkout "$DIR" && [[ -f "$ENV_FILE" ]] && installed=1
  case "${COMMAND:-}" in
    "") if [[ -n "$installed" && -z "$YES" ]]; then menu; else cmd_install; fi ;;
    install) cmd_install ;;
    *)
      [[ -n "$installed" ]] || fail "OVL For Business is not installed in $DIR (use --dir, or run the setup without a command)."
      "cmd_$COMMAND"
      ;;
  esac
}

main
