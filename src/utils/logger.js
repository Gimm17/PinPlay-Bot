const logBuffer = require("./logBuffer");

const LEVELS = ["debug", "info", "warn", "error"];
function makeLogger(level = "info") {
  const idx = LEVELS.indexOf(level);
  const can = (l) => LEVELS.indexOf(l) >= idx;

  // Each line goes to stdout (PM2 captures it to a file) AND into the
  // in-memory ring buffer that the dashboard reads. The buffer redacts on the
  // way in, so a secret never sits in memory waiting to be served over HTTP.
  return {
    debug: (...a) => {
      if (!can("debug")) return;
      console.log("[DEBUG]", ...a);
      logBuffer.push("debug", a);
    },
    info: (...a) => {
      if (!can("info")) return;
      console.log("[INFO ]", ...a);
      logBuffer.push("info", a);
    },
    warn: (...a) => {
      if (!can("warn")) return;
      console.warn("[WARN ]", ...a);
      logBuffer.push("warn", a);
    },
    error: (...a) => {
      if (!can("error")) return;
      console.error("[ERROR]", ...a);
      logBuffer.push("error", a);
    },
  };
}
module.exports = { makeLogger };
