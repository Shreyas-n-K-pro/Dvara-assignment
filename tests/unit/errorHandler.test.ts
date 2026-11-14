import { errorHandler } from '../../src/middleware/errorHandler';
import { AppError } from '../../src/utils/errors';
import { Request, Response, NextFunction } from 'express';

describe('Error Handler Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    mockReq = {};
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockRes = { status: statusMock } as Partial<Response>;
    mockNext = jest.fn();
  });

  it('should handle AppError with correct status and code', () => {
    const error = new AppError('Test error', 422, 'TEST_CODE');

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(422);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'TEST_CODE',
        message: 'Test error',
      },
    });
  });

  it('should handle generic errors with 500 status', () => {
    const error = new Error('Unexpected error');

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
        }),
      })
    );
  });
});
