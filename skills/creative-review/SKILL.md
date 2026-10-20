---
name: creative-review
description: AI quality assurance check on the assembled video before delivery. Uses Gemini to score the video on factual accuracy, pacing, narrative arc, platform fit, and CTA presence. If issues are found, presents them to the user who can approve as-is or give feedback for a targeted re-stitch.
---

# Creative Review

## When to use

- After `caption-design` produces `captioned.mp4`
- Before `platform-export`
- Can be re-run after a re-stitch triggered by user feedback

## Inputs

| Input | Required | Description |
|---|---|---|
| `videoAbsPath` | yes | Absolute path to `captioned.mp4` |
| `scenes` | yes | `ScenePlan[]` with `voiceoverText` and `role` |
| `facts` | yes | Verified facts array from research phase |
| `platform` | yes | Target platform |
| `config` | yes | `AgentConfig` (style, durationSec, etc.) |

## Instructions

1. **Build review prompt** — pass the full scene plan (roles + voiceover text) and `facts[]` to Gemini:
   ```
   You are a senior creative director reviewing a short-form video ad.

   Target platform: {platform}
   Target duration: {durationSec}s
   Style: {style}

   VERIFIED PRODUCT FACTS (ground truth):
   {facts numbered list}

   SCENE PLAN:
   Scene 1 (hook): "{voiceoverText}"
   Scene 2 (ritual): "{voiceoverText}"
   ...

   Review this ad on these dimensions. Score each 1-10:
   1. Factual accuracy — does any line claim something not in verified facts?
   2. Hook strength — does scene 1 create a pattern interrupt within 2 seconds?
   3. Narrative arc — does the ad flow hook → proof → emotion → CTA?
   4. Platform fit — is the pacing and tone native to {platform}?
   5. CTA presence — does the final scene have a clear call to action?

   Return JSON: { overallScore, issues: [{ scene, dimension, description, severity: 'critical'|'warning' }], approved: boolean }
   approved = true only if overallScore >= 7 AND no critical issues.
   ```

2. **Parse response** — extract `{ overallScore, issues, approved }`.

3. **If `approved === true`** — log: "AI review passed (score {overallScore}/10)." Proceed to `platform-export`.

4. **If `approved === false`** — emit review results as markdown showing score and each issue. Gate the user:
   - "Approve as-is" → proceed to export
   - "Give feedback" → collect feedback text, call `interpretFeedback()`, patch the affected scenes, re-generate only those scenes, re-assemble, re-run `creative-review`

5. **On re-review** — if score improves and no critical issues remain, auto-proceed. If score drops, surface to user again.

## Review dimensions

| Dimension | Critical threshold | Warning threshold |
|---|---|---|
| Factual accuracy | Any invented claim | Any unverifiable claim |
| Hook strength | No hook at all | Weak hook (takes >3s) |
| Narrative arc | Scenes are random | Missing CTA |
| Platform fit | Wrong aspect ratio | Wrong pacing for platform |
| CTA presence | No CTA in any scene | CTA is implicit only |

## Constraints

- **NEVER** auto-deliver a video with `overallScore < 7` — always gate the user
- **NEVER** mark factual accuracy as passing if any voiceover line contains an ingredient not in `facts[]`
- **NEVER** run review on raw `final.mp4` — always review the captioned version (`captioned.mp4`)
- If Gemini review call fails: log warning, show manual checklist to user, let them approve/reject manually
- Maximum 2 auto-retry cycles — after 2 failed re-stitches, let user decide to accept or abandon

## Success criteria

- `overallScore >= 7` with no critical issues, OR user explicitly approves despite lower score
- Factual accuracy dimension has no critical issues
- CTA is present in the final scene
- User has seen the review results before export proceeds
