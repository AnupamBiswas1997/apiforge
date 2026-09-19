#!/usr/bin/env bash
# =============================================================================
# start.sh — APIForge dev server launcher
# =============================================================================
# Starts the Express backend and Vite dev server concurrently.
# Traps SIGINT (Ctrl+C) to cleanly terminate both processes.
# Usage: chmod +x start.sh && ./start.sh
# =============================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Verify setup has been run ─────────────────────────────────────────────────
if [ ! -d "server/node_modules" ]; then
  echo -e "${YELLOW}Server dependencies not installed. Run ./setup.sh first.${RESET}"
  exit 1
fi

if [ ! -d "client/node_modules" ]; then
  echo -e "${YELLOW}Client dependencies not installed. Run ./setup.sh first.${RESET}"
  exit 1
fi

# ── Read port from .env (default 3001) ───────────────────────────────────────
BACKEND_PORT=3001
if [ -f ".env" ]; then
  ENV_PORT=$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d ' ')
  if [ -n "$ENV_PORT" ]; then
    BACKEND_PORT="$ENV_PORT"
  fi
fi

echo ""
echo -e "${CYAN}${BOLD}Starting APIForge...${RESET}"
echo -e "  Backend → http://localhost:${BACKEND_PORT}"
echo -e "  Frontend → http://localhost:3000"
echo -e "  Press ${BOLD}Ctrl+C${RESET} to stop both processes."
echo ""

# ── Process tracking ─────────────────────────────────────────────────────────
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down APIForge...${RESET}"
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID"
  fi
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID"
  fi
  echo -e "${GREEN}Stopped. Goodbye!${RESET}"
  exit 0
}

# Trap Ctrl+C and termination signals
trap cleanup SIGINT SIGTERM

# ── Start backend ─────────────────────────────────────────────────────────────
cd server
node index.js &
BACKEND_PID=$!
cd ..

echo -e "  ${GREEN}✓ Backend started (PID ${BACKEND_PID})${RESET}"

# Give the backend a moment to bind its port before starting the frontend
sleep 1

# ── Start frontend ────────────────────────────────────────────────────────────
cd client
npm run dev &
FRONTEND_PID=$!
cd ..

echo -e "  ${GREEN}✓ Frontend started (PID ${FRONTEND_PID})${RESET}"
echo ""
echo -e "  ${CYAN}Open:${RESET} ${BOLD}http://localhost:3000${RESET}"
echo ""

# ── Wait for either process to exit ──────────────────────────────────────────
wait $BACKEND_PID $FRONTEND_PID
