export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch → JSON with a timeout and one polite retry on 429 / transient network errors. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: init.signal ?? ctrl.signal });
      if (res.status === 429 && attempt < 2) {
        const retry = Number(res.headers.get('retry-after')) || 1.5 * (attempt + 1);
        await sleep(retry * 1000);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} — ${url.split('?')[0]}`);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (attempt < 1) {
        await sleep(600);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Run async tasks with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function stripHtml(html: string | null | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
