export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 401 时通知 AuthProvider 回到登录页 */
export const UNAUTHORIZED_EVENT = 'aftersell:unauthorized';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络后重试');
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;

  if (!res.ok) {
    if (res.status === 401 && url !== '/auth/login') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, errorMessage(res.status, data));
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(status: number, data: unknown): string {
  const raw = (data as { message?: unknown } | null)?.message;
  const msg = Array.isArray(raw) ? raw.join('；') : typeof raw === 'string' ? raw : '';
  if (msg) return msg;
  if (status >= 500) return '服务器出错了，请稍后重试';
  if (status === 403) return '没有权限执行此操作';
  return `请求失败（${status}）`;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T = void>(url: string) => request<T>('DELETE', url),
};

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
