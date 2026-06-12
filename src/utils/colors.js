/**
 * Branded embed colors for PinPlay.
 * Use these constants for all EmbedBuilder.setColor() calls.
 */
const Colors = {
  PLAYING:  0x57F287,  // Green  — actively playing music
  PAUSED:   0xFEE75C,  // Yellow — paused state
  QUEUED:   0x5865F2,  // Blurple — something was added to queue
  ERROR:    0xED4245,  // Red    — error / not found
  INFO:     0x5865F2,  // Blurple — informational embeds (help, queue, nowplaying)
  PANEL:    0xEB459E,  // Pink   — music panel embed
  SUCCESS:  0x57F287,  // Green  — action succeeded
  WARNING:  0xFEE75C,  // Yellow — warning messages
  IDLE:     0x95A5A6,  // Gray   — no music playing / idle state
  ROAST:    0xFF4500,  // Orange-Red — AI roast feature
  AI:       0x9B59B6,  // Purple — AI playlist feature
};

module.exports = { Colors };
