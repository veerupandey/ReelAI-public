import { describe, expect, it } from 'vitest';
import {
  defaultMotionHint,
  planRecreatePath,
} from '../../services/agentLoop/recreateReferencePath';
import { templateTaskGraph } from '../../services/agentLoop/taskPlanner';
import type { CreativeReferenceUpload } from '../../services/creativeReferenceDirector';

const uploads: CreativeReferenceUpload[] = [
  {
    id: 'r1',
    name: 'frame-0.jpg',
    base64: 'aaa',
    mimeType: 'image/jpeg',
    note: 'hook',
  },
  {
    id: 'r2',
    name: 'frame-1.jpg',
    base64: 'bbb',
    mimeType: 'image/jpeg',
    note: 'body',
  },
];

describe('planRecreatePath', () => {
  it('uses upload_frames when references are provided', () => {
    const plan = planRecreatePath({
      referenceUploads: uploads,
      referenceUrl: 'https://www.instagram.com/reel/abc/',
    });
    expect(plan.ingest).toBe('upload_frames');
    expect(plan.notes.join(' ')).toMatch(/uploaded/i);
  });

  it('uses screenshot-carousel for Instagram URL without uploads', () => {
    const plan = planRecreatePath({
      referenceUploads: [],
      referenceUrl: 'https://www.instagram.com/reel/abc/',
    });
    expect(plan.ingest).toBe('url_screenshot_carousel');
  });

  it('prefers live motion when task graph estimates I2V', () => {
    const graph = templateTaskGraph('recreate_reference_video', 'recreate');
    graph.estimatedLiveMotionScenes = 3;
    const plan = planRecreatePath({
      referenceUploads: uploads,
      taskGraph: graph,
    });
    expect(plan.preferLiveMotionDefault).toBe(true);
    expect(defaultMotionHint(plan)).toBe('wan_i2v');
  });
});
