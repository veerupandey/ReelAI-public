import { describe, expect, it } from 'vitest';
import { getCompatiblePlatform, getVisibleAdAgentFieldIds } from '../components/AgentHub';

describe('AgentHub format-aware form', () => {
  it('hides video-only controls for carousel and static formats', () => {
    expect(getVisibleAdAgentFieldIds('carousel')).not.toContain('durationSec');
    expect(getVisibleAdAgentFieldIds('carousel')).not.toContain('voice');
    expect(getVisibleAdAgentFieldIds('static_image')).not.toContain('durationSec');
    expect(getVisibleAdAgentFieldIds('stitched_video')).toContain('voice');
    expect(getVisibleAdAgentFieldIds('stitched_video')).toContain('plannerModel');
    expect(getVisibleAdAgentFieldIds('stitched_video')).toContain('preferLiveMotion');
    expect(getVisibleAdAgentFieldIds('stitched_video')).toContain('liveMotionModelId');
    expect(getVisibleAdAgentFieldIds('carousel')).not.toContain('preferLiveMotion');
    expect(getVisibleAdAgentFieldIds('carousel')).not.toContain('liveMotionModelId');
    expect(getVisibleAdAgentFieldIds('veo3_video')).not.toContain('preferLiveMotion');
    expect(getVisibleAdAgentFieldIds('stitched_video')).toContain('vibe');
    expect(getVisibleAdAgentFieldIds('carousel')).not.toContain('vibe');
  });

  it('locks formats to compatible platforms', () => {
    expect(getCompatiblePlatform('carousel', 'instagram_reels')).toBe('instagram_carousel');
    expect(getCompatiblePlatform('static_image', 'tiktok')).toBe('instagram_feed');
    expect(getCompatiblePlatform('stitched_video', 'instagram_carousel')).toBe('instagram_reels');
  });
});
