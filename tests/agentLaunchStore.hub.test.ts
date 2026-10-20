import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearPendingHubLaunch,
  peekAgentLaunchHeavy,
  peekPendingHubLaunch,
  prepareHubAgentLaunchForSessionStorage,
  stashPendingHubLaunch,
  takeAgentLaunchHeavy,
} from '../services/agentLaunchStore';

describe('prepareHubAgentLaunchForSessionStorage', () => {
  it('stashes product packshot and strips base64 from lean params', () => {
    const { launchId, params } = prepareHubAgentLaunchForSessionStorage({
      productUrl: '',
      adFormat: 'stitched_video',
      productBase64: 'abc123packshot',
      productMimeType: 'image/jpeg',
      productTitle: 'Matcha tin',
      referenceUploads: [
        {
          id: 'ref1',
          name: 'mood.jpg',
          base64: 'refbytes',
          mimeType: 'image/jpeg',
          note: 'mood',
        },
      ],
    });

    expect(params.productBase64).toBeUndefined();
    expect(params.productMimeType).toBe('image/jpeg');
    expect(params.productTitle).toBe('Matcha tin');
    expect((params.referenceUploads as Array<{ base64: string }>)[0].base64).toBe('');

    const heavy = takeAgentLaunchHeavy(launchId);
    expect(heavy?.productBase64).toBe('abc123packshot');
    expect(heavy?.referenceUploads[0].base64).toBe('refbytes');
    expect(peekAgentLaunchHeavy(launchId)).toBeUndefined();
  });

  it('passes through when there are no binaries', () => {
    const input = { productUrl: 'https://example.com/p', adFormat: 'stitched_video' };
    const { params, launchId } = prepareHubAgentLaunchForSessionStorage(input);
    expect(params).toEqual(input);
    expect(takeAgentLaunchHeavy(launchId)).toBeUndefined();
  });
});

describe('pending Hub launch envelope', () => {
  beforeEach(() => {
    clearPendingHubLaunch();
  });

  it('survives a remount-style double peek (sessionStorage consumed once)', () => {
    const envelope = prepareHubAgentLaunchForSessionStorage({
      productUrl: 'https://example.com/p',
      hubLaunch: true,
      userDirection: 'Keep my words',
      creativeBrief: 'Locked brief',
      autoStart: true,
    });
    stashPendingHubLaunch(envelope);

    const first = peekPendingHubLaunch();
    const second = peekPendingHubLaunch();
    expect(first?.params.userDirection).toBe('Keep my words');
    expect(second?.params.creativeBrief).toBe('Locked brief');
    expect(first?.launchId).toBe(second?.launchId);

    clearPendingHubLaunch();
    expect(peekPendingHubLaunch()).toBeNull();
  });
});
