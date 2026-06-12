const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

// ─── Paths ──────────────────────────────────────────────
const BOT_DIR = __dirname;
const LAVALINK_DIR = path.resolve(__dirname, "..", "PinPlay-Lavalink");
const LAVALINK_JAR = path.join(LAVALINK_DIR, "Lavalink.jar");
const PORT = 3500;

// ─── State ──────────────────────────────────────────────
let lavalinkProc = null;
let botProc = null;
let lavalinkStatus = "stopped"; // stopped | starting | running | error
let botStatus = "stopped";
const logs = { lavalink: [], bot: [] };
const MAX_LOGS = 500;
const sseClients = new Set();

// ─── SSE Broadcast ──────────────────────────────────────
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

function addLog(source, text) {
  const entry = { source, text: text.toString().trimEnd(), time: Date.now() };
  logs[source].push(entry);
  if (logs[source].length > MAX_LOGS) logs[source].shift();
  broadcast("log", entry);
}

function broadcastStatus() {
  broadcast("status", {
    lavalink: lavalinkStatus,
    bot: botStatus,
  });
}

// ─── Process Management ─────────────────────────────────
function startLavalink() {
  if (lavalinkProc) return { ok: false, msg: "Lavalink already running" };
  if (!fs.existsSync(LAVALINK_JAR)) {
    return { ok: false, msg: `Lavalink.jar not found at: ${LAVALINK_JAR}` };
  }

  lavalinkStatus = "starting";
  broadcastStatus();
  addLog("lavalink", ">>> Starting Lavalink...");

  lavalinkProc = spawn("java", ["-jar", "Lavalink.jar"], {
    cwd: LAVALINK_DIR,
    shell: true,
  });

  lavalinkProc.stdout.on("data", (d) => {
    const text = d.toString();
    addLog("lavalink", text);
    if (text.includes("Lavalink is ready") || text.includes("Started LavalinkApplication")) {
      lavalinkStatus = "running";
      broadcastStatus();
    }
  });

  lavalinkProc.stderr.on("data", (d) => {
    addLog("lavalink", d.toString());
  });

  lavalinkProc.on("close", (code) => {
    addLog("lavalink", `>>> Lavalink exited (code ${code})`);
    lavalinkProc = null;
    lavalinkStatus = code === 0 ? "stopped" : "error";
    broadcastStatus();
  });

  lavalinkProc.on("error", (err) => {
    addLog("lavalink", `>>> Error: ${err.message}`);
    lavalinkProc = null;
    lavalinkStatus = "error";
    broadcastStatus();
  });

  return { ok: true, msg: "Lavalink starting..." };
}

function stopLavalink() {
  if (!lavalinkProc) return { ok: false, msg: "Lavalink not running" };
  addLog("lavalink", ">>> Stopping Lavalink...");
  lavalinkProc.kill("SIGTERM");
  // Force kill after 5s
  setTimeout(() => {
    if (lavalinkProc) {
      lavalinkProc.kill("SIGKILL");
      lavalinkProc = null;
      lavalinkStatus = "stopped";
      broadcastStatus();
    }
  }, 5000);
  return { ok: true, msg: "Stopping..." };
}

function startBot() {
  if (botProc) return { ok: false, msg: "Bot already running" };

  botStatus = "starting";
  broadcastStatus();
  addLog("bot", ">>> Starting PinPlay Bot...");

  botProc = spawn("node", ["src/index.js"], {
    cwd: BOT_DIR,
    shell: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  botProc.stdout.on("data", (d) => {
    const text = d.toString();
    addLog("bot", text);
    if (text.includes("Logged in as")) {
      botStatus = "running";
      broadcastStatus();
    }
  });

  botProc.stderr.on("data", (d) => {
    addLog("bot", d.toString());
  });

  botProc.on("close", (code) => {
    addLog("bot", `>>> Bot exited (code ${code})`);
    botProc = null;
    botStatus = code === 0 ? "stopped" : "error";
    broadcastStatus();
  });

  botProc.on("error", (err) => {
    addLog("bot", `>>> Error: ${err.message}`);
    botProc = null;
    botStatus = "error";
    broadcastStatus();
  });

  return { ok: true, msg: "Bot starting..." };
}

function stopBot() {
  if (!botProc) return { ok: false, msg: "Bot not running" };
  addLog("bot", ">>> Stopping Bot...");
  botProc.kill("SIGTERM");
  setTimeout(() => {
    if (botProc) {
      botProc.kill("SIGKILL");
      botProc = null;
      botStatus = "stopped";
      broadcastStatus();
    }
  }, 3000);
  return { ok: true, msg: "Stopping..." };
}

// ─── HTML GUI ───────────────────────────────────────────
function getHTML() {
  const htmlPath = path.join(__dirname, "launcher", "index.html");
  if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, "utf8");
  return "<h1>launcher/index.html not found</h1>";
}

// ─── HTTP Server ────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");

  // SSE endpoint
  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: status\ndata: ${JSON.stringify({ lavalink: lavalinkStatus, bot: botStatus })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // API endpoints
  if (url.pathname === "/api/start-lavalink") {
    const r = startLavalink();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(r));
  }
  if (url.pathname === "/api/stop-lavalink") {
    const r = stopLavalink();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(r));
  }
  if (url.pathname === "/api/start-bot") {
    const r = startBot();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(r));
  }
  if (url.pathname === "/api/stop-bot") {
    const r = stopBot();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(r));
  }
  if (url.pathname === "/api/start-all") {
    const r1 = startLavalink();
    // Delay bot start to give Lavalink time to initialize
    setTimeout(() => {
      const r2 = startBot();
      broadcast("toast", { msg: r2.msg });
    }, 8000);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, msg: "Starting all... (Bot will start in 8s after Lavalink)" }));
  }
  if (url.pathname === "/api/stop-all") {
    const r1 = stopBot();
    setTimeout(() => stopLavalink(), 2000);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, msg: "Stopping all..." }));
  }
  if (url.pathname === "/api/logs") {
    const source = url.searchParams.get("source") || "bot";
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(logs[source] || []));
  }

  // Serve HTML
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(getHTML());
});

server.listen(PORT, () => {
  console.log(`\n  🎮 PinPlay Launcher running at: http://localhost:${PORT}\n`);
  // Auto-open browser
  const start = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${start} http://localhost:${PORT}`);
});

// Cleanup on exit
process.on("SIGINT", () => {
  if (botProc) botProc.kill();
  if (lavalinkProc) lavalinkProc.kill();
  process.exit(0);
});
process.on("SIGTERM", () => {
  if (botProc) botProc.kill();
  if (lavalinkProc) lavalinkProc.kill();
  process.exit(0);
});
