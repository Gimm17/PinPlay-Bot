// test-personalities.js - smoke test for the personality registry.
// Run: node test-personalities.js
//
// Pins the `general` contract. general is the neutral assistant AND the target
// of every classifier failure, so it must:
//   - have no character name (displayName: null);
//   - never render "null" anywhere a user sees it;
//   - keep working as a fallback for unknown personality keys.
// Also guards the 12 roleplay personalities against accidental removal.

require("dotenv").config();

const assert = require("assert");
const {
  PERSONALITIES,
  VALID,
  getPersonality,
  getPersonalitySystemPrompt,
  getPersonalityLabel,
  getPersonalityChoice,
} = require("./src/utils/personalities");

let passed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ok: ${name}`);
  } else {
    console.error(`  FAIL: ${name}${extra ? " :: " + JSON.stringify(extra) : ""}`);
    process.exitCode = 1;
  }
}

console.log("=== Personality registry test ===\n");

// --- registry shape ---
check("13 personalities registered", VALID.length === 13, { count: VALID.length });
check("general is registered", VALID.includes("general"));

for (const key of VALID) {
  const p = PERSONALITIES[key];
  check(`${key}: has emoji + vibe + prompt`,
    Boolean(p.emoji && p.vibe && typeof p.systemPrompt === "string" && p.systemPrompt.length > 50),
    { key });
}

// --- general has no character name ---
check("general has no displayName", PERSONALITIES.general.displayName === null);
check("roleplay personalities keep their names",
  PERSONALITIES["roast-galau"].displayName === "Savage Galau" &&
  PERSONALITIES.puisi.displayName === "Penyair Kali");

// --- the neutral prompt must not be a roleplay bit ---
{
  const prompt = PERSONALITIES.general.systemPrompt;
  check("general prompt says it is an assistant", /asisten AI serbaguna/i.test(prompt));
  check("general prompt accepts factual questions", /informasi|penjelasan|hitungan/i.test(prompt));
  check("general prompt allows both joking and serious", /becanda/i.test(prompt) && /serius/i.test(prompt));
  check("general prompt forbids inventing facts", /ngarang fakta/i.test(prompt));
}

// --- labels never leak "null" ---
for (const key of VALID) {
  const label = getPersonalityLabel(key);
  const choice = getPersonalityChoice(key);
  check(`${key}: label is non-empty and not "null"`,
    typeof label === "string" && label.length > 0 && !/null|undefined/i.test(label), { label });
  check(`${key}: choice is non-empty and not "null"`,
    typeof choice === "string" && !/null|undefined/i.test(choice), { choice });
}

check("general label is the neutral 'AI'", getPersonalityLabel("general") === "AI");
check("general choice reads as a generic assistant",
  getPersonalityChoice("general") === "🤖 AI (asisten serbaguna)");

// --- fallback behaviour ---
check("unknown key falls back to general object", getPersonality("ngawur") === PERSONALITIES.general);
check("unknown key label does not throw", getPersonalityLabel("ngawur") === "AI");
check("null/undefined key falls back", getPersonality(null) === PERSONALITIES.general);
check("system prompt resolves for unknown key",
  getPersonalitySystemPrompt("ngawur") === PERSONALITIES.general.systemPrompt);

// --- no leaked CJK from copy-paste ---
{
  const all = JSON.stringify(PERSONALITIES);
  check("no CJK characters left in any prompt", !/[一-鿿]/.test(all));
}

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}`);
