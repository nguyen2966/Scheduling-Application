export class AppError extends Error {
  constructor(httpStatus, code, message, { details, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}
