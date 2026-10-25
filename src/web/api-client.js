export class ApiClientError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function unavailable() {
  return new ApiClientError(503, 'SCHEDULE_UNAVAILABLE', 'The schedule is temporarily unavailable. Please try again.');
}

// This module has no Node-only imports and can also be imported by browser modules.
export function createApiClient({ baseUrl = '/api/v1', fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { method = 'GET', body: requestBody } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method, headers: { Accept: 'application/json', ...(requestBody === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody), cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw unavailable();
    }
    if (response.status === 204 || response.status === 304) {
      return { data: {}, etag: response.headers.get('etag'), status: response.status };
    }
    let body;
    try { body = await response.json(); } catch { throw unavailable(); }
    if (!response.ok) {
      if (response.status >= 500) throw unavailable();
      throw new ApiClientError(response.status, body?.code?.key || 'API_REQUEST_FAILED',
        body?.code?.message || 'The requested schedule could not be loaded.', body?.data?.details);
    }
    if (!body || body.code?.http_status !== response.status || !body.data
      || typeof body.data !== 'object' || Array.isArray(body.data)) throw unavailable();
    return { data: body.data, etag: response.headers.get('etag'), status: response.status };
  }
  async function items(path) {
    const result = await request(path);
    if (!Array.isArray(result.data.items)) throw unavailable();
    return result.data.items;
  }
  return {
    request,
    getRooms: () => items('/rooms'),
    getTutors: () => items('/tutors'),
    async createBooking(input) {
      const result = await request('/bookings', { method: 'POST', body: input });
      if (result.status !== 201 || !result.data.booking) throw unavailable();
      return result.data.booking;
    },
    getBookings(filters = {}) {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined));
      return items(`/bookings${query.size ? `?${query}` : ''}`);
    },
    async getBooking(id) {
      const result = await request(`/bookings/${encodeURIComponent(id)}`);
      if (!result.data.booking || !result.etag) throw unavailable();
      return { booking: result.data.booking, etag: result.etag };
    },
    getBookingChanges: (id) => items(`/bookings/${encodeURIComponent(id)}/changes`),
  };
}

export function clientForLocalRequest(req) {
  // The listening socket supplies the target; an untrusted Host header never does.
  const address = req.socket.localAddress;
  const host = address.includes(':') ? `[${address}]` : address;
  const protocol = req.socket.encrypted ? 'https' : 'http';
  return createApiClient({ baseUrl: `${protocol}://${host}:${req.socket.localPort}/api/v1` });
}
