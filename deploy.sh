#!/bin/bash
set -e

# ════════════════════════════════════════════════════════════
#  PinPlay — Auto Deploy Script for Ubuntu (Oracle Cloud / AWS)
#  Run: chmod +x deploy.sh && ./deploy.sh
# ════════════════════════════════════════════════════════════

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

BOT_DIR="$HOME/PinPlay"
LAVA_DIR="$HOME/PinPlay-Lavalink"

echo ""
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo -e "${CYAN}  🎵 PinPlay Auto Deploy Script${NC}"
echo -e "${CYAN}════════════════════════════════════════════${NC}"
echo ""

# ── 1. System Update ──
echo -e "${YELLOW}[1/7]${NC} Updating system..."
sudo apt update -y && sudo apt upgrade -y -q

# ── 2. Install Java 17 (for Lavalink) ──
echo ""
echo -e "${YELLOW}[2/7]${NC} Installing Java 17..."
if java -version 2>&1 | grep -q "17"; then
    echo -e "${GREEN}  ✅ Java 17 already installed${NC}"
else
    sudo apt install -y openjdk-17-jre-headless
    echo -e "${GREEN}  ✅ Java 17 installed${NC}"
fi

# ── 3. Install Node.js 20 (for Bot) ──
echo ""
echo -e "${YELLOW}[3/7]${NC} Installing Node.js 20..."
if node -v 2>/dev/null | grep -q "v20\|v22"; then
    echo -e "${GREEN}  ✅ Node.js already installed: $(node -v)${NC}"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    echo -e "${GREEN}  ✅ Node.js $(node -v) installed${NC}"
fi

# ── 4. Install PM2 ──
echo ""
echo -e "${YELLOW}[4/7]${NC} Installing PM2..."
if command -v pm2 &> /dev/null; then
    echo -e "${GREEN}  ✅ PM2 already installed${NC}"
else
    sudo npm install -g pm2
    echo -e "${GREEN}  ✅ PM2 installed${NC}"
fi

# ── 5. Setup Swap (2 GB) ──
echo ""
echo -e "${YELLOW}[5/7]${NC} Setting up swap..."
if swapon --show | grep -q "/swapfile"; then
    echo -e "${GREEN}  ✅ Swap already active${NC}"
else
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
    echo -e "${GREEN}  ✅ 2 GB swap created${NC}"
fi

# ── 6. Firewall ──
# Only SSH is opened. Lavalink's port 2333 is deliberately NOT exposed: the bot
# runs on this same machine and reaches Lavalink over loopback, so there is no
# reason to accept 2333 from the internet. Exposing it (as this script used to)
# let anyone who knew the IP talk to Lavalink directly.
echo ""
echo -e "${YELLOW}[6/7]${NC} Configuring firewall (SSH only)..."
sudo iptables -I INPUT 1 -p tcp --dport 22 -j ACCEPT 2>/dev/null || true
# Prune the old wide-open Lavalink rule if a previous run added it.
# Bounded rather than `while ...; do :; done` — a loop that only exits when
# iptables fails would spin for a long time if sudo is misconfigured.
for _ in 1 2 3 4 5; do
  sudo iptables -D INPUT -p tcp --dport 2333 -j ACCEPT 2>/dev/null || break
done

# Refuse 2333 from anywhere but loopback.
# INSERTED (not appended) and in explicit positions: Oracle's Ubuntu image ends
# its INPUT chain with a catch-all REJECT, so an appended rule would land after
# it and never be evaluated — the guard would silently do nothing. Position 1 =
# allow loopback, position 2 = drop the rest, so the order is deterministic.
sudo iptables -D INPUT -p tcp --dport 2333 -j DROP 2>/dev/null || true
sudo iptables -D INPUT -s 127.0.0.1 -p tcp --dport 2333 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 1 -s 127.0.0.1 -p tcp --dport 2333 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 2 -p tcp --dport 2333 -j DROP 2>/dev/null || true

# Persist iptables (Oracle Ubuntu uses iptables-persistent or netfilter-persistent)
if command -v netfilter-persistent &> /dev/null; then
    sudo netfilter-persistent save 2>/dev/null || true
else
    sudo apt install -y iptables-persistent 2>/dev/null || true
    sudo netfilter-persistent save 2>/dev/null || true
fi
echo -e "${GREEN}  ✅ Firewall configured${NC}"

# ── 7. Install Dependencies & Start ──
echo ""
echo -e "${YELLOW}[7/7]${NC} Installing bot dependencies & starting services..."

# Bot dependencies
cd "$BOT_DIR"
npm install --production
echo -e "${GREEN}  ✅ Bot dependencies installed${NC}"

# Check .env exists
if [ ! -f "$BOT_DIR/.env" ]; then
    echo -e "${RED}  ⚠️  .env file not found! Create it:${NC}"
    echo -e "${RED}     nano $BOT_DIR/.env${NC}"
    echo -e "${RED}     Then add: DISCORD_TOKEN=your_token_here${NC}"
    echo -e "${RED}     And re-run this script${NC}"
    exit 1
fi

# Check Lavalink exists
if [ ! -f "$LAVA_DIR/Lavalink.jar" ]; then
    echo -e "${RED}  ⚠️  Lavalink.jar not found at $LAVA_DIR/Lavalink.jar${NC}"
    echo -e "${RED}     Upload PinPlay-Lavalink folder to ~/PinPlay-Lavalink${NC}"
    exit 1
fi

# ── Stop existing processes ──
pm2 delete lavalink 2>/dev/null || true
pm2 delete pinplay 2>/dev/null || true

# ── Start Lavalink ──
echo ""
echo -e "${CYAN}  Starting Lavalink...${NC}"

# Lavalink's application.yml reads its password and Spotify credentials from the
# environment (${LAVALINK_PASSWORD}, ${SPOTIFY_CLIENT_ID}, ${SPOTIFY_CLIENT_SECRET})
# so secrets never live in the versioned config. Those variables must therefore
# be in the environment of the LAVALINK process — the bot's .env is the single
# source of truth on this box, so export the ones Lavalink needs before handing
# it to pm2.
#
# Values are extracted with grep rather than `source`d: sourcing executes the
# file as shell, so a stray `$(...)` or backtick in any value would run.
read_env() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" "$file" | tail -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

for key in LAVALINK_PASSWORD SPOTIFY_CLIENT_ID SPOTIFY_CLIENT_SECRET SPOTIFY_SP_DC; do
  val="$(read_env "$key" "$BOT_DIR/.env")"
  if [ -n "$val" ]; then
    export "$key=$val"
  fi
done

if [ -z "$LAVALINK_PASSWORD" ]; then
  echo -e "${RED}  ⚠️  LAVALINK_PASSWORD is empty in $BOT_DIR/.env${NC}"
  echo -e "${RED}     Lavalink will refuse to start without it.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✅ Lavalink environment loaded from .env${NC}"

pm2 start "java -jar Lavalink.jar" --name lavalink --cwd "$LAVA_DIR"

# Wait for Lavalink to actually accept connections.
# A fixed `sleep 10` was not enough — measured startup is ~33-40s on a cold JVM
# (plugin loading dominates), so the bot was starting against a dead node.
echo -e "${CYAN}  Waiting for Lavalink to become ready (up to 90s)...${NC}"
LAVA_READY=0
for i in $(seq 1 45); do
  if curl -fsS -o /dev/null -H "Authorization: ${LAVALINK_PASSWORD}" \
       "http://127.0.0.1:2333/v4/info" 2>/dev/null; then
    LAVA_READY=1
    echo -e "${GREEN}  ✅ Lavalink ready after ~$((i*2))s${NC}"
    break
  fi
  sleep 2
done

if [ "$LAVA_READY" -ne 1 ]; then
  echo -e "${RED}  ⚠️  Lavalink did not become ready in 90s. Last log lines:${NC}"
  pm2 logs lavalink --lines 20 --nostream 2>/dev/null || true
  echo -e "${YELLOW}  Continuing anyway — the bot retries the connection.${NC}"
fi

# ── Start Bot ──
echo -e "${CYAN}  Starting PinPlay Bot...${NC}"
pm2 start src/index.js --name pinplay --cwd "$BOT_DIR"

# ── Auto-start on reboot ──
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true
pm2 save

echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ PinPlay deployed successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Commands:${NC}"
echo -e "    pm2 status           — Check status"
echo -e "    pm2 logs             — View all logs"
echo -e "    pm2 logs pinplay     — Bot logs only"
echo -e "    pm2 logs lavalink    — Lavalink logs only"
echo -e "    pm2 restart all      — Restart everything"
echo -e "    pm2 monit            — Monitor resources"
echo ""
echo -e "  ${YELLOW}Bot will auto-restart on server reboot!${NC}"
echo ""
