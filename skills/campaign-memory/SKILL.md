---
name: campaign-memory
description: Persistent learning system for the agent. Reads past mistakes and corrections before each phase to constrain generation. Writes new learnings after user rates a run. Two scopes — global (all brands) and brand-specific (aesthetic preferences). Memory is stored as JSONL files on the shell server.
---

# Campaign Memory

## When to use

- **Read** at the start of every agent run, before each phase that uses an LLM prompt
- **Write** after a run completes and the user gives feedback or rates the output
- **Clear** when brand preferences have changed significantly

## Inputs for read

| Input | Required | Description |
|---|---|---|
| `phase` | yes | `plan_scenes` \| `generate_images` \| `generate_voiceover` \| `assemble_video` \| `all` |
| `brandSlug` | no | If provided, reads brand-scoped memory in addition to global |

## Inputs for write

| Input | Required | Description |
|---|---|---|
| `entry` | yes | `MemoryEntry` object (see schema below) |
| `scope` | yes | `global` \| `brand` |
| `brandSlug` | no | Required when `scope === 'brand'` |

## MemoryEntry schema

```ts
{
  phase: 'plan_scenes' | 'generate_images' | 'generate_voiceover' | 'assemble_video' | 'all',
  what_went_wrong: string,   // concrete description of the mistake
  better_approach: string,   // what to do instead
  example?: string,          // optional concrete example
}
```

## Instructions — Reading

1. Call `readMemory(phase, brandSlug)` from `services/agentMemory.ts`. Returns `MemoryEntry[]` merged from global and brand JSONL files.

2. Call `formatMemoryForPrompt(entries)`. Returns a formatted string block:
   ```
   LEARNED RULES FROM PAST RUNS (must follow strictly):
   1. MISTAKE: "used walnut in ingredients scene" → CORRECT: "only use ingredients listed on the product page"
   2. MISTAKE: "product label distorted" → CORRECT: "use EDIT THIS EXACT PRODUCT IMAGE prefix"
   ```
   Returns empty string if no entries — safe to append directly to any prompt.

3. Append this block to the relevant LLM prompt before calling Gemini.

## Instructions — Writing

Write memory after a run when:
- User edits a voiceover line at the plan gate → write `plan_scenes` entry
- User says "the bottle looks different" after image gen → write `generate_images` entry
- User flags an ingredient error → write `plan_scenes` entry with the specific ingredient
- User rates an overall run poorly → write `all` entry with the general issue

Use the 🧠 Agent Memory panel in the AgentConsole UI, or call `writeMemory(entry, scope, brandSlug)` directly from code.

## Memory files

```
/tmp/reelai-agent/_memory/
  global-skills.jsonl          ← universal rules, all brands
  brand-{slug}.jsonl           ← brand-specific preferences
```

Each line in the JSONL file is one `MemoryEntry` with a `ts` timestamp added by the server.

## Scope decision guide

| What happened | Scope | Phase |
|---|---|---|
| Agent invented an ingredient | global | plan_scenes |
| ffmpeg command failed in a specific way | global | assemble_video |
| Brand always uses warm tones | brand | generate_images |
| Brand prefers one-word captions | brand | plan_scenes |
| Caption color was wrong for this brand | brand | all |
| PCM/WAV bug | global | generate_voiceover |

## Constraints

- **NEVER** write memory about user preferences that should be in the config (platform, style, duration) — those are per-run inputs, not learnings
- **NEVER** write memory that contradicts a verified product fact — memory supplements facts, does not override them
- **NEVER** let memory entries override the `STRICT RULE` constraint block — facts always win
- Memory is capped at ~50 entries per file by the server — older entries are rotated out

## Success criteria

- Every phase that uses an LLM prompt has memory loaded and appended before the Gemini call
- Past mistakes do not repeat across runs for the same brand
- User can view and manage memory entries in the 🧠 Agent Memory panel in AgentConsole
