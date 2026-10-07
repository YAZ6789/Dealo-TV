// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSheet, scriptJsonp, SheetAccessError } from './sheets';

const URL_ = 'https://docs.google.com/spreadsheets/d/1F41YLH-q4C2H9jKQAA1bbA103rHXpXKfapawllKjBL0/edit?usp=sharing';

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = '';
});

describe('scriptJsonp', () => {
  it('injects a script and resolves when Google calls the handler', async () => {
    const p = scriptJsonp(1000)('https://example.test/x?tqx=responseHandler:cb1', 'cb1');
    const script = document.head.querySelector('script');
    expect(script?.src).toContain('responseHandler:cb1');
    (window as unknown as Record<string, (d: unknown) => void>).cb1({ status: 'ok' });
    await expect(p).resolves.toEqual({ status: 'ok' });
    expect(document.head.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).cb1).toBeUndefined();
  });

  it('rejects with SheetAccessError when the script errors (sign-in page)', async () => {
    const p = scriptJsonp(1000)('https://example.test/y', 'cb2');
    document.head.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(p).rejects.toBeInstanceOf(SheetAccessError);
  });

  it('rejects with SheetAccessError when the script loads without calling back', async () => {
    const p = scriptJsonp(1000)('https://example.test/z', 'cb3');
    document.head.querySelector('script')!.dispatchEvent(new Event('load'));
    await expect(p).rejects.toBeInstanceOf(SheetAccessError);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    const p = scriptJsonp(50)('https://example.test/t', 'cb4');
    const assertion = expect(p).rejects.toThrow(/too long/);
    vi.advanceTimersByTime(60);
    await assertion;
  });
});

describe('fetchSheet in the browser', () => {
  it('uses the default script loader as the JSONP fallback', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const p = fetchSheet(URL_, undefined, { fetchImpl });
    // Wait for the script tag to be injected, then answer like Google would.
    await vi.waitFor(() => expect(document.head.querySelector('script')).not.toBeNull());
    const src = document.head.querySelector('script')!.src;
    const cb = decodeURIComponent(src).match(/responseHandler:([\w$]+)/)![1];
    (window as unknown as Record<string, (d: unknown) => void>)[cb]({
      status: 'ok',
      table: { cols: [{ label: 'Show' }, { label: 'Status' }], rows: [{ c: [{ v: 'Dark' }, { v: 'Watched' }] }] },
    });
    await expect(p).resolves.toEqual({ headers: ['Show', 'Status'], rows: [['Dark', 'Watched']] });
  });
});
