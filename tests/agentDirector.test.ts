import { describe, expect, it } from 'vitest';
import { looksLikeOpenEndedAgentAsk } from '../services/agentDirector';

describe('looksLikeOpenEndedAgentAsk', () => {
  it('routes ops / script asks to the director', () => {
    expect(looksLikeOpenEndedAgentAsk('list session files and probe final.mp4')).toBe(true);
    expect(looksLikeOpenEndedAgentAsk('fix audio loudness with ffmpeg')).toBe(true);
    expect(looksLikeOpenEndedAgentAsk('what can you do')).toBe(true);
  });

  it('leaves selective visual/voice redos to the pipeline', () => {
    expect(looksLikeOpenEndedAgentAsk('use live motion on all scenes')).toBe(false);
    expect(looksLikeOpenEndedAgentAsk('change the model')).toBe(false);
    expect(looksLikeOpenEndedAgentAsk('regen audio with Gen Z female')).toBe(false);
  });
});
