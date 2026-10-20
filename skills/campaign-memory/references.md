# Campaign Memory — References

## Services

```
services/agentMemory.ts

  writeMemory(entry: MemoryEntry, scope: 'global' | 'brand', brandSlug?: string): Promise<void>

  readMemory(phase: MemoryPhase | '', brandSlug?: string): Promise<MemoryEntry[]>
  // Returns merged global + brand entries for the given phase
  // Pass '' or 'all' for phase to get all entries regardless of phase

  listMemory(): Promise<MemorySummary[]>
  // Returns [{ file, count, latest }] for each JSONL file

  clearMemory(scope: 'global' | 'brand', brandSlug?: string): Promise<void>

  formatMemoryForPrompt(entries: MemoryEntry[]): string
  // Returns '' if entries is empty (safe to append to any prompt)
```

## Shell server endpoints

```
POST /memory/write
  body: { scope, brandSlug, entry }

GET /memory/read?scope=all&phase={phase}&brand={slug}
  returns: { entries: MemoryEntry[] }

GET /memory/list
  returns: { summary: MemorySummary[] }

DELETE /memory/clear
  body: { scope, brandSlug }
```

## How memory is loaded in autonomousAgent.ts

```ts
// Called once at run start in loadMemory()
const phases = ['plan_scenes', 'generate_images', 'generate_voiceover', 'all'];
for (const phase of phases) {
  const entries = await readMemory(phase, brandSlug);
  this.memoryByPhase.set(phase, entries);
}

// 'all' entries are merged into every phase
const allEntries = this.memoryByPhase.get('all') ?? [];
for (const phase of phases.filter(p => p !== 'all')) {
  const existing = this.memoryByPhase.get(phase) ?? [];
  this.memoryByPhase.set(phase, [...existing, ...allEntries]);
}

// Per-phase access during the run
private memoryFor(phase: string): string {
  const entries = this.memoryByPhase.get(phase) ?? [];
  return formatMemoryForPrompt(entries);
}
```

## Formatted output example

```
LEARNED RULES FROM PAST RUNS (must follow strictly):
1. MISTAKE: "used walnut in ingredients scene" → CORRECT: "only use ingredients listed on the product page" (e.g. the product page listed jojoba, not walnut)
2. MISTAKE: "product label distorted in hook scene" → CORRECT: "always prefix prompt with EDIT THIS EXACT PRODUCT IMAGE. Preserve every detail: label text, bottle shape, packaging design, colors."
```
