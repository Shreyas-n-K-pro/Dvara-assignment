import { AppError, NotFoundError, ValidationError, ConflictError, UnauthorizedError, ForbiddenError } from '../../src/utils/errors';

describe('Custom Error Classes', () => {
  describe('AppError', () => {
    it('should create an error with default values', () => {
      const error = new AppError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(true);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });

    it('should create an error with custom values', () => {
      const error = new AppError('Custom error', 422, 'CUSTOM_CODE', false);
      expect(error.statusCode).toBe(422);
      expect(error.code).toBe('CUSTOM_CODE');
      expect(error.isOperational).toBe(false);
    });
  });

  describe('NotFoundError', () => {
    it('should have status 404', () => {
      const error = new NotFoundError();
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('Resource not found');
    });

    it('should accept custom message', () => {
      const error = new NotFoundError('Loan not found');
      expect(error.message).toBe('Loan not found');
    });
  });

  describe('ValidationError', () => {
    it('should have status 400', () => {
      const error = new ValidationError();
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('ConflictError', () => {
    it('should have status 409', () => {
      const error = new ConflictError();
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT');
    });
  });

  describe('UnauthorizedError', () => {
    it('should have status 401', () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('ForbiddenError', () => {
    it('should have status 403', () => {
      const error = new ForbiddenError();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
    });
  });
});
