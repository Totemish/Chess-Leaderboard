/**
 * Errors that map to an HTTP status. Services throw these; the error
 * middleware turns them into `{ success: false, error }` responses, so route
 * handlers never build error responses by hand.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to do this.') {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do this.") {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string) {
    super(429, message);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(502, message);
  }
}
