export type RetryOptions = {
  retries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextDelay(base: number, attempt: number, maxDelay: number) {
  const exp = Math.min(maxDelay, base * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * Math.max(50, Math.floor(exp * 0.2)));
  return exp + jitter;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const retries = options?.retries ?? 2;
  const initialDelayMs = options?.initialDelayMs ?? 400;
  const maxDelayMs = options?.maxDelayMs ?? 3000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) {
        return res;
      }
    } catch (e) {
      lastErr = e;
      if (attempt === retries) throw e;
    }
    const delay = nextDelay(initialDelayMs, attempt, maxDelayMs);
    await sleep(delay);
  }

  if (lastErr) throw lastErr;
  throw new Error("fetchWithRetry failed unexpectedly");
}

