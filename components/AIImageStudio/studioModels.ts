/**
 * Shared Gemini model IDs for Image Studio.
 * - Research/grounded paths: Gemini Flash with Google Search.
 * - Flash paths: GA Gemini 3.8 Flash (Oct 2026) for fast creative/generation helpers.
 * Image generation is config-driven via services/llm/imageModel (default
 * `gemini-nano-banana-2.1`; overridable in UI / env).
 * Planner/agent text models are separate — see services/llm/.
 */
export const STUDIO_FLASH_MODEL = 'gemini-3.8-flash';
export const STUDIO_RESEARCH_MODEL = STUDIO_FLASH_MODEL;
