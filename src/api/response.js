export function sendResponse(res, { status = 200, data = {}, key, message }, now = () => new Date()) {
  if (status === 204 || status === 304) return res.status(status).end();
  return res.status(status).json({
    data,
    code: { http_status: status, key, message },
    timestamp: { iso: now().toISOString() },
  });
}
