const assert = require("assert");

function _userExplicitlyAskedMulti(text) {
  if (!text || typeof text !== "string") return false;
  return (
    /\b(?:\d+|beberapa|banyak)\s*(?:versi|opsi|pilihan|contoh|alternatif)\b/i.test(text) ||
    /\b(?:kasih|buatkan|berikan|minta)\s+(?:\d+|beberapa)\b/i.test(text)
  );
}

function _cleanSingleResponse(text, prompt) {
  if (!text || typeof text !== "string") return text;
  if (_userExplicitlyAskedMulti(prompt)) return text.trim();

  // Pattern matching headings like: "Versi Puitis-Klasik:", "1. Versi Lucu:", "**Versi 1:**"
  const versionSplitRegex = /(?:^|\n+)(?:\*{0,2}(?:Versi|\d+\.\s*Versi)\s+[^:\n]+:\*{0,2})\s*\n*/i;
  if (versionSplitRegex.test(text)) {
    const parts = text.split(versionSplitRegex).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1 && /beberapa\s+versi|pilih\s+sesuai|berikut\s+(?:adalah\s+)?pilihan/i.test(parts[0])) {
      return parts[1];
    }
    if (parts.length > 0) return parts[0];
  }

  let cleaned = text.replace(
    /^(?:Siap,?\s*)?(?:ini\s+)?(?:beberapa\s+versi|ada\s+beberapa\s+pilihan)[^.\n]*[.:]\s*(?:Tinggal\s+pilih\s+sesuai\s+selera:?)?\s*\n*/i,
    ""
  );
  return cleaned.trim();
}

function _ensureMentionInReply(reply, targetUsers) {
  if (!reply || !targetUsers || targetUsers.length === 0) return reply;
  let result = reply;
  for (const user of targetUsers) {
    if (!user.tag) continue;
    if (result.includes(user.tag)) continue;

    // 1. Replace quoted name like "melobi" with tag
    const quoteRegex = new RegExp(`["']${user.name}["']`, "i");
    if (quoteRegex.test(result)) {
      result = result.replace(quoteRegex, `${user.tag}`);
      continue;
    }

    // 2. Replace plain whole word name with tag
    const nameRegex = new RegExp(`\\b${user.name}\\b`, "i");
    if (nameRegex.test(result)) {
      result = result.replace(nameRegex, `${user.tag}`);
      continue;
    }

    // 3. Weave into opening royal/formal/casual greeting if present
    const greetingMatch = result.match(
      /^(Wahai|Duhai|Ya|Salam|Hai|Halo|Kepada|Untuk|Teruntuk)\s+([^,\n.!?]+)([,.!?\n])/i
    );
    if (greetingMatch) {
      result = result.replace(
        greetingMatch[0],
        `${greetingMatch[1]} ${greetingMatch[2]} ${user.tag}${greetingMatch[3]}`
      );
      continue;
    }

    // 4. Natural fallback
    result = `${user.tag}, ${result}`;
  }
  return result;
}

function _detectTargetMentions(prompt, guild) {
  if (!prompt || typeof prompt !== "string") {
    return { targetHints: "", targetUsers: [], mentionedUserIds: [] };
  }

  const mentionedUserIds = new Set();
  const targetUsers = [];

  // 1. Check for Discord user mentions: <@123456789> or <@!123456789>
  const userMentionRegex = /<@!?(\d+)>/g;
  let match;
  while ((match = userMentionRegex.exec(prompt)) !== null) {
    const id = match[1];
    mentionedUserIds.add(id);
    let displayName = null;
    if (guild?.members?.cache) {
      const member = guild.members.cache.get(id);
      if (member) {
        displayName = member.displayName || member.user?.username;
      }
    }
    targetUsers.push({
      name: displayName || "User Discord",
      tag: `<@${id}>`,
      id,
    });
  }

  // 2. Check for @username (not already in <@...>)
  const plainMentionRegex = /(?:^|\s)@([a-zA-Z0-9_.]{2,32})\b/g;
  while ((match = plainMentionRegex.exec(prompt)) !== null) {
    const username = match[1];
    if (username.toLowerCase() === "everyone" || username.toLowerCase() === "here") {
      continue;
    }

    let foundMember = null;
    if (guild?.members?.cache) {
      foundMember = guild.members.cache.find(
        (m) =>
          m.user?.username?.toLowerCase() === username.toLowerCase() ||
          m.displayName?.toLowerCase() === username.toLowerCase()
      );
    }

    if (foundMember) {
      mentionedUserIds.add(foundMember.id);
      targetUsers.push({
        name: foundMember.displayName || foundMember.user?.username || username,
        tag: `<@${foundMember.id}>`,
        id: foundMember.id,
      });
    } else {
      targetUsers.push({
        name: username,
        tag: `@${username}`,
        id: null,
      });
    }
  }

  if (targetUsers.length === 0) {
    return { targetHints: "", targetUsers: [], mentionedUserIds: Array.from(mentionedUserIds) };
  }

  const targetLines = targetUsers
    .map(
      (t) =>
        `- Target: "${t.name}" -> Gunakan tag ${t.tag}. (PENTING: Ini adalah NAMA TARGET PENGGUNA DISCORD, BUKAN kata kerja).`
    )
    .join("\n");

  const targetHints =
    `\n\n--- KONTEKS TARGET MENTION DISCORD ---\n` +
    `Prompt user secara spesifik ditujukan untuk pengguna Discord berikut:\n${targetLines}\n` +
    `ATURAN WAJIB:\n` +
    `1. Hasil generate HARUS menyebutkan dan MENGETAG target menggunakan format ${targetUsers.map((t) => t.tag).join(" / ")}.\n` +
    `2. DILARANG menggunakan template statis/kaku (jangan kaku selalu di paling depan atau belakang). Tempatkan tag secara luwes, variatif, dan mengalir alami di dalam kalimat/paragraf.\n`;

  return { targetHints, targetUsers, mentionedUserIds: Array.from(mentionedUserIds) };
}

// === TESTS ===
console.log("=== Running Mention & Single Response Tests ===\n");

// Test 1: Image #1 case
const prompt1 = 'buatin pujian ala kerajaan buat "melobi" sang Ratu biar dapet owocash';
const sample1 = `Siap, ini beberapa versi pujian ala kerajaan buat "melobi" sang Ratu. Tinggal pilih sesuai selera:

Versi Puitis-Klasik:
Ya Baginda Maha Ratu, cahaya yang menerangi tujuh penjuru server, suara Baginda bagai gemericik air di padang tandus.

Versi Dramatis-Lebay:
Oh, Baginda Maha Ratu! Ratu segala Ratu!`;

const detected1 = _detectTargetMentions("buatin pujian buat @melobi sang Ratu", null);
assert.strictEqual(detected1.targetUsers.length, 1);
assert.strictEqual(detected1.targetUsers[0].tag, "@melobi");

const cleaned1 = _cleanSingleResponse(sample1, prompt1);
const final1 = _ensureMentionInReply(cleaned1, [{ name: "melobi", tag: "<@999888>" }]);
console.log("Test 1 Result:\n" + final1);
assert(final1.includes("<@999888>"));
assert(!final1.includes("Versi"));

// Test 2: User explicitly requested multiple options
const prompt2 = "kasih gue 3 opsi kata-kata gombalan";
const sample2 = `Berikut 3 opsi gombalan:
1. Versi Manis: Kamu kayak gula...
2. Versi Lucu: Kamu kayak wifi...
3. Versi Gombal: Matahari kalah terang...`;
const cleaned2 = _cleanSingleResponse(sample2, prompt2);
assert.strictEqual(cleaned2, sample2.trim(), "Must preserve all options when explicitly requested");
console.log("\nTest 2 Passed: Preserves options when user explicitly requests multiple options.");

// Test 3: Mention @everyone is ignored for security
const detected3 = _detectTargetMentions("buatin kata-kata buat @everyone dan @here", null);
assert.strictEqual(detected3.targetUsers.length, 0, "@everyone and @here must never be detected as target users");
console.log("Test 3 Passed: @everyone and @here safely blocked.");

// Test 4: Guild member resolution
const fakeGuild = {
  members: {
    cache: new Map([
      ["12345", { id: "12345", displayName: "Ratu Melobi", user: { username: "melobi" } }]
    ])
  }
};
// Add find and get methods to fakeGuild.members.cache to mirror Collection
fakeGuild.members.cache.find = function(fn) {
  for (const m of this.values()) {
    if (fn(m)) return m;
  }
  return null;
};
const detected4 = _detectTargetMentions("buatin pujian buat @melobi sang Ratu", fakeGuild);
assert.strictEqual(detected4.targetUsers[0].tag, "<@12345>", "Resolves @melobi to member ID tag <@12345>");
console.log("Test 4 Passed: Guild member resolution to <@id> works.");

console.log("\nAll tests passed!");
