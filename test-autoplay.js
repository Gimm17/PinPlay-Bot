// test-autoplay.js - manual smoke test for autoplay feature
// Run: node test-autoplay.js
// Requires: bot .env configured, Lavalink running, Spotify creds set (optional)

require('dotenv').config();
const { config } = require('./src/config');

console.log('=== Autoplay Smoke Test ===\n');
console.log('Config check:');
console.log('  - Spotify:', Boolean(config.spotify?.clientId && config.spotify?.clientSecret));
console.log('  - Tokenrouter:', Boolean(config.tokenrouter?.apiKey));
console.log('  - Lavalink:', `${config.lavalink.host}:${config.lavalink.port}`);
console.log('');

const { fetchRelated, getAutoplayOn, setAutoplayOn, resetCooldown, _cooldownMap } = require('./src/utils/autoplay');

// Test 1: State helpers
console.log('Test 1: State helpers');
const TEST_GUILD = 'test-autoplay-' + Date.now();
console.log('  getAutoplayOn(new guild):', getAutoplayOn(TEST_GUILD), '(expected: false)');
setAutoplayOn(TEST_GUILD, true);
console.log('  getAutoplayOn after setOn:', getAutoplayOn(TEST_GUILD), '(expected: true)');
setAutoplayOn(TEST_GUILD, false);
console.log('  getAutoplayOn after setOff:', getAutoplayOn(TEST_GUILD), '(expected: false)');

// Test 2: Cooldown logic
console.log('\nTest 2: Cooldown');
setAutoplayOn(TEST_GUILD, true);
const mockPlayer = {
  guildId: TEST_GUILD,
  queue: { add: t => console.log('  [MOCK QUEUE ADD]', t?.title || 'no title') },
  textChannel: null,
};
const mockTrack = { title: 'Test Track', author: 'Test Artist', sourceName: 'spotify', uri: 'spotify:track:abc' };

// This will fail (no real fetch impl) and set cooldown
fetchRelated(mockPlayer, mockTrack).then(result => {
  console.log('  fetchRelated result:', result, '(expected: null when both fail)');
  console.log('  Cooldown active:', _cooldownMap.has(TEST_GUILD), '(expected: true)');

  // Test 3: Second call within cooldown
  return fetchRelated(mockPlayer, mockTrack);
}).then(() => {
  console.log('\n=== Tests done. Check logs for fetch behavior. ===');
  console.log('For full integration test: start bot, run /autoplay on, play a track, observe logs.');
}).catch(err => {
  console.error('Test error:', err.message);
});
