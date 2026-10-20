# Social Art Director Design

## Goal

Replace template-driven social post generation with an intelligent art-direction step that determines what will look good using the user goal, locked product images, brand research, product truth, and relevant trend evidence.

## Inputs

- Original user goal and requested platform
- Locked references with the `product` role only
- Multimodal analysis of product appearance, framing, lighting, background, and negative space
- Researched brand fonts, palette, visual principles, image style, logo rules, approved language, and prohibited language
- Verified product facts and preservation rules
- Selected concept when available
- Relevant, compatible trend evidence

If brand knowledge is missing, Social Post must run brand research before planning. If no product-role image is locked, planning must stop with a clear UI message.

## Planning Stage

Add a Social Art Director stage before copy generation. It produces a structured plan containing:

- Visual strategy and rationale
- Recommended composition and layout
- Treatment of the existing locked image, including crop and extension guidance
- Text decision: `none`, `headline`, or `headline_supporting`
- Exact on-image text when text is recommended
- Text placement and hierarchy
- Brand typography choice
- CTA placement: `none`, `caption_only`, or `on_image`
- Confidence and warnings

The planner must explicitly decide whether text improves the design. It may choose a text-free post when the locked image, brand aesthetic, or concept is stronger without overlays.

## Decision Rules

- Preserve the locked product identity and do not treat style or composition references as products.
- Prefer text-free output when there is insufficient negative space, the image already contains prominent packaging text, or the brand aesthetic favors minimal imagery.
- Use on-image text only when it adds a clear communication benefit and can fit legibly without competing with the product.
- Educational text must use verified product facts.
- Conversion CTAs are allowed only for conversion objectives.
- Internal planning language, rationales, unsupported claims, generic engagement bait, and research descriptions must never become visible copy.
- Brand fonts and visual aesthetics must influence both the plan and final generation prompt.

## Validation

Validate the proposed plan before creating a draft:

- Reject unsupported product claims.
- Reject prohibited brand language.
- Reject internal planning language.
- Reject text that conflicts with the objective.
- Reject on-image text when the plan selects `none`.
- Reject text placements that conflict with the locked-image analysis.
- Fall back to a text-free plan when proposed text is unsafe or low confidence.

## Generation

The final generation request keeps the original user prompt as primary direction. The structured art-direction plan is passed as internal production context.

- For `none`, send no `allowedOnImageText` and explicitly prohibit all generated text.
- For text-bearing plans, allow only the exact validated headline, supporting text, and CTA selected by the plan.
- Apply the chosen brand fonts, layout, composition, palette, lighting, and locked-image preservation instructions.

## UI

Social Post progress must show:

1. Researching brand when needed
2. Analyzing locked product images
3. Reviewing compatible trends
4. Directing the visual and deciding text usage
5. Validating copy and layout
6. Building the draft

Before generation, show the selected visual strategy, text/no-text decision, exact visible copy, typography, layout recommendation, and warnings.

## Testing

- Planner receives brand, product, locked-image, goal, and trend context.
- Planner can choose text-free output.
- Text-free output sends no allowed text and prohibits generated text.
- Text-bearing output allows only exact validated copy.
- Educational plans cannot render conversion CTAs.
- Internal rationale and research descriptions cannot render.
- Missing brand research triggers research before planning.
- Non-product references are excluded from social planning.
