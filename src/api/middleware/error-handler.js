import { AppError } from '../errors/app-error.js';
import { sendResponse } from '../response.js';

export function createErrorHandler({ now = () => new Date(), logger = console } = {}) {
  return function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    let failure = error;
    if (!(error instanceof AppError)) {
      if (error.code === 'ERR_SQLITE_ERROR' && [5, 6].includes(error.errcode & 0xff)) {
        failure = new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is busy. Please try again.');
      } else if (error instanceof URIError && error.status === 400) {
        failure = new AppError(400, 'INVALID_PATH', 'The request path contains invalid URL encoding.');
      } else if (error.type === 'entity.parse.failed') {
        failure = new AppError(400, 'INVALID_JSON', 'The request body must contain valid JSON.');
      } else if (error.type === 'entity.too.large') {
        failure = new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
      } else if (['charset.unsupported', 'encoding.unsupported'].includes(error.type)) {
        failure = new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use UTF-8 JSON without unsupported content encoding.');
      } else {
        // Log once without including SQL, request bodies, or personal data.
        logger.error('Unexpected API error', { name: error.name, code: error.code });
        failure = new AppError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred. Please try again.');
      }
    }
    return sendResponse(res, {
      status: failure.httpStatus,
      key: failure.code,
      message: failure.message,
      data: failure.details === undefined ? {} : { details: failure.details },
    }, now);
  };
}
