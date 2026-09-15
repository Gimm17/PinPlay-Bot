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

## [Phase A] - 2026-06-16

Files reviewed: src/utils/ai.js (269), src/utils/personalities.js (237), src/utils/aiSettings.js (250), src/index.js (modified, +8 lines for prewarm)

### info: _getClient throws when API key missing (by design)
- File: src/utils/ai.js:135
- Note: _getClient() throws if API key missing, but prewarmAll() only catches with try/catch per provider. If both providers lack keys, prewarmAll logs warnings but does not break boot. callAI will throw on first use - intentional, forces user to set up keys. Not a bug.

### concern: Classifier has no caching, doubles API cost per chat
- File: src/utils/personalities.js:204 (detectPersonality)
- Issue: Every chat call invokes classifier API (1 extra call per message). No memoization.
- Impact: Doubles API cost per chat. User sending 10 messages in 10 min = 20 calls instead of 10. NVIDIA free tier has limits.
- Suggested fix: Cache by hash of userText (like aiPromptCache) with short TTL (~5 min).

### info: Thinking strip regex covers 4 variants
- File: src/utils/ai.js:87
- Note: Regex covers think/thinking/reasoning/reflection. Working as designed. If new model adds analysis or other tag, need update.

### info: aiSettings write is debounced (500ms) but not atomic
- File: src/utils/aiSettings.js:91 (_scheduleSave)
- Issue: Uses fs.writeFileSync directly (no temp+rename). If process crashes mid-write, file could be corrupt. _loadCache handles with try/catch fallback to DEFAULTS - graceful but could lose data.
- Impact: Low (restarts rare, in-memory cache preserved on graceful shutdown).
- Suggested fix: Optional: write to .tmp then rename for atomicity. Not urgent.

### nitpick: ai.js error handling has overlapping branches
- File: src/utils/ai.js:224-255
- Note: 5xx handler throws after timeout branch - order matters but works. Could be cleaner with early-return pattern. Not urgent.

### info: prewarmAll called from clientReady, no crash on missing keys
- File: src/index.js:48-53
- Note: Correct integration. If env keys missing, logs warning and continues.

---

## [Phase B] - 2026-06-16

Files reviewed: src/utils/aiMemory.js (376), src/utils/aiPromptCache.js (105), src/utils/aiProviderFallback.js (116)

### info: aiMemory write is debounced (500ms) but not atomic (same pattern as aiSettings)
- File: src/utils/aiMemory.js:110 (_scheduleSave)
- Note: Same pattern as aiSettings - writeFileSync direct, no temp+rename. _loadCache handles corruption gracefully with try/catch fallback to empty cache. In-memory cache survives graceful shutdown. Risk of data loss only on hard crash mid-write. Low priority.

### info: aiPromptCache LRU eviction is naive FIFO
- File: src/utils/aiPromptCache.js:65-68
- Issue: `entries.keys().next().value` gets first key (oldest insertion), not LRU-by-access. Real LRU would need to track access order separately. Map preserves insertion order in JS, so this is technically FIFO not LRU - the cached item is the FIRST one inserted, not the LEAST RECENTLY USED.
- Impact: For a user who hits cache A, then B, then A again (3 entries), A is still cached. If they hit C, D, E, F, G to reach cap, the FIRST cached (oldest insertion) gets evicted, not the least accessed.
- Suggested fix: Use a true LRU structure, or rename to FIFO. For a 50-entry cache with 1h TTL, the difference is minor. Not urgent.

### info: aiPromptCache GC interval is unref'd - won't block shutdown
- File: src/utils/aiPromptCache.js:36 (_gcInterval.unref())
- Note: Good - prevents GC timer from keeping the process alive. Working as designed.

### concern: extractFactsFromMessage runs extra AI call per chat message
- File: src/utils/aiMemory.js:325 (extractFactsFromMessage)
- Issue: Each chat message triggers a background AI call to extract facts. With 3 personalities, classifier call, fact-extract call, and main chat call = 3-4 API calls per user message.
- Impact: Triples API cost per chat. NVIDIA free tier may hit limits fast.
- Suggested fix: Rate-limit fact extraction (e.g., only for messages >20 chars, or every Nth message). Or skip if cache hit.

### info: aiProviderFallback hardcodes tokenrouter-first preference
- File: src/utils/aiProviderFallback.js:60
- Note: Fallback order hardcoded as ["tokenrouter", "nvidia"]. If user prefers nvidia, fallback still tries tokenrouter first. May want to make order configurable. Not urgent.

### concern: callAIWithFallback swallows original error in fallback failure
- File: src/utils/aiProviderFallback.js:106
- Issue: When fallback also fails, throws original error (err) not fbErr. Loses diagnostic info from fallback failure. User sees primary error, but root cause could be fallback.
- Impact: Debugging harder if both providers fail. Logs do capture fbErr internally.
- Suggested fix: Could include both errors in thrown error message: `throw new Error("Both providers failed: ${err.message} | ${fbErr.message}")`. Minor.

### nitpick: aiMemory allowed fields list duplicated
- File: src/utils/aiMemory.js:174 (setUserField) and 195 (removeUserField)
- Note: Two `allowed` arrays maintained separately. They overlap but `removeUserField` includes "facts" while `setUserField` doesn't (intentional - facts are managed via addUserFact). Could extract to single constant with comments. Not urgent.

---

## [Phase C] - 2026-06-16

Files reviewed: src/commands/aiplaylist.js (modified, +19/-6), src/commands/roast.js (modified, +57/-7)

### info: aiplaylist switched from callAI to callAIWithFallback
- File: src/commands/aiplaylist.js:14, 165
- Note: Now uses callAIWithFallback for auto-fallback on 5xx. Correct integration.

### info: aiplaylist rate limit added via aiLimits.checkAndIncrement
- File: src/commands/aiplaylist.js:253-262
- Note: Shared rate limit across all AI features. Check happens BEFORE voice check, so user gets rate limit error even if not in voice. Good.

### concern: aiplaylist rate limit check happens before deferReply
- File: src/commands/aiplaylist.js:255
- Issue: Rate limit check uses `interaction.reply()` directly (flags:64 for ephemeral). But subsequent code path uses `deferReply()` after voice check. Inconsistent response style.
- Impact: Minor UX inconsistency. User sees ephemeral warning for rate limit, but normal response for voice missing.
- Suggested fix: Use deferReply + editReply everywhere, or document the difference. Not urgent.

### info: aiplaylist cache key changed to randomUUID (avoiding ID clash)
- File: src/commands/aiplaylist.js:208
- Note: Previous cache key used user.id+guildId+interaction.id. Now uses randomUUID. Each generation gets unique cache - this is for the 5-min button-driven "regenerate" cache. Working as designed.

### info: SEARCH_CONCURRENCY bumped from 5 to 8
- File: src/commands/aiplaylist.js:22
- Note: Increased parallel track searches from 5 to 8. May overload Lavalink if it has connection limits. Minor perf tweak.

### info: roast switched to callAIWithFallback, aiPromptCache, aiMemory
- File: src/commands/roast.js (multiple lines)
- Note: Big upgrade - now uses provider fallback, prompt cache (1h TTL), and user memory for personalization. Cache key includes user memory context to avoid stale personalized roasts.

### concern: roast cache hit still counts toward rate limit
- File: src/commands/roast.js:84 (before defer)
- Issue: Rate limit check happens BEFORE cache lookup. So even if user re-uses cached roast, it counts as a request.
- Impact: User who spams /roast on same track 10 times in 1 hour = 10/limit, even though only 1 AI call happened. Possibly intentional (prevent spam), but if limit is 5 and cache hit is cheap, feels unfair.
- Suggested fix: Move rate limit check AFTER cache lookup. Or document that "requests" includes cache hits.

### ✅ RESOLVED (2026-06-17, commit 8a112bc)
- Status: Resolved indirectly by Free Command feature
- Note: `/roast` was added to `FREE_COMMANDS` set in `aiLimits.js` per owner request. Now `checkAndIncrement(userId, "roast")` returns `reason: "free-command"` with `remaining: Infinity` and **does not consume a slot**. Both cache hit and cache miss paths bypass the rate limit entirely. The "unfairness" concern is moot — there is no rate limit on /roast at all.
- File: src/utils/aiLimits.js:42 (`FREE_COMMANDS = new Set(["roast", "aiplaylist"])`)
- File: src/commands/roast.js:86 (passes `"roast"` as commandName)

### info: roast deletes the "Roast..." status message after followUp
- File: src/commands/roast.js:135-136, 197-198
- Note: Pattern: editReply "Roast...", followUp with actual roast, then deleteReply. Keeps channel clean. Working as designed.

### info: roast requester mention edge case
- File: src/commands/roast.js:155 (cache hit path)
- Issue: Code checks `requester?.id ? <@${requester.id}> ` but `requester` may not be set in all code paths. The cache hit path uses `requester?.id` which gracefully handles missing. Original non-cache path uses `requester?.id` similarly. Both safe.

### nitpick: roast cache key includes full memory context
- File: src/commands/roast.js:151-155
- Note: Cache key hashes user memory context. If user updates memory, they get a different cache key (good - personalization updated). But if memory changes mid-cache-TTL, old roast still cached for OTHER users who haven't changed. Working as designed.

### info: aiplaylist no longer uses randomUUID for cache key (actually it does)
- File: src/commands/aiplaylist.js:208
- Note: randomUUID ensures no collision. The 5-min TTL cache for "regenerate" buttons doesn't need predictable keys. Correct.

---

## [Phase D] - 2026-06-16

Files reviewed: src/utils/aiLimits.js (289), src/commands/limit.js (122), src/commands/ai-set.js (688, partial for limit/fallback/cache/limits subcommands)

### info: aiLimits uses in-memory Map (lost on restart)
- File: src/utils/aiLimits.js:26 (_windows)
- Note: All rate limit state is in-memory only. Bot restart = all counters reset. User who just hit 5/5 limit gets fresh 5 after restart. Possibly intentional (low friction), but could be exploited by owner restarting bot.
- Suggested fix: Optional: persist to JSON with debounce like aiSettings. Not urgent.

### concern: aiLimits concurrent requests not protected
- File: src/utils/aiLimits.js:100 (`w.count += 1`)
- Issue: Check-and-increment is not atomic. Two concurrent requests could both pass the `w.count >= limit` check before either increments.
- Impact: Theoretical race condition. In practice Discord sends one interaction at a time per user, so unlikely. But if user spams from multiple clients, could exceed limit by 1-2.
- Suggested fix: For true atomicity, use a queue/lock. Not urgent for current traffic.

### info: aiLimits GC interval is unref'd (good)
- File: src/utils/aiLimits.js:277
- Note: GC interval unref'd - won't block process shutdown. Working as designed.

### info: limit.js is ephemeral via flags:64
- File: src/commands/limit.js:102
- Note: All replies ephemeral. Good - no public spam from self-service limit checks.

### info: limit.js handlePrefix is exported separately
- File: src/commands/limit.js:122
- Note: Module exports data, execute, AND handlePrefix via separate assignment. Slight oddity (two module.exports) but works. Could refactor to single object.

### info: ai-set.js owner check via direct ID comparison
- File: src/commands/ai-set.js:39 (_ensureOwner)
- Issue: Compares `interaction.user.id === config.discord.ownerId`. If ownerId not set in env, fails open (returns false, only owner can't run it... wait, actually if ownerId is null, `_ensureOwner` returns false, so nobody can run it - that's fail-secure, good).
- Impact: If ownerId is misconfigured, all subcommands denied. Need to test with valid env. Working as designed.

### concern: ai-set.js whitelist add/remove path duplicate code
- File: src/commands/ai-set.js:267-307
- Note: The pattern of `let user = getUser(); if (!user) try raw string; if (action === list) ...; if (action === add) ...; if (action === remove) ...` is repeated for whitelist, userlimit, bonus, reset-limit. 4 subcommands, 4x duplicate code. Could extract to a helper.
- Impact: Maintenance burden. Any change to user resolution must be made 4 times. Risk of inconsistency.
- Suggested fix: Extract `_resolveUser(interaction, optionName)` helper. Not urgent.

### info: ai-set.js is large (688 lines) but well-organized
- File: src/commands/ai-set.js
- Note: 12 subcommands, each ~30 lines. Total 688 is reasonable. Could split into separate files (model.js, limit.js, etc.) for clearer ownership, but cohesive as owner-settings hub.

### info: ai-set.js all replies use flags:64 (ephemeral)
- File: src/commands/ai-set.js (throughout)
- Note: All owner command replies are ephemeral. Good - keeps settings changes out of public chat.

### info: aiLimits exported constants include WINDOW_MS
- File: src/utils/aiLimits.js:288
- Note: Exports WINDOW_MS for callers. Useful for display purposes.

---

## [Phase E] - 2026-06-16

Files reviewed: src/commands/chat.js (392), ai-set.js (memory/whitelist handlers in 500-688, already covered in Phase D)

### info: chat.js has 2 entry points (slash + reply)
- File: src/commands/chat.js:228 (execute) and 341 (handleChatReply)
- Note: Slash command via execute(). Reply-to-continue via handleChatReply called from messageHandler. Both share _runChat core. Working as designed.

### info: chat.js session state in client._chatSessions (lost on restart)
- File: src/commands/chat.js:71 (_getSession)
- Note: Session Map on client object. Bot restart = all conversations lost. Acceptable for 10-min TTL design (user wouldn't expect old sessions to survive restart).

### concern: chat.js reply handler also counts toward rate limit
- File: src/commands/chat.js:354
- Note: Reply-to-continue also calls checkAndIncrement. So a conversation of 10 messages = 10 rate limit uses. With base limit of 5/hour, user can only have one ongoing conversation. This may be intentional (prevent runaway costs) but feels limiting.
- Suggested fix: Could exempt reply from rate limit (or apply lower weight). Or document this. Minor.

### concern: chat.js reply handler doesn't re-check whitelist
- File: src/commands/chat.js:341
- Issue: handleChatReply doesn't call _isAllowed(userId). User who was whitelisted when starting conversation can continue even if owner removes them mid-conversation. They could also re-reply to old bot messages.
- Impact: Whitelist removal takes effect only for NEW /chat calls, not continuations. Possibly intentional (graceful for active users), but security concern if whitelist removal is for abuse.
- Suggested fix: Add _isAllowed check in handleChatReply, or document the 10-min grace period.

### info: chat.js prefix parsing regex
- File: src/commands/chat.js:260
- Note: Regex `/^(.*?)\s+--([a-z0-9-]+)\s*$/i` - captures prompt + personality flag at end. Greedy/lazy correctly used. Edge case: prompt ending with " --foo" but foo is invalid - handled (treated as part of prompt). Working as designed.

### info: chat.js classifier call only on new conversations
- File: src/commands/chat.js:139-146
- Note: Classifier (extra API call) only runs on first message or new session. Continuations reuse session.personality. Smart cost optimization. Working as designed.

### info: chat.js background fact extraction is fire-and-forget
- File: src/commands/chat.js:184
- Note: extractFactsFromMessage is called but not awaited. If it fails, just logs. Doesn't block chat UX. Working as designed (as long as logging is sufficient).

### info: chat.js _runChat send callback wraps interaction.editReply
- File: src/commands/chat.js:330
- Note: Slash uses editReply (placeholder). Reply uses placeholder.edit. Pattern keeps conversation thread clean. Working as designed.

### nitpick: chat.js uses _client property on session (smell)
- File: src/commands/chat.js:179
- Issue: Sets `session._client = client` to pass client ref through to _rememberBotReply. Mutating session with private property. Could pass client as param to _runChat.
- Impact: Minor code smell. Works but harder to test.
- Suggested fix: Add client to _runChat params. Not urgent.

### info: chat.js MAX_HISTORY caps message array
- File: src/commands/chat.js:103
- Note: After 20 user/assistant pairs (40 messages), oldest get trimmed. Reasonable cap to control token usage.

### info: chat.js SESSION_TTL_MS = 10 min
- File: src/commands/chat.js:52
- Note: 10 min idle TTL matches CLAUDE.md documentation. Working as designed.

### info: chat.js no streaming - sends full response after completion
- File: src/commands/chat.js:90-97 (_buildChatEmbed)
- Note: Despite docstring mentioning "streaming UX", actual code waits for full response then sends embed. The "thinking" placeholder + typing indicator is the UX. False advertising in docstring.
- Suggested fix: Update docstring or implement true streaming (complex). Not urgent.

---

## [Non-Phase] - 2026-06-16

Files reviewed: help.js (+70/-3), helpv2.js (+22/-1), colors.js (+1), messageHandler.js (+11), prefixAliases.js (+158), .env.example (+15)

### concern: Two help commands exist (/help and /helpv2)
- File: src/commands/help.js:442 and src/commands/helpv2.js:294
- Issue: Both commands registered. helpv2 is a separate command (not replacing help). User confusion: which to use? Why two versions?
- Impact: Two similar commands visible in Discord UI. Maintenance burden (updates needed in 2 places).
- Suggested fix: Deprecate one. Rename helpv2 to something clearer, or keep as experimental. Or merge functionality.

### info: colors.js only added 1 line
- File: src/utils/colors.js
- Note: Minimal change - likely added a new color constant (probably Colors.AI or similar for AI commands).

### info: messageHandler.js added 11 lines
- File: src/handlers/messageHandler.js
- Note: Likely added AI command prefix handlers (chat, ai-set, limit, aiplaylist, roast). Working as designed - integrates with prefix command system.

### info: prefixAliases.js added 158 lines (significant)
- File: src/config/prefixAliases.js
- Note: Big addition - probably added all AI command aliases (ap, roast, chat, ais, limit, ai-limit, etc.). 158 lines of aliases is consistent with 25+ commands having short aliases.

### info: .env.example added 15 lines (AI config)
- File: .env.example
- Note: Added AI provider env vars (NVIDIA_API_KEY, TOKENROUTER_API_KEY, AI_DEFAULT_PROVIDER, AI_DEFAULT_MODEL, OWNER_ID, etc.). Working as designed.

---
