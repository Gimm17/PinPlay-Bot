function getPlayer(client, guildId) {
  const mgr = client.kazagumo || client.music || client.playerManager;
  if (!mgr || !mgr.players) return null;
  return mgr.players.get(guildId) || null;
}

function getCurrentTrack(player) {
  if (!player) return null;

  // Kazagumo v3: current ada di player.queue.current
  const cur = player?.queue?.current;
  if (cur) return cur;

  // Fallback: beberapa edge case bisa bikin current sementara null.
  // Kalau queue punya item, ambil item pertama sebagai "best effort".
  // (Ini mencegah /queue atau panel bilang kosong saat lagu baru saja ditambahkan.)
  try {
    const q = Array.from(player?.queue || []);
    return q.length ? q[0] : null;
  } catch {
    return null;
  }
}

function getUpcomingTracks(player) {
  // KazagumoQueue extends Array, so Array.from works
  try {
    return Array.from(player?.queue || []);
  } catch {
    return [];
  }
}

module.exports = { getPlayer, getCurrentTrack, getUpcomingTracks };
