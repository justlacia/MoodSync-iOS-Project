import {
  CLOUD_API_BASE_URL,
  CLOUD_REQUEST_TIMEOUT_MS,
  CLOUD_UPLOAD_TIMEOUT_MS,
} from '../config/cloudConfig';

export class CloudApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
  }
}

type TokenGetter = () => string | null;
type UnauthorizedHandler = () => void;

let tokenGetter: TokenGetter = () => null;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function configureCloudAuthHooks(
  getToken: TokenGetter,
  onUnauthorized?: UnauthorizedHandler
): void {
  tokenGetter = getToken;
  unauthorizedHandler = onUnauthorized || null;
}

export async function cloudRequest<T = any>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    auth?: boolean;
    timeoutMs?: number;
    suppressUnauthorizedHook?: boolean;
  } = {}
): Promise<T> {
  const {
    method = 'GET',
    body,
    auth = true,
    timeoutMs = CLOUD_REQUEST_TIMEOUT_MS,
    suppressUnauthorizedHook = false,
  } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (auth) {
    const token = tokenGetter();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(`${CLOUD_API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new CloudApiError(
        'Azure bulut sunucusu zaman aşımına uğradı. Lütfen tekrar deneyin.',
        0
      );
    }
    throw new CloudApiError(
      'Azure bulut sunucusuna bağlanılamadı. İnternet bağlantınızı kontrol edin.',
      0
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await resp.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!resp.ok) {
    if (resp.status === 401 && auth && !suppressUnauthorizedHook) {
      unauthorizedHandler?.();
    }
    const msg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      `Sunucu hatası (${resp.status}).`;
    throw new CloudApiError(msg, resp.status);
  }

  return (parsed ?? {}) as T;
}

export async function cloudUploadRequest<T = any>(
  path: string,
  body: unknown,
  method: 'POST' | 'PATCH' | 'PUT' = 'POST'
): Promise<T> {
  return cloudRequest<T>(path, {
    method,
    body,
    auth: true,
    timeoutMs: CLOUD_UPLOAD_TIMEOUT_MS,
  });
}

let warmupPromise: Promise<void> | null = null;

export function warmupCloudApi(): Promise<void> {
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    try {
      await cloudRequest('/health', {
        method: 'GET',
        auth: false,
        timeoutMs: 18000,
      });
    } catch {
      // Non-blocking cold-start ping
    } finally {
      setTimeout(() => {
        warmupPromise = null;
      }, 15000);
    }
  })();
  return warmupPromise;
}
