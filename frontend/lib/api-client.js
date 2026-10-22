const NETWORK_ERROR_MESSAGE = 'Unable to connect. Please try again.';
const RESPONSE_ERROR_MESSAGE = 'Unable to load this information. Please try again.';

export function getApiBase() {
  return (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor(message, { status = null, code, payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(`${getApiBase()}${path}`, { credentials: 'include', ...options });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(NETWORK_ERROR_MESSAGE, { code: 'NETWORK_ERROR' });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(RESPONSE_ERROR_MESSAGE, {
      status: response.status,
      code: 'MALFORMED_PAYLOAD',
    });
  }

  if (!response.ok) {
    const detail = payload?.detail;
    throw new ApiError((typeof detail === 'string' ? detail : detail?.message) || RESPONSE_ERROR_MESSAGE, {
      status: response.status,
      code: detail?.code || 'HTTP_ERROR',
      payload,
    });
  }

  return payload;
}
