#!/usr/bin/env bash
#
# Openweavr Installer
# https://openweavr.ai
#
# Usage:
#   curl -fsSL https://openweavr.ai/install.sh | bash
#
# Or with options:
#   curl -fsSL https://openweavr.ai/install.sh | bash -s -- --no-modify-path
#

set -e

# ============================================================================
# Configuration
# ============================================================================

REPO_URL="https://github.com/openweavr/Openweavr.git"
INSTALL_DIR="${WEAVR_INSTALL_DIR:-$HOME/.weavr}"
BIN_DIR="${WEAVR_BIN_DIR:-$HOME/.local/bin}"
MIN_NODE_VERSION=22
BRANCH="${WEAVR_BRANCH:-main}"
TRACK_URL="https://openweavr.ai/api/track-install"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
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

fatal() {
  error "$1"
  exit 1
}

# Print banner
banner() {
  printf "\n"
  printf "${PURPLE}${BOLD}"
  printf "   ___                                         \n"
  printf "  / _ \ _ __   ___ _ ____      _____  __ ___   _ __ \n"
  printf " | | | | '_ \ / _ \ '_ \ \ /\ / / _ \/ _\` \ \ / / '__|\n"
  printf " | |_| | |_) |  __/ | | \ V  V /  __/ (_| |\ V /| |   \n"
  printf "  \___/| .__/ \___|_| |_|\_/\_/ \___|\__,_| \_/ |_|   \n"
  printf "       |_|                                            \n"
  printf "${NC}\n"
  printf "  ${CYAN}Self-hosted workflow automation with AI agents${NC}\n"
  printf "\n"
}

# Detect OS
detect_os() {
  local os=""
  case "$(uname -s)" in
    Linux*)   os="linux" ;;
    Darwin*)  os="macos" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *)        os="unknown" ;;
  esac
  echo "$os"
}

# Detect architecture
detect_arch() {
  local arch=""
  case "$(uname -m)" in
    x86_64|amd64)  arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    armv7l)        arch="arm" ;;
    *)             arch="unknown" ;;
  esac
  echo "$arch"
}

# Track installation (non-blocking, silent failure)
track_install() {
  local os="$1"
  local arch="$2"
  local version="$3"

  # Send tracking ping in background, ignore errors
  (curl -fsSL -X POST "$TRACK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"os\":\"$os\",\"arch\":\"$arch\",\"version\":\"$version\"}" \
    --max-time 5 >/dev/null 2>&1 || true) &
}

# Check if command exists
has_command() {
  command -v "$1" >/dev/null 2>&1
}

# Get Node.js version number
get_node_version() {
  if has_command node; then
    node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1
  else
    echo "0"
  fi
}

# Check if Node.js version is sufficient
check_node_version() {
  local version
  version=$(get_node_version)
  [ "$version" -ge "$MIN_NODE_VERSION" ] 2>/dev/null
}

# Install Node.js
install_node() {
  local os="$1"

  info "Installing Node.js $MIN_NODE_VERSION+..."

  if has_command nvm; then
    info "Using nvm to install Node.js..."
    nvm install "$MIN_NODE_VERSION"
    nvm use "$MIN_NODE_VERSION"
    return
  fi

  if has_command fnm; then
    info "Using fnm to install Node.js..."
    fnm install "$MIN_NODE_VERSION"
    fnm use "$MIN_NODE_VERSION"
    return
  fi

  case "$os" in
    macos)
      if has_command brew; then
        info "Using Homebrew to install Node.js..."
        brew install node@22
        # Link if not already linked
        brew link --overwrite node@22 2>/dev/null || true
      else
        info "Installing Node.js via official installer..."
        install_node_official "$os"
      fi
      ;;
    linux)
      # Try package managers first
      if has_command apt-get; then
        info "Installing Node.js via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
      elif has_command dnf; then
        info "Installing Node.js via NodeSource..."
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
        sudo dnf install -y nodejs
      elif has_command yum; then
        info "Installing Node.js via NodeSource..."
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
        sudo yum install -y nodejs
      elif has_command pacman; then
        info "Installing Node.js via pacman..."
        sudo pacman -Sy nodejs npm
      else
        info "Installing Node.js via official installer..."
        install_node_official "$os"
      fi
      ;;
    *)
      fatal "Automatic Node.js installation not supported on this OS. Please install Node.js $MIN_NODE_VERSION+ manually."
      ;;
  esac
}

# Install Node.js from official binaries
install_node_official() {
  local os="$1"
  local arch
  arch=$(detect_arch)

  local node_os=""
  case "$os" in
    macos)  node_os="darwin" ;;
    linux)  node_os="linux" ;;
  esac

  local node_version="22.13.0"  # Latest LTS at time of writing
  local filename="node-v${node_version}-${node_os}-${arch}"
  local url="https://nodejs.org/dist/v${node_version}/${filename}.tar.xz"

  local tmp_dir
  tmp_dir=$(mktemp -d)

  info "Downloading Node.js v${node_version}..."
  curl -fsSL "$url" -o "${tmp_dir}/node.tar.xz"

  info "Extracting..."
  tar -xJf "${tmp_dir}/node.tar.xz" -C "${tmp_dir}"

  info "Installing to /usr/local..."
  sudo cp -r "${tmp_dir}/${filename}"/* /usr/local/

  rm -rf "$tmp_dir"
}

# Check for Git
check_git() {
  if ! has_command git; then
    fatal "Git is required but not installed. Please install Git first."
  fi
}

# Get shell config file
get_shell_config() {
  local shell_name
  shell_name=$(basename "$SHELL")

  case "$shell_name" in
    zsh)  echo "$HOME/.zshrc" ;;
    bash)
      if [ -f "$HOME/.bash_profile" ]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)    echo "$HOME/.profile" ;;
  esac
}

# Add to PATH in shell config
add_to_path() {
  local shell_config
  shell_config=$(get_shell_config)
  local shell_name
  shell_name=$(basename "$SHELL")

  # Check if already in config
  if grep -q "WEAVR" "$shell_config" 2>/dev/null; then
    info "PATH already configured in $shell_config"
    return 0
  fi

  info "Adding Openweavr to PATH in $shell_config..."

  {
    echo ""
    echo "# Openweavr"
    if [ "$shell_name" = "fish" ]; then
      echo "set -gx PATH \"$BIN_DIR\" \$PATH"
    else
      echo "export PATH=\"$BIN_DIR:\$PATH\""
    fi
  } >> "$shell_config"

  success "Added to PATH in $shell_config"
  return 0
}

# Create wrapper script
create_wrapper() {
  mkdir -p "$BIN_DIR"

  cat > "$BIN_DIR/weavr" << EOF
#!/usr/bin/env bash
# Openweavr CLI wrapper
exec node "$INSTALL_DIR/weavr.mjs" "\$@"
EOF

  chmod +x "$BIN_DIR/weavr"
  success "Created weavr command at $BIN_DIR/weavr"
}

# ============================================================================
# Main Installation
# ============================================================================

main() {
  local modify_path=true
  local track=true

  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-modify-path)
        modify_path=false
        shift
        ;;
      --no-track)
        track=false
        shift
        ;;
      --branch)
        BRANCH="$2"
        shift 2
        ;;
      --help|-h)
        echo "Openweavr Installer"
        echo ""
        echo "Usage: curl -fsSL https://openweavr.ai/install.sh | bash"
        echo ""
        echo "Options:"
        echo "  --no-modify-path    Don't add weavr to PATH"
        echo "  --no-track          Don't send anonymous install analytics"
        echo "  --branch BRANCH     Install from a specific branch (default: main)"
        echo "  --help              Show this help message"
        echo ""
        echo "Environment variables:"
        echo "  WEAVR_INSTALL_DIR   Installation directory (default: ~/.weavr)"
        echo "  WEAVR_BIN_DIR       Binary directory (default: ~/.local/bin)"
        echo "  WEAVR_BRANCH        Git branch to install (default: main)"
        exit 0
        ;;
      *)
        warn "Unknown option: $1"
        shift
        ;;
    esac
  done

  banner

  local os
  os=$(detect_os)
  local arch
  arch=$(detect_arch)

  info "Detected OS: $os ($arch)"

  if [ "$os" = "unknown" ]; then
    fatal "Unsupported operating system"
  fi

  if [ "$os" = "windows" ]; then
    warn "Windows detected. For best results, use WSL (Windows Subsystem for Linux)."
    warn "See: https://docs.microsoft.com/en-us/windows/wsl/install"
  fi

  # Check prerequisites
  info "Checking prerequisites..."
  check_git
  success "Git is installed"

  # Check Node.js
  if check_node_version; then
    success "Node.js $(node --version) is installed"
  else
    local current_version
    current_version=$(get_node_version)
    if [ "$current_version" != "0" ]; then
      warn "Node.js v$current_version found, but v$MIN_NODE_VERSION+ is required"
    fi
    install_node "$os"

    # Re-check
    if ! check_node_version; then
      fatal "Failed to install Node.js $MIN_NODE_VERSION+. Please install it manually."
    fi
    success "Node.js $(node --version) installed"
  fi

  # Clone or update repository
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation..."
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
    success "Updated to latest version"
  else
    if [ -d "$INSTALL_DIR" ]; then
      warn "Directory $INSTALL_DIR exists but is not a git repo"
      warn "Backing up to ${INSTALL_DIR}.backup"
      mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%s)"
    fi

    info "Cloning Openweavr..."
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
    success "Cloned to $INSTALL_DIR"
  fi

  # Install dependencies
  cd "$INSTALL_DIR"
  info "Installing dependencies..."
  npm install --loglevel=error
  success "Dependencies installed"

  # Build
  info "Building Openweavr..."
  npm run build --loglevel=error
  success "Build complete"

  # Create wrapper script
  create_wrapper

  # Add to PATH
  if [ "$modify_path" = true ]; then
    add_to_path
  fi

  # Refresh PATH for current session
  export PATH="$BIN_DIR:$PATH"

  # Print success message
  printf "\n"
  printf "${GREEN}${BOLD}Installation complete!${NC}\n"
  printf "\n"
  printf "  ${CYAN}Installation directory:${NC} $INSTALL_DIR\n"
  printf "  ${CYAN}Binary location:${NC}        $BIN_DIR/weavr\n"
  printf "\n"

  # Verify installation by running weavr
  info "Verifying installation..."
  local version="unknown"
  if "$BIN_DIR/weavr" --version >/dev/null 2>&1; then
    version=$("$BIN_DIR/weavr" --version 2>/dev/null || echo "unknown")
    success "weavr $version is ready!"

    # Track successful installation (anonymous, non-blocking)
    if [ "$track" = true ]; then
      track_install "$os" "$arch" "$version"
    fi
  else
    warn "Installation completed but weavr command verification failed"
    warn "Try running: $BIN_DIR/weavr --version"
  fi

  printf "\n"
  printf "  ${BOLD}Quick start:${NC}\n"
  printf "\n"
  printf "    ${CYAN}weavr serve${NC}              Start the server\n"
  printf "    ${CYAN}weavr onboard${NC}            Configure AI providers\n"
  printf "    ${CYAN}weavr --help${NC}             Show all commands\n"
  printf "\n"
  printf "  Then open ${CYAN}http://localhost:3847${NC} in your browser.\n"
  printf "\n"
  printf "  ${PURPLE}Documentation:${NC} https://openweavr.ai/docs\n"
  printf "\n"

  # Source shell config to make weavr available immediately
  # We do this at the end so the user's current shell session has access
  if [ "$modify_path" = true ]; then
    local shell_config
    shell_config=$(get_shell_config)
    printf "  ${YELLOW}Note:${NC} Run ${BOLD}source $shell_config${NC} or open a new terminal\n"
    printf "        to use 'weavr' command globally.\n"
    printf "\n"
  fi
}

# Run main function
main "$@"
