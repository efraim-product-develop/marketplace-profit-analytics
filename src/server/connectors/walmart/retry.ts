import { WalmartApiError } from "./api-client.ts";

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (event: WalmartRetryEvent) => void | Promise<void>;
  context?: {
    endpoint?: string;
    chunkStartDate?: string;
    chunkEndDate?: string;
  };
};

export type WalmartRetryEvent = {
  endpoint?: string;
  httpStatus?: number;
  retryAttempt: number;
  retryAfterMs?: number;
  nextRetryDelayMs: number;
  chunkStartDate?: string;
  chunkEndDate?: string;
  errorMessage: string;
};

export async function withWalmartRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      return {
        value: await operation(),
        attempts: attempt,
        retried: attempt > 1
      };
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !isRetryableWalmartError(error)) {
        throw error;
      }

      const nextRetryDelayMs = getRetryDelayMs(error, attempt, {
        baseDelayMs,
        maxDelayMs,
        random
      });
      const event = buildRetryEvent(error, attempt, nextRetryDelayMs, options.context);
      logWalmartRetryEvent(event);
      await options.onRetry?.(event);
      await sleep(nextRetryDelayMs);
    }
  }

  throw lastError;
}

export function getRetryDelayMs(
  error: unknown,
  retryAttempt: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    random?: () => number;
  } = {}
) {
  const maxDelayMs = options.maxDelayMs ?? 30000;

  if (error instanceof WalmartApiError && error.status === 429 && error.retryAfterMs) {
    return Math.min(maxDelayMs, Math.max(0, error.retryAfterMs));
  }

  const baseDelayMs = options.baseDelayMs ?? 2000;
  const random = options.random ?? Math.random;
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (retryAttempt - 1));
  const jitterMultiplier = 0.75 + random() * 0.5;

  return Math.round(Math.min(maxDelayMs, exponentialDelay * jitterMultiplier));
}

export function isRetryableWalmartError(error: unknown) {
  if (error instanceof WalmartApiError) {
    return error.status === 429 || (typeof error.status === "number" && error.status >= 500);
  }

  return error instanceof TypeError;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildRetryEvent(
  error: unknown,
  retryAttempt: number,
  nextRetryDelayMs: number,
  context: RetryOptions["context"]
): WalmartRetryEvent {
  return {
    endpoint: error instanceof WalmartApiError ? error.endpoint ?? context?.endpoint : context?.endpoint,
    httpStatus: error instanceof WalmartApiError ? error.status : undefined,
    retryAttempt,
    retryAfterMs: error instanceof WalmartApiError ? error.retryAfterMs : undefined,
    nextRetryDelayMs,
    chunkStartDate: context?.chunkStartDate,
    chunkEndDate: context?.chunkEndDate,
    errorMessage: error instanceof Error ? error.message : String(error)
  };
}

function logWalmartRetryEvent(event: WalmartRetryEvent) {
  console.warn("Walmart API retry scheduled", {
    endpoint: event.endpoint,
    httpStatus: event.httpStatus,
    retryAttempt: event.retryAttempt,
    retryAfterMs: event.retryAfterMs,
    nextRetryDelayMs: event.nextRetryDelayMs,
    chunkStartDate: event.chunkStartDate,
    chunkEndDate: event.chunkEndDate
  });
}
