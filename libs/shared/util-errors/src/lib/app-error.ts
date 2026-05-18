/**
 * Operational HTTP error with an explicit status code for the global error handler.
 */
export class AppError extends Error {
  /**
   * @param statusCode - HTTP status to return to the client.
   * @param message - Safe, client-visible error message.
   */
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
