import { productError, type ProductImageProvider } from './core.js';

export type ImageProvider = ProductImageProvider;

interface JobSet {
  id?: string;
  jobs?: { status?: string; results?: { raw?: { url?: string } } }[];
}
interface CustomReference { id?: string; status?: string; }
export interface HiggsfieldConfig { apiKey?: string; apiSecret?: string; baseUrl?: string; }

/** The existing Soul API protocol: one paid submission, followed by read-only polling. */
export function createHiggsfieldImageProvider(config: HiggsfieldConfig, options: {
  fetch?: typeof fetch; pollIntervalMs?: number; timeoutMs?: number; maxPollAttempts?: number;
} = {}): ImageProvider {
  const request = options.fetch ?? fetch;
  const interval = options.pollIntervalMs ?? 2500;
  const timeout = options.timeoutMs ?? 600_000;
  const maxAttempts = options.maxPollAttempts ?? 240;
  const cancellation = new AbortController();
  const baseUrl = (config.baseUrl ?? 'https://platform.higgsfield.ai').replace(/\/$/, '');
  const imageError = () => productError('IMAGE_API_ERROR');
  const requireConfigured = () => {
    if (!config.apiKey?.trim() || !config.apiSecret?.trim()) throw imageError();
  };
  async function call<T>(path: string, body?: unknown): Promise<T> {
    requireConfigured();
    if (cancellation.signal.aborted) throw imageError();
    try {
      const response = await request(`${baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: { Authorization: `Key ${config.apiKey}:${config.apiSecret}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(60_000)]),
      });
      if (!response.ok) throw imageError();
      return await response.json() as T;
    } catch { throw imageError(); }
  }
  return {
    requireConfigured,
    cancel() { cancellation.abort(); },
    async generateImages(prompt, referenceImageUrl, count, soulId = null) {
      const result = await call<JobSet>('/v1/text2image/soul', { params: {
        prompt, width_and_height: '1536x2048', quality: '1080p', batch_size: count >= 4 ? 4 : 1,
        // Soul's prompt enhancer pushes every portrait toward the same golden-hour, film look.
        // Send the authored prompt as written so scene, outfit and lighting come from the character.
        enhance_prompt: false,
        ...(referenceImageUrl?.trim() ? { image_reference: { type: 'image_url', image_url: referenceImageUrl } } : {}),
        ...(soulId === null ? {} : { custom_reference_id: soulId, custom_reference_strength: 1.0 }),
      } });
      if (!result?.id) throw imageError();
      const deadline = Date.now() + timeout;
      const terminal = new Set(['completed', 'failed', 'nsfw', 'canceled']);
      for (let attempt = 0; attempt < maxAttempts && Date.now() < deadline; attempt++) {
        const status = await call<JobSet>(`/v1/job-sets/${encodeURIComponent(result.id)}`);
        const jobs = status?.jobs ?? [];
        if (jobs.length > 0 && jobs.every(job => terminal.has(job.status?.toLowerCase() ?? ''))) {
          const urls = jobs.filter(job => job.status?.toLowerCase() === 'completed')
            .map(job => job.results?.raw?.url).filter((url): url is string => typeof url === 'string' && !!url.trim());
          if (urls.length > 0) return urls;
          throw imageError();
        }
        await new Promise<void>((resolve, reject) => {
          if (cancellation.signal.aborted) { reject(imageError()); return; }
          const abort = () => { clearTimeout(timer); reject(imageError()); };
          const timer = setTimeout(() => { cancellation.signal.removeEventListener('abort', abort); resolve(); }, interval);
          cancellation.signal.addEventListener('abort', abort, { once: true });
        });
      }
      throw imageError();
    },
    async trainSoul(referenceImageUrl) {
      const result = await call<CustomReference>('/v1/custom-references', {
        name: 'everyday-character', input_images: [{ type: 'image_url', image_url: referenceImageUrl }],
      });
      if (!result?.id) throw imageError();
      return result.id;
    },
    async soulReady(soulId) {
      const result = await call<CustomReference>(`/v1/custom-references/${encodeURIComponent(soulId)}`);
      if (result?.id !== soulId || result.status?.toLowerCase() === 'failed') throw imageError();
      return result.status?.toLowerCase() === 'completed';
    },
  };
}
