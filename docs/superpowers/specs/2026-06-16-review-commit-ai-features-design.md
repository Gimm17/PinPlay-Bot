# Review & Commit AI Features (Phase A-E) — Design

**Date:** 2026-06-16
**Status:** Approved (pending user review of written spec)
**Scope:** Konsolidasi AI features yang udah dikembangkan tapi belum di-commit ke git.

---

## Context & Motivation

Project PinPlay udah mengembangkan sistem AI (Phase A-E) dengan fitur lengkap:
- Multi-provider (NVIDIA + TokenRouter)
- 13 personality
- Per-user memory
- Rate limit tracking
- Prompt cache
- Provider fallback
- Live monitor
- Owner settings

**Problem:** Semua code ini ada di working directory tapi belum di-commit. Ada 9 file baru (untracked) dan 12 file modified. Butuh direview dan di-commit biar:
1. Code masuk version control
2. Bug yang ada bisa diidentifikasi (untuk fix nanti)
3. History readable per phase
4. Bisa di-revert per phase kalau ada masalah

**BUKAN** scope: refactor, fix bug, atau tambah fitur baru. Cuma review + catat + commit.

---

## Approach: Phase-by-Phase Sequential

Sequential review per phase, dengan commit per phase. Cocok karena:
- User minta "deep review" + "pisah per phase"
- Phase A-E udah jelas defined di CHANGELOG
- Bug notes (bukan fix) = gak nambah scope
- Syntax check sebelum commit = safety net

---

## Phase Mapping (File → Phase A-E)

| Phase | Files | Deskripsi |
|-------|-------|-----------|
| **A** | `src/utils/ai.js`, `src/utils/personalities.js`, `src/utils/aiSettings.js`, `src/index.js` (modified) | Base AI client multi-provider, 13 personality, global settings, prewarm at boot |
| **B** | `src/utils/aiMemory.js`, `src/utils/aiPromptCache.js`, `src/utils/aiProviderFallback.js` | Per-user memory, prompt cache, provider fallback layer |
| **C** | `src/commands/aiplaylist.js` (modified), `src/commands/roast.js` (modified) | AI Playlist + AI Roast integration dengan multi-provider |
| **D** | `src/utils/aiLimits.js`, `src/commands/limit.js`, `src/commands/ai-set.js` (limit/fallback/cache/limits subcommands) | Rate limit tracking, self-service limit, owner monitor |
| **E** | `src/commands/chat.js`, `src/commands/ai-set.js` (memory/whitelist/model/userlimit/bonus/reset-limit/view subcommands) | Chat command + personality + memory management + owner settings |

**Files non-phase (commit terpisah di akhir):**
- `src/commands/help.js` (modified)
- `src/commands/helpv2.js` (modified)
- `src/utils/colors.js` (modified)
- `src/handlers/messageHandler.js` (modified)
- `src/config/prefixAliases.js` (modified)
- `.env.example` (modified)

---

## Review Process (Per Phase)

Untuk setiap phase A → B → C → D → E:

1. **Read semua file** di phase tersebut
2. **Cek integrasi** — siapa yang export/import apa, ada circular dependency gak, ada unused export gak
3. **Cek edge cases:**
   - Missing API key (NVIDIA/TokenRouter) → graceful fallback
   - Rate limit calculation (userLimits + bonuses + base)
   - Owner bypass
   - JSON storage race condition (debounced write)
   - AI timeout (90s hard cap)
   - Empty response setelah strip thinking
4. **Cek bug & catat** di `REVIEW_NOTES.md` (kategori: `bug` / `concern` / `nitpick` / `info`)
5. **Syntax check** dengan `node -c <file>` di semua file JS phase itu
6. **Commit** dengan format Conventional Commits

**Yang TIDAK dilakukan:**
- ❌ Refactor code
- ❌ Tambah fitur baru
- ❌ Fix bug yang ditemukan (cuma dicatat)
- ❌ Ubah struktur file

---

## REVIEW_NOTES.md Format

File: `REVIEW_NOTES.md` di root (untracked, **TIDAK di-commit**).

```markdown
## [Phase X] - YYYY-MM-DD

### 🐛 bug: <judul singkat>
- **File:** `path/to/file.js:line`
- **Issue:** <apa yang salah>
- **Impact:** <apa efeknya ke user/runtime>
- **Suggested fix:** <kalau ada ide, optional>

### ⚠️ concern: <judul>
- **File:** ...
- **Concern:** <apa yang perlu diawasi>

### 💭 nitpick: <kecil, style only>
- **File:** ...
- **Note:** <misal: typo, naming inkonsisten>

### ℹ️ info: <catatan netral>
- **File:** ...
- **Note:** <misal: third-party API limitation>
```

**Kategori:**
- 🐛 **bug** — masalah runtime/logic yang perlu fix nanti
- ⚠️ **concern** — bukan bug tapi perlu diawasi
- 💭 **nitpick** — cosmetic / style, gak urgent
- ℹ️ **info** — catatan netral, dokumentasi

---

## Commit Messages & Execution Order

**Commit format (Conventional Commits + scope):**

```
feat(ai): Phase A — base AI client + 13 personalities
feat(ai): Phase B — memory + cache + fallback layer
feat(ai): Phase C — AI playlist & roast integration
feat(ai): Phase D — rate limit tracking & live monitor
feat(ai): Phase E — chat command + owner settings
chore: sync help, colors, prefix aliases, env example
```

**Execution order:**
1. Cek apakah ada `REVIEW_NOTES.md` lama (append kalau ada)
2. Review Phase A → catat → syntax check → commit
3. Review Phase B → catat → syntax check → commit
4. Review Phase C → catat → syntax check → commit
5. Review Phase D → catat → syntax check → commit
6. Review Phase E → catat → syntax check → commit
7. Review non-phase files (help, colors, etc) → 1 commit `chore:`
8. Final: cek `git status`, kasih summary ke user

**Per commit:**
- Tampilin ringkasan review per file (1-2 baris)
- Tampilin bug notes yang ditemukan
- Jalanin `node -c` syntax check
- Jalanin `git add` (per file) + `git commit`
- Kasih tau user commit hash + summary

---

## Risk & Rollback

**Risk yang diidentifikasi:**

1. **Missed integration bug** — Deep review mungkin gak catch semua.
   - Mitigasi: syntax check + commit per phase (bisa di-revert per phase).

2. **REVIEW_NOTES.md conflict** — kalau ada notes lama, format bisa beda.
   - Mitigasi: append dengan section header baru, atau backup dulu kalau perlu.

3. **Commit history pollution** — kalau ada commit message yang salah.
   - Mitigasi: tampilkan message dulu sebelum commit, kasih kesempatan user reject.

4. **File yang di-modify user (belum commit)** bisa aja konflik.
   - Mitigasi: commit per file/phase dengan message jelas, gak `git add .` sekaligus.

5. **`.env.example` modified** — kalau commit dengan phase manapun, harus jelas.
   - Mitigasi: file ini di-commit terpisah di `chore:` step.

**Rollback strategy:**
- Kalau user gak setuju salah satu commit → `git reset --soft HEAD~1` (uncommit, keep changes)
- Kalau ada bug yang baru ketauan setelah commit → bisa di-fix di commit berikutnya dengan message `fix(ai): ...`
- REVIEW_NOTES.md bisa di-clear kapan aja, gak ke-track git

---

## Success Criteria

Sesi ini dianggap sukses kalau:
1. ✅ Semua 9 file baru di-commit ke git (5 commits per phase)
2. ✅ Semua 6 file non-phase di-commit (1 commit `chore:`)
3. ✅ Total 6 commit baru di git log
4. ✅ `REVIEW_NOTES.md` dibuat dengan catatan dari setiap phase
5. ✅ Syntax check pass di semua file yang di-commit
6. ✅ User sudah liat summary akhir

**Bukan** success criteria:
- Code bebas bug (cuma dicatat)
- Code di-refactor (gak dilakukan)
- Fitur baru (gak ada)
