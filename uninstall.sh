#!/usr/bin/env bash
#
# Weavr Uninstaller
# https://github.com/openweavr/Openweavr
#
# Usage:
#   curl -fsSL https://openweavr.github.io/Openweavr/uninstall.sh | bash
#

set -e

# ============================================================================
# Configuration
# ============================================================================

INSTALL_DIR="${WEAVR_INSTALL_DIR:-$HOME/.weavr}"
BIN_DIR="${WEAVR_BIN_DIR:-$HOME/.local/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ============================================================================
# Helper Functions
# ============================================================================

info() {
  printf "${BLUE}info${NC}  %s\n" "$1"
}

success() {
  printf "${GREEN}✓${NC}     %s\n" "$1"
}

warn() {
  printf "${YELLOW}warn${NC}  %s\n" "$1"
}

error() {
  printf "${RED}error${NC} %s\n" "$1" >&2
}

# ============================================================================
# Main
# ============================================================================

main() {
  local keep_config=false

  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
      --keep-config)
        keep_config=true
        shift
        ;;
      --help|-h)
        echo "Weavr Uninstaller"
        echo ""
        echo "Usage: curl -fsSL https://openweavr.github.io/Openweavr/uninstall.sh | bash"
        echo ""
        echo "Options:"
        echo "  --keep-config    Keep ~/.weavr/config.yaml and workflows"
        echo "  --help           Show this help message"
        exit 0
        ;;
      *)
        warn "Unknown option: $1"
        shift
        ;;
    esac
  done

  printf "\n"
  printf "${PURPLE}${BOLD}Weavr Uninstaller${NC}\n"
  printf "\n"

  # Remove binary
  if [ -f "$BIN_DIR/weavr" ]; then
    info "Removing weavr command..."
    rm -f "$BIN_DIR/weavr"
    success "Removed $BIN_DIR/weavr"
  else
    info "weavr command not found at $BIN_DIR/weavr"
  fi

  # Remove installation directory
  if [ -d "$INSTALL_DIR" ]; then
    if [ "$keep_config" = true ]; then
      info "Keeping config and workflows, removing installation files..."

      # Save config and workflows
      local tmp_dir
      tmp_dir=$(mktemp -d)

      if [ -f "$INSTALL_DIR/config.yaml" ]; then
        cp "$INSTALL_DIR/config.yaml" "$tmp_dir/"
      fi

      if [ -d "$INSTALL_DIR/workflows" ]; then
        cp -r "$INSTALL_DIR/workflows" "$tmp_dir/"
      fi

      # Remove installation
      rm -rf "$INSTALL_DIR"

      # Restore config and workflows
      mkdir -p "$INSTALL_DIR"
      if [ -f "$tmp_dir/config.yaml" ]; then
        cp "$tmp_dir/config.yaml" "$INSTALL_DIR/"
      fi
      if [ -d "$tmp_dir/workflows" ]; then
        cp -r "$tmp_dir/workflows" "$INSTALL_DIR/"
      fi

      rm -rf "$tmp_dir"
      success "Removed installation files (kept config and workflows)"
    else
      info "Removing installation directory..."
      rm -rf "$INSTALL_DIR"
      success "Removed $INSTALL_DIR"
    fi
  else
    info "Installation directory not found at $INSTALL_DIR"
  fi

  printf "\n"
  printf "${GREEN}${BOLD}Weavr has been uninstalled.${NC}\n"
  printf "\n"

  if [ "$keep_config" = false ]; then
    warn "Your configuration at ~/.weavr/config.yaml was also removed."
    warn "If you had important workflows, check for backups."
  fi

  printf "\n"
  printf "Note: You may want to remove the PATH entry from your shell config.\n"
  printf "Look for lines containing 'WEAVR' in:\n"
  printf "  - ~/.zshrc\n"
  printf "  - ~/.bashrc\n"
  printf "  - ~/.bash_profile\n"
  printf "\n"
}

# Run main function
main "$@"
