/**
 * Branded embed colors for PinPlay.
 * Palette: Primary #A5D6F1 (soft blue) + Secondary #EFAAB9 (soft pink).
 * Use these constants for all EmbedBuilder.setColor() calls.
 */
const Colors = {
  PLAYING:  0xEFAAB9,  // Secondary soft pink — actively playing music (NOW PLAYING)
  PAUSED:   0xB8C4CE,  // Soft gray-blue — paused state
  QUEUED:   0xA5D6F1,  // Primary soft blue — something was added to queue
  ERROR:    0xE06B7A,  // Rose red — error / not found
  INFO:     0xA5D6F1,  // Primary — informational embeds (help, queue, nowplaying)
  PANEL:    0xA5D6F1,  // Primary — music panel embed
  SUCCESS:  0xA5D6F1,  // Primary — action succeeded
  WARNING:  0xEFAAB9,  // Secondary — warning messages
  IDLE:     0xB8C4CE,  // Soft gray-blue — no music playing / idle state
  ROAST:    0xEFAAB9,  // Secondary soft pink — AI roast feature
  AI:       0xA5D6F1,  // Primary — AI playlist feature
  CHAT:     0xC9A6E0,  // Soft purple — AI chat feature
};

module.exports = { Colors };
