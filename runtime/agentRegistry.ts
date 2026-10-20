/**
 * Agent Registry
 * Single source of truth for shippable Agent Hub agents.
 * Agents need a wired runner before registration.
 *
 * Paths:
 *   ad-agent      → AgentConsole → AutonomousAgent (HITL ad pipeline)
 *   general-agent → GeneralAgentConsole → GeneralPurposeAgent (Autonomous)
 */

import { AD_AGENT, GENERAL_PURPOSE_AGENT, type AgentDefinition } from './agentDefinitions';
import { isToolAvailable } from './toolExecutor';
import type { AgentToolId } from '../agents/contracts';

/** Agents exposed in Agent Hub. Add a runner before registering anything new. */
const ALL_AGENTS: AgentDefinition[] = [AD_AGENT, GENERAL_PURPOSE_AGENT];

export interface AgentAvailability {
  agent: AgentDefinition;
  available: boolean;
  unavailableTools: AgentToolId[];
}

/** Get all agents with live availability status. */
export const getAgentsWithAvailability = async (): Promise<AgentAvailability[]> => {
  return Promise.all(
    ALL_AGENTS.map(async (agent) => {
      const toolChecks = await Promise.all(
        agent.requiredTools.map(async (tool) => ({
          tool,
          ok: await isToolAvailable(tool),
        }))
      );
      const unavailableTools = toolChecks.filter((t) => !t.ok).map((t) => t.tool);
      return { agent, available: unavailableTools.length === 0, unavailableTools };
    })
  );
};

/** Get agent by ID. Returns undefined if not registered. */
export const getAgent = (id: string): AgentDefinition | undefined =>
  ALL_AGENTS.find((a) => a.id === id);

/** All registered agent definitions (no availability check). */
export const getAllAgents = (): AgentDefinition[] => [...ALL_AGENTS];

/** Register a new agent at runtime. Prefer adding to ALL_AGENTS with a wired runner. */
export const registerAgent = (agent: AgentDefinition): void => {
  if (ALL_AGENTS.find((a) => a.id === agent.id)) {
    console.warn(`[AgentRegistry] Agent '${agent.id}' already registered — skipping.`);
    return;
  }
  ALL_AGENTS.push(agent);
};
