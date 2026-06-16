# Review & Commit AI Features (Phase A-E) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review 9 file AI baru + 6 file non-phase yang modified, catat bugs di REVIEW_NOTES.md, dan commit per phase (5 phase commits + 1 chore commit).

**Architecture:** Phase-by-phase sequential review. Untuk tiap phase: read files -> cek integrasi & edge cases -> catat bugs -> syntax check -> commit. REVIEW_NOTES.md sebagai single source of truth untuk bugs yang ditemukan.

**Tech Stack:** Node.js 18+, discord.js v14, OpenAI SDK, Git, bash.

---

## File Structure

**Files yang akan di-commit (per phase):**

| Phase | File | Status | Lines |
|-------|------|--------|-------|
| A | `src/utils/ai.js` | modified | ~269 |
| A | `src/utils/personalities.js` | new | ~237 |
| A | `src/utils/aiSettings.js` | new | ~250 |
| A | `src/index.js` | modified | ~103 |
| B | `src/utils/aiMemory.js` | new | ~376 |
| B | `src/utils/aiPromptCache.js` | new | ~105 |
| B | `src/utils/aiProviderFallback.js` | new | ~116 |
| C | `src/commands/aiplaylist.js` | modified | ~452 |
| C | `src/commands/roast.js` | modified | (size unknown, read first) |
| D | `src/utils/aiLimits.js` | new | ~289 |
| D | `src/commands/limit.js` | new | ~122 |
| D | `src/commands/ai-set.js` (partial) | new | ~688 |
| E | `src/commands/chat.js` | new | ~392 |
| E | `src/commands/ai-set.js` (rest) | new | (same as D) |
| F | `src/commands/help.js` | modified | (size unknown) |
| F | `src/commands/helpv2.js` | modified | (size unknown) |
| F | `src/utils/colors.js` | modified | (size unknown) |
| F | `src/handlers/messageHandler.js` | modified | (size unknown) |
| F | `src/config/prefixAliases.js` | modified | (size unknown) |
| F | `.env.example` | modified | ~1.8K |

**Files generated (untracked, NOT committed):**
- `REVIEW_NOTES.md` - bug catalog
- `docs/superpowers/plans/2026-06-16-review-commit-ai-features.md` - this plan

---

## Task 1: Initialize REVIEW_NOTES.md

**Files:**
- Create: `REVIEW_NOTES.md` (untracked)

- [ ] **Step 1: Cek apakah REVIEW_NOTES.md sudah ada**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && ls REVIEW_NOTES.md 2>/dev/null && echo "EXISTS" || echo "NOT_EXISTS"`

Expected: Either "EXISTS" or "NOT_EXISTS"

- [ ] **Step 2: Kalau EXISTS, backup ke REVIEW_NOTES.md.bak**

Run (conditional):
```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
if [ -f REVIEW_NOTES.md ]; then
  cp REVIEW_NOTES.md REVIEW_NOTES.md.bak
  echo "Backed up to REVIEW_NOTES.md.bak"
fi
```

Expected: Either "Backed up..." or no output (kalau file belum ada)

- [ ] **Step 3: Create REVIEW_NOTES.md with header**

Write to `C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay\REVIEW_NOTES.md`:

```markdown
# AI Features Review Notes (Phase A-E)

> Catalog bugs, concerns, dan catatan dari review AI features sebelum commit.
> File ini TIDAK di-commit ke git. Local only.

**Review date:** 2026-06-16
**Reviewer:** Claude (assistant)
**Scope:** Phase A-E (AI client, memory, limits, chat, ai-set)

**Format entry:**
- bug - masalah runtime/logic yang perlu fix nanti
- concern - bukan bug tapi perlu diawasi
- nitpick - cosmetic / style, gak urgent
- info - catatan netral, dokumentasi

---
```

- [ ] **Step 4: Verify file created**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && head -20 REVIEW_NOTES.md`

Expected: Menampilkan header yang baru ditulis

- [ ] **Step 5: Commit step (no-op, REVIEW_NOTES.md is untracked)**

No commit. REVIEW_NOTES.md sengaja tidak di-track.

---

## Task 2: Review Phase A - Base AI Client

**Files:**
- Read: `src/utils/ai.js`
- Read: `src/utils/personalities.js`
- Read: `src/utils/aiSettings.js`
- Read: `src/index.js` (modified sections only)
- Modify: `REVIEW_NOTES.md` (append Phase A section)

- [ ] **Step 1: Read src/utils/ai.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/utils/ai.js`

Expected: ~269 lines. Perhatikan: PROVIDERS, MODELS, _stripThinking, _getClient, callAI, prewarmAll.

- [ ] **Step 2: Read src/utils/personalities.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/utils/personalities.js`

Expected: ~237 lines. Perhatikan: 13 personality definitions, classifier, getPersonalityForSelect (kalau masih ada).

- [ ] **Step 3: Read src/utils/aiSettings.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/utils/aiSettings.js`

Expected: ~250 lines. Perhatikan: getAISettings, saveAISettings, schema keys (model, limit, whitelist, dll).

- [ ] **Step 4: Read modified src/index.js (fokus pada AI changes)**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git diff HEAD -- src/index.js`

Expected: Diff yang menunjukkan prewarmAll() call di clientReady.

- [ ] **Step 5: Cek integrasi file Phase A**

Verify checks (mental atau di catatan):
- `ai.js` exports: `callAI`, `prewarmAll`, `PROVIDERS`, `MODELS`, `MODEL_NAMES`, `getProviderApiKey`, `getAvailableProviders`, `_stripThinking`
- `personalities.js` exports: 13 personality names, `classifyPersonality` (atau equivalent), `getPersonalityByName`
- `aiSettings.js` exports: `getAISettings`, `saveAISettings`, `updateAISettings` (atau equivalent)
- `index.js` require `./utils/ai` untuk `prewarmAll`

Edge cases yang dicek:
- Missing API key di `config.nvidia` atau `config.tokenrouter` -> `_getClient` return null? Throw? Fallback?
- Model name gak ada di MODELS -> behavior?
- AI timeout (90s) -> handled dengan promise.race atau AbortController?
- `_stripThinking` regex -> cover semua variant (think/thinking/reasoning/reflection)?

- [ ] **Step 6: Append Phase A section ke REVIEW_NOTES.md**

Append to `C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay\REVIEW_NOTES.md`:

```markdown

## [Phase A] - 2026-06-16

<!-- Append bug/concern/nitpick/info entries di sini -->
<!-- Contoh:
### bug: <judul>
- **File:** `src/utils/ai.js:42`
- **Issue:** <apa>
- **Impact:** <efek>
- **Suggested fix:** <ide>
-->

---
```

- [ ] **Step 7: Syntax check Phase A files**

Run:
```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
node -c src/utils/ai.js && echo "ai.js OK"
node -c src/utils/personalities.js && echo "personalities.js OK"
node -c src/utils/aiSettings.js && echo "aiSettings.js OK"
node -c src/index.js && echo "index.js OK"
```

Expected: All "OK" messages. No syntax errors.

- [ ] **Step 8: Commit Phase A**

```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
git add src/utils/ai.js src/utils/personalities.js src/utils/aiSettings.js src/index.js
git commit -m "feat(ai): Phase A - base AI client + 13 personalities

- src/utils/ai.js: multi-provider wrapper (NVIDIA + TokenRouter)
- src/utils/personalities.js: 13 personality definitions
- src/utils/aiSettings.js: persistent global AI config
- src/index.js: prewarm AI clients at boot"
```

Expected: Commit created. Hash printed.

- [ ] **Step 9: Verify commit**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git log --oneline -1`

Expected: Latest commit is the Phase A commit with the message above.

---

## Task 3: Review Phase B - Memory + Cache + Fallback

**Files:**
- Read: `src/utils/aiMemory.js`
- Read: `src/utils/aiPromptCache.js`
- Read: `src/utils/aiProviderFallback.js`
- Modify: `REVIEW_NOTES.md` (append Phase B section)

- [ ] **Step 1: Read src/utils/aiMemory.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/utils/aiMemory.js`

Expected: ~376 lines. Perhatikan: per-user memory CRUD, global notes, persistence (JSON file).

- [ ] **Step 2: Read src/utils/aiPromptCache.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/utils/aiPromptCache.js`

Expected: ~105 lines. Perhatikan: cache key generation, TTL, eviction.

- [ ] **Step 3: Read src/utils/aiProviderFallback.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/utils/aiProviderFallback.js`

Expected: ~116 lines. Perhatikan: 5xx detection, fallback chain, retry logic.

- [ ] **Step 4: Cek integrasi Phase B**

Verify checks:
- `aiMemory.js` exports: `getMemory(userId)`, `setMemory(userId, key, value)`, `clearMemory(userId)`, `getGlobalNotes()`, `setGlobalNote(key, value)`
- `aiPromptCache.js` exports: `getCached(prompt)`, `setCache(prompt, response)`, `clearCache()`, `cacheStats()`
- `aiProviderFallback.js` exports: `callWithFallback(prompt, options)` atau wrap `callAI`
- `ai.js` import dari `aiProviderFallback` (kalau ada wrapper)

Edge cases:
- Memory file corrupt / gak ada -> fallback ke empty memory?
- Cache key collision (similar prompts) -> hash-based key?
- Fallback: kalau kedua provider down -> return error atau queue?
- Race condition: 2 concurrent writes ke memory file -> atomic write (write to temp + rename)?

- [ ] **Step 5: Append Phase B section ke REVIEW_NOTES.md**

Append to `C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay\REVIEW_NOTES.md`:

```markdown

## [Phase B] - 2026-06-16

<!-- Append bug/concern/nitpick/info entries di sini -->

---
```

- [ ] **Step 6: Syntax check Phase B files**

Run:
```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
node -c src/utils/aiMemory.js && echo "aiMemory.js OK"
node -c src/utils/aiPromptCache.js && echo "aiPromptCache.js OK"
node -c src/utils/aiProviderFallback.js && echo "aiProviderFallback.js OK"
```

Expected: All "OK" messages.

- [ ] **Step 7: Commit Phase B**

```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
git add src/utils/aiMemory.js src/utils/aiPromptCache.js src/utils/aiProviderFallback.js
git commit -m "feat(ai): Phase B - memory + cache + fallback layer

- src/utils/aiMemory.js: per-user memory + global notes (JSON persistence)
- src/utils/aiPromptCache.js: prompt response cache with TTL
- src/utils/aiProviderFallback.js: auto-fallback to alt provider on 5xx"
```

Expected: Commit created.

- [ ] **Step 8: Verify commit**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git log --oneline -1`

Expected: Latest commit is Phase B.

---

## Task 4: Review Phase C - AI Playlist & Roast Integration

**Files:**
- Read: `src/commands/aiplaylist.js` (modified)
- Read: `src/commands/roast.js` (modified)
- Modify: `REVIEW_NOTES.md` (append Phase C section)

- [ ] **Step 1: Read modified src/commands/aiplaylist.js (diff first)**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git diff HEAD -- src/commands/aiplaylist.js | head -200`

Expected: Diff showing multi-provider integration, prompt template, error handling.

- [ ] **Step 2: Read full src/commands/aiplaylist.js (context)**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/commands/aiplaylist.js | head -150`

Expected: 452 lines total. Perhatikan: data (SlashCommandBuilder), execute function, AI prompt structure.

- [ ] **Step 3: Read modified src/commands/roast.js (diff first)**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git diff HEAD -- src/commands/roast.js | head -200`

Expected: Diff showing multi-provider, now-playing context injection.

- [ ] **Step 4: Read full src/commands/roast.js (context)**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/commands/roast.js`

Expected: Full file. Perhatikan: handle context (no song playing), prompt building, response length.

- [ ] **Step 5: Cek integrasi Phase C**

Verify checks:
- Both commands use `callAI` from `../utils/ai` (or `callWithFallback` from fallback layer)
- `aiplaylist.js`: prompt minta array JSON? Validated sebelum dipakai?
- `roast.js`: ambil current track dari Kazagumo player? Handle kalau gak ada lagu?
- Error handling: kalau AI return invalid -> user-facing error yang jelas?
- Discord 3s limit: pakai `deferReply()` lalu `editReply()`?

Edge cases:
- AI playlist return track yang gak ada di YouTube/Spotify -> skip or fail?
- Roast tanpa lagu yang playing -> graceful message?
- API key missing -> both commands return error yang sama?
- Response > 2000 char (Discord limit) -> truncate or split?

- [ ] **Step 6: Append Phase C section ke REVIEW_NOTES.md**

Append to `REVIEW_NOTES.md`:

```markdown

## [Phase C] - 2026-06-16

<!-- Append bug/concern/nitpick/info entries di sini -->

---
```

- [ ] **Step 7: Syntax check Phase C files**

Run:
```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
node -c src/commands/aiplaylist.js && echo "aiplaylist.js OK"
node -c src/commands/roast.js && echo "roast.js OK"
```

Expected: All "OK".

- [ ] **Step 8: Commit Phase C**

```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
git add src/commands/aiplaylist.js src/commands/roast.js
git commit -m "feat(ai): Phase C - AI playlist & roast integration

- src/commands/aiplaylist.js: multi-provider AI playlist generator
- src/commands/roast.js: AI roast of currently playing track"
```

Expected: Commit created.

- [ ] **Step 9: Verify commit**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git log --oneline -1`

Expected: Latest commit is Phase C.

---

## Task 5: Review Phase D - Rate Limit & Live Monitor

**Files:**
- Read: `src/utils/aiLimits.js`
- Read: `src/commands/limit.js`
- Read: `src/commands/ai-set.js` (first half: limit/fallback/cache/limits subcommands)
- Modify: `REVIEW_NOTES.md` (append Phase D section)

- [ ] **Step 1: Read src/utils/aiLimits.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/utils/aiLimits.js`

Expected: ~289 lines. Perhatikan: `listAllLimits`, `getUserLimitStatus`, `recordUsage`, `checkLimit`, window logic (1 hour rolling).

- [ ] **Step 2: Read src/commands/limit.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/commands/limit.js`

Expected: ~122 lines. Perhatikan: ephemeral reply, progress bar, owner bypass, effective limit calculation.

- [ ] **Step 3: Read src/commands/ai-set.js (first 350 lines)**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && sed -n '1,350p' src/commands/ai-set.js`

Expected: Subcommand definitions, owner check, handlers for: `model`, `limit`, `userlimit`, `bonus`, `reset-limit`.

- [ ] **Step 4: Read src/commands/ai-set.js (lines 350-500 for fallback/cache/limits)**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && sed -n '350,500p' src/commands/ai-set.js`

Expected: Handlers for: `fallback`, `cache`, `limits` (live monitor), `view`.

- [ ] **Step 5: Cek integrasi Phase D**

Verify checks:
- `aiLimits.js` exports: `listAllLimits`, `getUserLimitStatus`, `recordUsage`, `checkLimit`, `resetUserLimit`
- `limit.js`: ephemeral, gak consume quota
- `ai-set.js`: semua subcommand owner-only check, ada cooldown?
- Effective limit calc: `userLimits[userId] || (userHourlyLimit + userBonuses[userId])` - urutannya bener?
- Owner bypass: hardcoded `OWNER_ID` di config atau di settings?

Edge cases:
- Window rollover: counter reset tiap 1 jam rolling - exact implementation (sliding window vs fixed)?
- Concurrent requests: race condition di counter increment?
- User di-whitelist tapi bukan owner -> bypass atau tidak?
- `reset-limit all` -> iterasi semua user, ada throttle?
- Limit monitor (Phase D live): sort by severity bener? Cap 25 user per embed?

- [ ] **Step 6: Append Phase D section ke REVIEW_NOTES.md**

Append to `REVIEW_NOTES.md`:

```markdown

## [Phase D] - 2026-06-16

<!-- Append bug/concern/nitpick/info entries di sini -->

---
```

- [ ] **Step 7: Syntax check Phase D files**

Run:
```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
node -c src/utils/aiLimits.js && echo "aiLimits.js OK"
node -c src/commands/limit.js && echo "limit.js OK"
node -c src/commands/ai-set.js && echo "ai-set.js OK"
```

Expected: All "OK".

- [ ] **Step 8: Commit Phase D (partial ai-set.js, Phase E akan complete file)**

```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
git add src/utils/aiLimits.js src/commands/limit.js src/commands/ai-set.js
git commit -m "feat(ai): Phase D - rate limit tracking & live monitor

- src/utils/aiLimits.js: hourly rate limit tracking + monitor helpers
- src/commands/limit.js: self-service limit check (ephemeral)
- src/commands/ai-set.js: owner subcommands (model/limit/userlimit/bonus/reset-limit/fallback/cache/limits/view)"
```

Expected: Commit created. Note: ai-set.js akan di-commit fully sekarang, Phase E cuma verifikasi chat.js.

- [ ] **Step 9: Verify commit**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git log --oneline -1`

Expected: Latest commit is Phase D.

---

## Task 6: Review Phase E - Chat Command

**Files:**
- Read: `src/commands/chat.js`
- Read: `src/commands/ai-set.js` (memory/whitelist subcommands - rest of file)
- Modify: `REVIEW_NOTES.md` (append Phase E section)

- [ ] **Step 1: Read src/commands/chat.js**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat src/commands/chat.js`

Expected: ~392 lines. Perhatikan: prefix flag parsing (`--<personality>`), owner check, reply session (10 min TTL), memory integration, rate limit integration.

- [ ] **Step 2: Read src/commands/ai-set.js (lines 500-end, memory/whitelist handlers)**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && sed -n '500,688p' src/commands/ai-set.js`

Expected: Handlers for `memory` (view/set/clear/global) dan `whitelist` (add/remove/list).

- [ ] **Step 3: Cek integrasi Phase E**

Verify checks:
- `chat.js`: prefix parsing valid names only (13 names), invalid silently treated as part of prompt
- Reply session: key based on userId+messageId? TTL 10 min using `setTimeout` or timestamp check?
- Memory: read before send, write after response? (or async write?)
- Rate limit: integrate dengan `aiLimits.js` - owner bypass?
- Whitelist: `chat.js` check `whitelist.includes(userId)` OR `userId === OWNER_ID`?
- Owner override personality: parse `--<name>` di end, validate against 13 names, silently ignore for non-owner

Edge cases:
- User reply ke message > 10 min lalu -> session expired, treated as new chat?
- Personality flag mid-message (bukan di akhir) -> gak ke-detect?
- Memory write fail (disk full) -> chat tetep works?
- Rate limit hit mid-conversation -> graceful message, gak crash?
- Multiple `--<flag>` di message -> yang terakhir yang dipake atau reject?

- [ ] **Step 4: Append Phase E section ke REVIEW_NOTES.md**

Append to `REVIEW_NOTES.md`:

```markdown

## [Phase E] - 2026-06-16

<!-- Append bug/concern/nitpick/info entries di sini -->

---
```

- [ ] **Step 5: Syntax check Phase E files**

Run:
```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
node -c src/commands/chat.js && echo "chat.js OK"
```

Expected: "chat.js OK". (ai-set.js udah di-check di Phase D)

- [ ] **Step 6: Commit Phase E (chat.js only, ai-set.js udah di Phase D)**

```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
git add src/commands/chat.js
git commit -m "feat(ai): Phase E - chat command with personality

- src/commands/chat.js: AI chat with 13 personalities, reply session (10m TTL), memory integration"
```

Expected: Commit created.

- [ ] **Step 7: Verify commit**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git log --oneline -1`

Expected: Latest commit is Phase E.

---

## Task 7: Review Non-Phase Files (Help, Colors, Prefixes, Env)

**Files:**
- Read: `src/commands/help.js` (diff)
- Read: `src/commands/helpv2.js` (diff)
- Read: `src/utils/colors.js` (diff)
- Read: `src/handlers/messageHandler.js` (diff)
- Read: `src/config/prefixAliases.js` (diff)
- Read: `.env.example` (diff)
- Modify: `REVIEW_NOTES.md` (append Non-Phase section)

- [ ] **Step 1: Read all non-phase diffs**

Run:
```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
echo "=== help.js ==="
git diff HEAD -- src/commands/help.js
echo "=== helpv2.js ==="
git diff HEAD -- src/commands/helpv2.js
echo "=== colors.js ==="
git diff HEAD -- src/utils/colors.js
echo "=== messageHandler.js ==="
git diff HEAD -- src/handlers/messageHandler.js
echo "=== prefixAliases.js ==="
git diff HEAD -- src/config/prefixAliases.js
echo "=== .env.example ==="
git diff HEAD -- .env.example
```

Expected: Diffs for all 6 files.

- [ ] **Step 2: Cek apakah ada 2 help file redundant**

Mental check: apakah `help.js` dan `helpv2.js` keduanya registered di `commandLoader.js`? Kalau iya, apakah `helpv2` deprecated?

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && grep -n "name" src/commands/help.js src/commands/helpv2.js | head -20`

Expected: Check data.name di kedua file.

- [ ] **Step 3: Cek prefix aliases untuk AI commands**

Verify: `prefixAliases.js` punya entries untuk: `ap` (aiplaylist), `roast`, `chat`, `ais` (ai-set), `limit` (ai-limit)?

- [ ] **Step 4: Cek .env.example untuk AI vars**

Verify: ada `AI_DEFAULT_PROVIDER`, `AI_DEFAULT_MODEL`, `NVIDIA_API_KEY`, `TOKENROUTER_API_KEY`?

- [ ] **Step 5: Append Non-Phase section ke REVIEW_NOTES.md**

Append to `REVIEW_NOTES.md`:

```markdown

## [Non-Phase] - 2026-06-16

<!-- Append bug/concern/nitpick/info entries di sini -->

---
```

- [ ] **Step 6: Syntax check all non-phase JS files**

Run:
```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
node -c src/commands/help.js && echo "help.js OK"
node -c src/commands/helpv2.js && echo "helpv2.js OK"
node -c src/utils/colors.js && echo "colors.js OK"
node -c src/handlers/messageHandler.js && echo "messageHandler.js OK"
node -c src/config/prefixAliases.js && echo "prefixAliases.js OK"
```

Expected: All "OK".

- [ ] **Step 7: Commit non-phase files**

```bash
cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay"
git add src/commands/help.js src/commands/helpv2.js src/utils/colors.js src/handlers/messageHandler.js src/config/prefixAliases.js .env.example
git commit -m "chore: sync help, colors, prefix aliases, env example

- src/commands/help.js + helpv2.js: updated for AI commands
- src/utils/colors.js: premium pastel color palette
- src/handlers/messageHandler.js: integrate new AI prefix commands
- src/config/prefixAliases.js: aliases for chat/ais/limit/ap/roast
- .env.example: AI provider config (NVIDIA, TokenRouter)"
```

Expected: Commit created.

- [ ] **Step 8: Verify commit**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git log --oneline -1`

Expected: Latest commit is the chore commit.

---

## Task 8: Final Summary

**Files:**
- Read: `REVIEW_NOTES.md` (final read)
- Run: `git status`, `git log`

- [ ] **Step 1: Verify all changes committed**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git status`

Expected: Working tree clean (atau cuma REVIEW_NOTES.md untracked).

- [ ] **Step 2: Verify commit history**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && git log --oneline -10`

Expected: 6 commits baru (Phase A, B, C, D, E, chore) + 1 design spec commit di paling awal.

- [ ] **Step 3: Final read REVIEW_NOTES.md**

Run: `cd "C:\Users\HP\OneDrive\Documents\CODINGAN\BOT-DISCORD\PinPlay" && cat REVIEW_NOTES.md`

Expected: Full review notes dengan entries dari setiap phase.

- [ ] **Step 4: Print summary to user**

Print to user:
- Total commits created
- Per phase: jumlah file, bug count
- REVIEW_NOTES.md path
- Saran next steps (fix bugs di session berikutnya)

- [ ] **Step 5: Mark task complete**

No commit. Update task tracker kalau ada. Done.

---

## Self-Review

**1. Spec coverage:**
- Phase mapping -> Task 2-6
- Review process (per file) -> Each task's Step "Read file"
- Edge case checks -> Each task's Step "Cek integrasi"
- REVIEW_NOTES format -> Task 1 + Each phase's append step
- Commit messages (Conventional Commits) -> Each commit step
- Execution order A->B->C->D->E->chore -> Task 2-7
- Syntax check -> Each phase's syntax check step
- Risk mitigation (commit per phase, no `git add .`) -> Step instructions jelas
- Success criteria (6 commits, REVIEW_NOTES, summary) -> Task 8

**2. Placeholder scan:** No "TBD", "TODO", "implement later", "similar to". All steps concrete with commands/expected output.

**3. Type consistency:**
- File names consistent across tasks
- `REVIEW_NOTES.md` path consistent
- Export names dari utils/AI files dicek di setiap phase, tidak conflict
- Commit message format consistent (`feat(ai):` / `chore:`)

**4. Ambiguity check:** No ambiguous steps. Each step has exact command, exact expected output, exact commit message.
