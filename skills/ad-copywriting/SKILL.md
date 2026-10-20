---
name: ad-copywriting
description: Write scene-by-scene voiceover scripts for short-form video ads grounded strictly in verified product facts. Enforces platform-native pacing (~2.5 words/sec), second-person tone, and zero invented claims. Use after product-research, before image-generation.
---

# Ad Copywriting

## When to use

- After `product-research` produced a verified `facts[]`
- Planning scenes for any platform
- User gives feedback and a re-plan is needed
- Invoked directly with a URL + style + platform

## Inputs

| Input | Required | Description |
|---|---|---|
| `title` | yes | Product name |
| `facts` | yes | Verified facts array from product page |
| `platform` | yes | `instagram_reels` \| `tiktok` \| `youtube_shorts` |
| `style` | yes | `luxe_minimalist` \| `earthy_organic` \| `high_energy` \| `ugc_style` |
| `durationSec` | yes | 15, 20, 30, 45, or 60 |
| `feedbackHint` | no | Re-plan instruction from user |
| `brandSlug` | no | For brand-scoped memory |

## Instructions

1. Load memory — `readMemory('plan_scenes', brandSlug)` + `readMemory('all', brandSlug)`. Format with `formatMemoryForPrompt()`. Append as `LEARNED RULES` block in the prompt.

2. Compute scene layout:
   - `sceneCount = max(3, min(5, round(durationSec / 6)))`
   - Roles in order: `hook → ritual → ingredients → result → cta`, sliced to `sceneCount`
   - `secPerScene = durationSec / sceneCount`
   - Target words per scene: `floor(secPerScene × 2.5)`

3. Build Gemini prompt including:
   - Product name, duration, platform, style
   - `feedbackHint` if provided
   - Numbered `facts[]` list under `VERIFIED PRODUCT FACTS`
   - The verbatim `STRICT RULE` block (see Constraints)
   - Memory block
   - Instruction to return a JSON array of `sceneCount` strings only

4. Parse the JSON array from Gemini's response.

5. Build `ScenePlan[]` — for each scene:
   - `role`, `voiceoverText`, `targetDurationSec`, `actualDurationSec`
   - `imagePrompt` from `SCENE_PROMPTS[role](title, factsText)` in `autonomousAgent.ts`
   - `useProductAsReference: role !== 'result'`

6. Emit plan markdown: scene count, estimated voiceover duration, each scene's role + word count + voiceover text as a blockquote.

7. Gate — ask user to approve or give feedback. If feedback is structural (scene count/order changes) → full re-plan. If patch (tone/wording changes) → call `interpretFeedback()` and apply patches only.

8. Loop until user approves with no further feedback.

## Platform pacing

| Platform | Hook | Pacing | Tone |
|---|---|---|---|
| `instagram_reels` | Visual pull | Moderate, breathable | Premium, second-person |
| `tiktok` | Pattern interrupt | Fast, punchy, proof-first | Creator-native, direct |
| `youtube_shorts` | Spoken hook within 2s | Slightly explanatory | Benefit-led, clear |

## Constraints

Include this block verbatim in every script prompt:

```
STRICT RULE: Only use ingredients, benefits, and claims from VERIFIED PRODUCT FACTS above.
- "jojoba oil" in facts → you may write it. You may NOT write "walnut" or any oil not listed.
- No "clinically proven" unless in facts.
- No statistics or percentages unless in facts.
- Visual implications count as claims — do not imply efficacy beyond what facts support.
- Each line ≤10 words. Conversational, no slogans. End the final scene with the brand name.
```

**NEVER**:
- Invent an ingredient not in `facts[]`
- Write more words than `floor(targetDurationSec × 2.5)` per scene
- Return anything other than a JSON string array when asked for the plan
- Proceed to image generation without explicit user approval

## Success criteria

- Plan has exactly `sceneCount` scenes
- Every voiceover line traces to ≥1 entry in `facts[]`
- Estimated voiceover (words ÷ 2.5) is within ±15% of `durationSec`
- User explicitly approved the plan
