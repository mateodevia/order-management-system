import { AppError } from '../app-error';

describe('AppError', () => {
  test('should be an instance of Error', () => {
    // ARRANGE
    const err = new AppError(404, 'Not found');

    // ACT + ASSERT
    expect(err).toBeInstanceOf(Error);
  });

  test('should expose statusCode', () => {
    // ARRANGE
    const err = new AppError(422, 'Unprocessable');

    // ACT + ASSERT
    expect(err.statusCode).toBe(422);
  });

  test('should expose message', () => {
    // ARRANGE
    const err = new AppError(409, 'Conflict detected');

    // ACT + ASSERT
    expect(err.message).toBe('Conflict detected');
  });
});
