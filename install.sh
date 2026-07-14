#!/bin/sh
set -eu

PACKAGE_NAME="vitalmcp"
DEFAULT_VERSION="0.4.0"
VERSION="${VITALMCP_VERSION:-$DEFAULT_VERSION}"
PREFIX="${VITALMCP_INSTALL_PREFIX:-$HOME/.vitalmcp/npm-global}"
BIN_DIR="$PREFIX/bin"
ACTION="install"
MANAGE_PROFILE=1
BEGIN_MARKER="# >>> vitalmcp >>>"
END_MARKER="# <<< vitalmcp <<<"

usage() {
  printf '%s\n' "Usage: install.sh [--version <semver>] [--uninstall] [--no-profile]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      [ "$#" -ge 2 ] || { printf '%s\n' "--version requires a value" >&2; exit 2; }
      VERSION="$2"
      shift 2
      ;;
    --uninstall)
      ACTION="uninstall"
      shift
      ;;
    --no-profile)
      MANAGE_PROFILE=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$VERSION" in
  ''|*[!0-9A-Za-z.+-]*)
    printf 'Invalid vitalmcp version: %s\n' "$VERSION" >&2
    exit 2
    ;;
esac

detect_platform() {
  kernel="$(uname -s 2>/dev/null || printf unknown)"
  case "$kernel" in
    Darwin) printf '%s\n' "macos" ;;
    Linux)
      if [ -n "${WSL_DISTRO_NAME:-}" ] || { [ -r /proc/version ] && grep -qi microsoft /proc/version; }; then
        printf '%s\n' "wsl"
      else
        printf '%s\n' "linux"
      fi
      ;;
    *) printf '%s\n' "unsupported" ;;
  esac
}

select_profile() {
  if [ -n "${VITALMCP_PROFILE:-}" ]; then
    printf '%s\n' "$VITALMCP_PROFILE"
    return
  fi
  shell_name="${SHELL##*/}"
  case "$shell_name" in
    zsh) printf '%s\n' "$HOME/.zshrc" ;;
    bash)
      if [ "$(detect_platform)" = "macos" ]; then
        printf '%s\n' "$HOME/.bash_profile"
      else
        printf '%s\n' "$HOME/.bashrc"
      fi
      ;;
    *) printf '%s\n' "$HOME/.profile" ;;
  esac
}

remove_profile_block() {
  profile="$1"
  [ -f "$profile" ] || return 0
  temporary="$profile.vitalmcp-tmp-$$"
  awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
    $0 == begin && !skipping { skipping = 1; buffered = $0 ORS; next }
    skipping {
      buffered = buffered $0 ORS
      if ($0 == end) { skipping = 0; buffered = "" }
      next
    }
    { print }
    END { if (skipping) printf "%s", buffered }
  ' "$profile" > "$temporary"
  mv "$temporary" "$profile"
}

install_profile_block() {
  profile="$1"
  profile_dir="${profile%/*}"
  [ "$profile_dir" = "$profile" ] || mkdir -p "$profile_dir"
  [ -f "$profile" ] || : > "$profile"
  remove_profile_block "$profile"
  if grep -Fqx "$BEGIN_MARKER" "$profile" || grep -Fqx "$END_MARKER" "$profile"; then
    printf 'Incomplete Vital Agent Sync PATH block in %s; repair the marked lines and rerun.\n' "$profile" >&2
    return 1
  fi
  {
    if [ -s "$profile" ]; then
      printf '\n'
    fi
    printf '%s\n' "$BEGIN_MARKER"
    printf 'export PATH="%s/bin:$PATH"\n' "$PREFIX"
    printf '%s\n' "$END_MARKER"
  } >> "$profile"
}

platform="$(detect_platform)"
if [ "$platform" = "unsupported" ]; then
  printf '%s\n' "Vital Agent Sync installer currently supports macOS, Linux, and WSL." >&2
  exit 1
fi

profile="$(select_profile)"

if [ "$ACTION" = "uninstall" ]; then
  if command -v npm >/dev/null 2>&1; then
    npm uninstall --global --prefix "$PREFIX" "$PACKAGE_NAME" >/dev/null 2>&1 || true
  fi
  if [ "$MANAGE_PROFILE" -eq 1 ]; then
    remove_profile_block "$profile"
  fi
  printf '%s\n' "Removed the Vital Agent Sync CLI and installer-owned PATH entry."
  printf '%s\n' "Local data under $HOME/.healthlink was preserved."
  exit 0
fi

command -v node >/dev/null 2>&1 || {
  printf '%s\n' "Node.js 22 or newer is required. Install Node.js, then rerun this installer." >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  printf '%s\n' "npm is required. Install npm with Node.js, then rerun this installer." >&2
  exit 1
}

node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf 0)"
case "$node_major" in
  ''|*[!0-9]*) node_major=0 ;;
esac
if [ "$node_major" -lt 22 ]; then
  printf 'Node.js 22 or newer is required; found major version %s.\n' "$node_major" >&2
  exit 1
fi

mkdir -p "$PREFIX"
npm install --global --prefix "$PREFIX" "$PACKAGE_NAME@$VERSION"

if [ "$MANAGE_PROFILE" -eq 1 ]; then
  install_profile_block "$profile"
fi

printf '\n%s\n' "Vital Agent Sync CLI installed."
printf 'Platform: %s\n' "$platform"
printf 'Version:  %s\n' "$VERSION"
printf 'Binary:   %s/vitalmcp\n' "$BIN_DIR"
if [ "$MANAGE_PROFILE" -eq 1 ]; then
  printf 'Profile:  %s\n' "$profile"
fi
printf '\nRun next:\n  %s/vitalmcp setup\n' "$BIN_DIR"
