/**
 * Instagram Publishing Service
 *
 * Integrates with the Instagram Graph API to:
 * 1. Publish single-image posts to the Instagram feed
 * 2. Publish multi-image carousel posts
 * 3. Schedule posts for later publishing
 * 4. Query the authenticated user's media for insights
 *
 * Requires a Facebook Page access token and an Instagram Business/Creator account
 * connected to that page. See:
 *   https://developers.facebook.com/docs/instagram-api
 *
 * Env vars needed:
 *   VITE_IG_ACCESS_TOKEN  — long-lived access token
 *   VITE_IG_BUSINESS_ACCOUNT_ID — numeric IG business account ID
 *
 * For production, these should be stored server-side (e.g. Supabase edge function)
 * to avoid exposing the token in the browser. This client-side implementation
 * works for development/prototyping.
 */

export interface InstagramMediaContainer {
  id: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
}

export interface InstagramPublishResult {
  id: string;
  permalink?: string;
  status: 'published' | 'scheduled' | 'failed';
  error?: string;
}

export interface InstagramScheduledPost {
  id: string;
  scheduledTime: string;
  caption: string;
  imageUrls: string[];
  status: 'scheduled' | 'publishing' | 'published' | 'failed';
  publishedMediaId?: string;
  permalink?: string;
  error?: string;
  createdAt: string;
}

const IG_API_BASE = 'https://graph.facebook.com/v21.0';

function getAccessToken(): string {
  return import.meta.env.VITE_IG_ACCESS_TOKEN || '';
}

function getBusinessAccountId(): string {
  return import.meta.env.VITE_IG_BUSINESS_ACCOUNT_ID || '';
}

export function isInstagramConfigured(): boolean {
  return Boolean(getAccessToken() && getBusinessAccountId());
}

/**
 * Upload a single image to Instagram as a media container.
 * The image must be hosted at a publicly accessible URL.
 */
async function createMediaContainer(
  imageUrl: string,
  caption?: string,
  isCarouselItem = false,
): Promise<string> {
  const accountId = getBusinessAccountId();
  const token = getAccessToken();

  const params: Record<string, string> = {
    image_url: imageUrl,
    access_token: token,
  };

  if (!isCarouselItem && caption) {
    params.caption = caption;
  }

  if (isCarouselItem) {
    params.is_carousel_item = 'true';
  }

  const response = await fetch(`${IG_API_BASE}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Instagram media creation failed: ${data.error.message}`);
  }

  return data.id;
}

/**
 * Create a carousel container that references multiple media containers.
 */
async function createCarouselContainer(
  childMediaIds: string[],
  caption: string,
): Promise<string> {
  const accountId = getBusinessAccountId();
  const token = getAccessToken();

  const params = {
    media_type: 'CAROUSEL',
    children: childMediaIds.join(','),
    caption,
    access_token: token,
  };

  const response = await fetch(`${IG_API_BASE}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Instagram carousel creation failed: ${data.error.message}`);
  }

  return data.id;
}

/**
 * Publish a media container to Instagram.
 */
async function publishMediaContainer(
  mediaId: string,
): Promise<InstagramPublishResult> {
  const accountId = getBusinessAccountId();
  const token = getAccessToken();

  const response = await fetch(`${IG_API_BASE}/${accountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: mediaId,
      access_token: token,
    }),
  });

  const data = await response.json();
  if (data.error) {
    return {
      id: mediaId,
      status: 'failed',
      error: data.error.message,
    };
  }

  return {
    id: data.id,
    status: 'published',
  };
}

/**
 * Publish a single image post to Instagram.
 *
 * @param imageUrl - Publicly accessible URL of the image
 * @param caption - Post caption (max 2200 chars, hashtags included)
 */
export async function publishSingleImage(
  imageUrl: string,
  caption: string,
): Promise<InstagramPublishResult> {
  if (!isInstagramConfigured()) {
    return {
      id: '',
      status: 'failed',
      error: 'Instagram API not configured. Set VITE_IG_ACCESS_TOKEN and VITE_IG_BUSINESS_ACCOUNT_ID.',
    };
  }

  try {
    const containerId = await createMediaContainer(imageUrl, caption);
    // Wait for media processing (Instagram needs time to fetch the image)
    await waitForMediaReady(containerId);
    return await publishMediaContainer(containerId);
  } catch (error: any) {
    return {
      id: '',
      status: 'failed',
      error: error.message,
    };
  }
}

/**
 * Publish a multi-image carousel post to Instagram.
 *
 * @param imageUrls - Array of publicly accessible image URLs (1-10 images)
 * @param caption - Post caption (max 2200 chars)
 */
export async function publishCarousel(
  imageUrls: string[],
  caption: string,
): Promise<InstagramPublishResult> {
  if (!isInstagramConfigured()) {
    return {
      id: '',
      status: 'failed',
      error: 'Instagram API not configured. Set VITE_IG_ACCESS_TOKEN and VITE_IG_BUSINESS_ACCOUNT_ID.',
    };
  }

  if (imageUrls.length === 0) {
    return { id: '', status: 'failed', error: 'No images provided' };
  }

  if (imageUrls.length > 10) {
    return { id: '', status: 'failed', error: 'Maximum 10 images per carousel' };
  }

  try {
    // Create individual media containers for each image
    const childIds: string[] = [];
    for (const url of imageUrls) {
      const childId = await createMediaContainer(url, undefined, true);
      childIds.push(childId);
    }

    // Wait for all children to be ready
    await Promise.all(childIds.map((id) => waitForMediaReady(id)));

    // Create the carousel container
    const carouselId = await createCarouselContainer(childIds, caption);

    // Wait for carousel container to be ready
    await waitForMediaReady(carouselId);

    // Publish
    return await publishMediaContainer(carouselId);
  } catch (error: any) {
    return {
      id: '',
      status: 'failed',
      error: error.message,
    };
  }
}

/**
 * Poll the media container status until it's ready for publishing.
 * Instagram needs to fetch and process the image from the provided URL.
 */
async function waitForMediaReady(
  mediaId: string,
  maxAttempts = 30,
  intervalMs = 3000,
): Promise<void> {
  const token = getAccessToken();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `${IG_API_BASE}/${mediaId}?fields=status_code&access_token=${token}`,
    );
    const data = await response.json();

    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') {
      throw new Error(`Instagram media processing failed for container ${mediaId}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Instagram media processing timed out for container ${mediaId}`);
}

/**
 * Get recent media from the authenticated Instagram account.
 */
export async function getRecentMedia(limit = 12): Promise<InstagramMediaContainer[]> {
  if (!isInstagramConfigured()) return [];

  const accountId = getBusinessAccountId();
  const token = getAccessToken();

  const response = await fetch(
    `${IG_API_BASE}/${accountId}/media?fields=id,media_type,media_url,permalink,caption,timestamp&limit=${limit}&access_token=${token}`,
  );
  const data = await response.json();

  if (data.error) {
    console.warn('[instagramPublishService] Failed to fetch media:', data.error.message);
    return [];
  }

  return data.data || [];
}

/**
 * Get insights (impressions, reach, engagement) for a published post.
 */
export async function getMediaInsights(mediaId: string): Promise<{
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  saved: number;
}> {
  if (!isInstagramConfigured()) {
    return { impressions: 0, reach: 0, likes: 0, comments: 0, saved: 0 };
  }

  const token = getAccessToken();

  const response = await fetch(
    `${IG_API_BASE}/${mediaId}/insights?metric=impressions,reach,likes,comments,saved&access_token=${token}`,
  );
  const data = await response.json();

  if (data.error) {
    console.warn('[instagramPublishService] Failed to fetch insights:', data.error.message);
    return { impressions: 0, reach: 0, likes: 0, comments: 0, saved: 0 };
  }

  const insights: Record<string, number> = {};
  for (const item of data.data || []) {
    insights[item.name] = item.values?.[0]?.value || 0;
  }

  return {
    impressions: insights.impressions || 0,
    reach: insights.reach || 0,
    likes: insights.likes || 0,
    comments: insights.comments || 0,
    saved: insights.saved || 0,
  };
}

// ── Scheduling (client-side queue) ───────────────────────────────────────────

const SCHEDULED_POSTS_KEY = 'reelai_scheduled_posts';

export function getScheduledPosts(): InstagramScheduledPost[] {
  try {
    const raw = localStorage.getItem(SCHEDULED_POSTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveScheduledPosts(posts: InstagramScheduledPost[]): void {
  localStorage.setItem(SCHEDULED_POSTS_KEY, JSON.stringify(posts));
}

export function schedulePost(
  scheduledTime: string,
  caption: string,
  imageUrls: string[],
): InstagramScheduledPost {
  const post: InstagramScheduledPost = {
    id: `scheduled_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    scheduledTime,
    caption,
    imageUrls,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
  };

  const posts = getScheduledPosts();
  posts.push(post);
  saveScheduledPosts(posts);

  return post;
}

export function cancelScheduledPost(postId: string): void {
  const posts = getScheduledPosts().filter((p) => p.id !== postId);
  saveScheduledPosts(posts);
}

export function updateScheduledPostStatus(
  postId: string,
  status: InstagramScheduledPost['status'],
  updates?: Partial<InstagramScheduledPost>,
): void {
  const posts = getScheduledPosts().map((p) =>
    p.id === postId ? { ...p, status, ...updates } : p,
  );
  saveScheduledPosts(posts);
}

/**
 * Check for due scheduled posts and publish them.
 * Returns the results of publishing attempts.
 */
export async function processDueScheduledPosts(): Promise<InstagramScheduledPost[]> {
  const posts = getScheduledPosts();
  const now = new Date();
  const results: InstagramScheduledPost[] = [];

  for (const post of posts) {
    if (post.status !== 'scheduled') continue;

    const scheduledDate = new Date(post.scheduledTime);
    if (scheduledDate <= now) {
      updateScheduledPostStatus(post.id, 'publishing');
      const result =
        post.imageUrls.length > 1
          ? await publishCarousel(post.imageUrls, post.caption)
          : await publishSingleImage(post.imageUrls[0], post.caption);

      if (result.status === 'published') {
        updateScheduledPostStatus(post.id, 'published', {
          publishedMediaId: result.id,
          permalink: result.permalink,
        });
        results.push({ ...post, status: 'published', publishedMediaId: result.id });
      } else {
        updateScheduledPostStatus(post.id, 'failed', { error: result.error });
        results.push({ ...post, status: 'failed', error: result.error });
      }
    }
  }

  return results;
}

/**
 * Start a background timer that checks for due scheduled posts every minute.
 */
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    processDueScheduledPosts().catch((err) => {
      console.warn('[instagramPublishService] Scheduler error:', err);
    });
  }, 60_000);
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
