#!/usr/bin/env bash
# =============================================================================
# setup.sh — APIForge project setup script
# =============================================================================
# Run this once after cloning the repo to install dependencies and configure
# the environment. Requires Node.js >= 18 and npm.
# Usage: chmod +x setup.sh && ./setup.sh
# =============================================================================

set -e

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

print_step() { echo -e "\n${CYAN}${BOLD}▶ $1${RESET}"; }
print_ok()   { echo -e "  ${GREEN}✓ $1${RESET}"; }
print_warn() { echo -e "  ${YELLOW}⚠ $1${RESET}"; }
print_err()  { echo -e "  ${RED}✗ $1${RESET}"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        APIForge — Setup Script             ║${RESET}"
echo -e "${BOLD}║   AI-Powered API Testing Suite            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── Step 1: Check Node.js version ────────────────────────────────────────────
print_step "Checking prerequisites"

if ! command -v node &>/dev/null; then
  print_err "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  print_err "Node.js 18+ required. Found: $(node --version)"
  print_err "Please upgrade: https://nodejs.org"
  exit 1
fi
print_ok "Node.js $(node --version) ✓"

if ! command -v npm &>/dev/null; then
  print_err "npm is not installed. It should come with Node.js."
  exit 1
fi
print_ok "npm $(npm --version) ✓"

# ── Step 2: Set up .env ───────────────────────────────────────────────────────
print_step "Configuring environment"

if [ -f ".env" ]; then
  print_warn ".env already exists — skipping copy"
else
  cp .env.example .env
  print_ok "Created .env from .env.example"
fi

echo ""
echo -e "  ${YELLOW}Configure your LLM provider in .env:${RESET}"
echo -e "  ┌─────────────────┬──────────────────────────────┐"
echo -e "  │ Provider        │ Env Variable Needed          │"
echo -e "  ├─────────────────┼──────────────────────────────┤"
echo -e "  │ anthropic       │ ANTHROPIC_API_KEY            │"
echo -e "  │ openai          │ OPENAI_API_KEY               │"
echo -e "  │ gemini          │ GEMINI_API_KEY               │"
echo -e "  │ mistral         │ MISTRAL_API_KEY              │"
echo -e "  │ ollama (local)  │ No key needed — just run     │"
echo -e "  │                 │ ollama serve                  │"
echo -e "  └─────────────────┴──────────────────────────────┘"
echo ""
echo -e "  ${CYAN}Tip:${RESET} You can also connect via the /connect page in the browser"
echo -e "  ${CYAN}     without touching .env at all.${RESET}"
echo ""

# ── Step 3: Install server dependencies ──────────────────────────────────────
print_step "Installing server dependencies"
cd server
npm install
cd ..
print_ok "Server dependencies installed"

# ── Step 4: Install client dependencies ──────────────────────────────────────
print_step "Installing client dependencies"
cd client
npm install
cd ..
print_ok "Client dependencies installed"

# ── Step 5: Create data directory ────────────────────────────────────────────
print_step "Setting up data directory"

mkdir -p data/runs
print_ok "Created data/runs/"

# Copy demo seed if it doesn't already exist in data/runs
if [ ! -f "data/runs/demo.json" ]; then
  if [ -f "data/demo.json" ]; then
    cp data/demo.json data/runs/demo.json
    print_ok "Seeded demo run"
  else
    print_warn "demo.json not found — skipping seed"
  fi
else
  print_ok "demo.json already present"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║          Setup complete! 🚀               ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Next steps:"
echo -e "  ${CYAN}1.${RESET} Open ${BOLD}.env${RESET} and set your LLM provider + API key"
echo -e "     ${YELLOW}(or skip and use the /connect page in the browser)${RESET}"
echo -e "  ${CYAN}2.${RESET} Start the app:  ${BOLD}chmod +x start.sh && ./start.sh${RESET}"
echo -e "  ${CYAN}3.${RESET} Open browser:   ${BOLD}http://localhost:3000${RESET}"
echo ""
