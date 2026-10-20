/**
 * Intent Router
 * Takes free-text user input → selects the right agent + extracts params.
 * Falls back to null if confidence is low (AgentHub shows card picker instead).
 */

import { GoogleGenAI } from '@google/genai';
import type { AgentAvailability } from './agentRegistry';
import type { AgentDefinition } from './agentDefinitions';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });
const MODEL = import.meta.env.VITE_SUBAGENT_MODEL || 'gemini-3.8-flash';

export interface RouteResult {
  agentId: string;
  confidence: number;          // 0–1
  extractedParams: Record<string, string | number | boolean>;
  reasoning: string;           // shown in hub so user understands why
}

export interface RouterResponse {
  route: RouteResult | null;   // null = couldn't route with confidence
  clarifyQuestion?: string;    // if null, optionally ask the user this
}

/**
 * Route free-text intent to an agent.
 * @param input - raw user message
 * @param availableAgents - agents that are currently available (tools online)
 */
export const routeIntent = async (
  input: string,
  availableAgents: AgentAvailability[],
): Promise<RouterResponse> => {
  if (!input.trim()) return { route: null };

  // Route against ALL agents regardless of availability — the UI handles the unavailable state
  const agentDescriptions = availableAgents.map((a) => ({
    id: a.agent.id,
    name: a.agent.name,
    description: a.agent.description,
    capabilities: a.agent.capabilities,
    examplePrompts: a.agent.examplePrompts,
  }));

  if (agentDescriptions.length === 0) return { route: null, clarifyQuestion: 'No agents are registered.' };

  const prompt = `You are an intent router for an AI creative platform. 
A user typed a message. Your job is to identify which agent should handle it and extract any parameters.

AVAILABLE AGENTS:
${JSON.stringify(agentDescriptions, null, 2)}

USER INPUT: "${input}"

Return ONLY a JSON object with this exact shape:
{
  "agentId": "<id of best matching agent, or null if unclear>",
  "confidence": <0.0 to 1.0>,
  "extractedParams": {
    // any parameters you can confidently extract from the input
    // e.g. "productUrl": "https://...", "platform": "tiktok", "durationSec": 30
    // "adFormat": "static_image" | "carousel" | "stitched_video" | "veo3_video"
    // only include params you are confident about
    // if user says "carousel", "static image", "feed post", "AI video", or "veo3", set adFormat accordingly
    // if user says "video ad" or "reel" etc., set adFormat to "stitched_video"
  },
  "reasoning": "<one sentence: why you chose this agent>",
  "clarifyQuestion": "<if confidence < 0.6, what would you ask the user to clarify? otherwise null>"
}`;

  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: [{ parts: [{ text: prompt }] }],
    });
    const text = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { route: null };

    const parsed = JSON.parse(match[0]);
    const confidence = parsed.confidence ?? 0;

    if (!parsed.agentId || confidence < 0.5) {
      return {
        route: null,
        clarifyQuestion: parsed.clarifyQuestion || 'Could you give me more details about what you want to create?',
      };
    }

    return {
      route: {
        agentId: parsed.agentId,
        confidence,
        extractedParams: parsed.extractedParams || {},
        reasoning: parsed.reasoning || '',
      },
      clarifyQuestion: confidence < 0.75 ? parsed.clarifyQuestion : undefined,
    };
  } catch {
    return { route: null };
  }
};

/** Pre-fill a uiSchema field map from extracted params. */
export const mergeExtractedParams = (
  agent: AgentDefinition,
  extractedParams: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> => {
  const defaults: Record<string, string | number | boolean> = {};
  for (const field of agent.uiSchema) {
    if (field.defaultValue !== undefined) defaults[field.id] = field.defaultValue;
  }
  return { ...defaults, ...extractedParams };
};
