import type { LlmKeySlot, PlannerModelId } from './types';
import { coercePlannerModelId, DEFAULT_PLANNER_MODEL } from './types';
import { keySlotForPlannerModel } from './catalog';

const KEYS_STORAGE = 'reelai.llm.apiKeys.v1';
const BASE_STORAGE = 'reelai.llm.baseUrls.v1';
const MODEL_OVERRIDE_STORAGE = 'reelai.llm.modelOverrides.v1';
const PREFERRED_PLANNER_STORAGE = 'reelai.llm.preferredPlanner.v1';

type StringMap = Partial<Record<string, string>>;

function readMap(storageKey: string): StringMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StringMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(storageKey: string, map: StringMap): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

export function getStoredProviderApiKey(slot: LlmKeySlot): string {
  return (readMap(KEYS_STORAGE)[slot] || '').trim();
}

export function setStoredProviderApiKey(slot: LlmKeySlot, key: string): void {
  const map = readMap(KEYS_STORAGE);
  const trimmed = key.trim();
  if (trimmed) map[slot] = trimmed;
  else delete map[slot];
  writeMap(KEYS_STORAGE, map);
}

/** Optional OpenAI-compatible base URL override per planner choice. */
export function getStoredBaseUrl(modelId: PlannerModelId): string {
  return (readMap(BASE_STORAGE)[modelId] || '').trim();
}

export function setStoredBaseUrl(modelId: PlannerModelId, baseUrl: string): void {
  const map = readMap(BASE_STORAGE);
  const trimmed = baseUrl.trim().replace(/\/$/, '');
  if (trimmed) map[modelId] = trimmed;
  else delete map[modelId];
  writeMap(BASE_STORAGE, map);
}

/** Optional model id override (for custom OpenAI-compatible endpoints). */
export function getStoredModelOverride(modelId: PlannerModelId): string {
  return (readMap(MODEL_OVERRIDE_STORAGE)[modelId] || '').trim();
}

export function setStoredModelOverride(modelId: PlannerModelId, model: string): void {
  const map = readMap(MODEL_OVERRIDE_STORAGE);
  const trimmed = model.trim();
  if (trimmed) map[modelId] = trimmed;
  else delete map[modelId];
  writeMap(MODEL_OVERRIDE_STORAGE, map);
}

/** Last selected text model across Ad Agent / Text-to-Reel / Image Studio. */
export function getStoredPreferredPlannerModel(): PlannerModelId | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(PREFERRED_PLANNER_STORAGE);
    if (!raw) return undefined;
    return coercePlannerModelId(raw, DEFAULT_PLANNER_MODEL);
  } catch {
    return undefined;
  }
}

export function setStoredPreferredPlannerModel(modelId: PlannerModelId): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      PREFERRED_PLANNER_STORAGE,
      coercePlannerModelId(modelId, DEFAULT_PLANNER_MODEL),
    );
  } catch {
    // ignore quota / private mode
  }
}

/** Resolve API key for a planner/agent model preference (UI storage first). */
export function resolveApiKeyForModel(
  modelId: PlannerModelId,
  override?: string,
): string {
  const trimmed = (override || '').trim();
  if (trimmed) return trimmed;
  return getStoredProviderApiKey(keySlotForPlannerModel(modelId));
}
