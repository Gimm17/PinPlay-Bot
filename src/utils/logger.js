const LEVELS = ["debug", "info", "warn", "error"];
function makeLogger(level = "info") {
  const idx = LEVELS.indexOf(level);
  const can = (l) => LEVELS.indexOf(l) >= idx;

  return {
    debug: (...a) => can("debug") && console.log("[DEBUG]", ...a),
    info:  (...a) => can("info")  && console.log("[INFO ]", ...a),
    warn:  (...a) => can("warn")  && console.warn("[WARN ]", ...a),
    error: (...a) => can("error") && console.error("[ERROR]", ...a),
  };
}
module.exports = { makeLogger };
