# Ad Agent Creative Reference Director

## Goal

Allow users to upload visual references that the autonomous ad agent analyzes and assigns to the right scenes while preserving verified product identity, intended use, and brand truth.

## Research Principles

- Treat uploaded images as a structured creative asset library, not as universal generation inputs.
- Use no more than three generation references per scene: product identity, style/brand, and composition/lifestyle.
- Generate placement-specific creative rather than converting every request to video.
- Keep verified product facts and intended use above trends and visual inspiration.
- Explain reference assignments before generation so users can understand the agent's direction.

## Architecture

`AgentConsole` reads uploaded images and sends them with the run request. A focused `creativeReferenceDirector` service analyzes references using Gemini multimodal understanding, classifies their role, and selects relevant references for each planned scene. `AutonomousAgent` injects the analysis into planning prompts, displays assignment rationale, and sends selected references through the existing composite image-generation API.

## Data Model

Each reference stores an id, filename, base64, MIME type, user note, inferred role, description, preserve instructions, avoid instructions, and confidence.

Supported roles:

- `product_identity`
- `brand_identity`
- `style_reference`
- `composition_reference`
- `lifestyle_reference`
- `avoid_reference`

## Decision Priority

1. Verified product facts and intended use
2. Exact product identity
3. Brand identity and approved claims
4. User instructions and uploaded references
5. Platform requirements
6. Research-backed trends
7. General creative defaults

## Scene Assignment

The director selects at most two uploaded references per scene, leaving room for the imported product reference. Avoid references are converted into prompt constraints and never attached to generation requests.

Assignments are shown during scene planning with a short reason. Product identity is always preserved when the product appears.

## Error Handling

Unreadable files are rejected in the UI. Failed AI analysis falls back to deterministic classification from the user's note and filename. Reference analysis failure never blocks ad creation.

## Testing

- Unit-test deterministic fallback classification and scene assignment.
- Test that generation requests use composite mode and never exceed three references.
- Test that avoid references become prompt constraints and are not attached.
- Verify the production build.
