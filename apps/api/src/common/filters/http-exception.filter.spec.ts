import { ArgumentsHost, Logger } from '@nestjs/common';
import { ErrorCode } from '@ruidong/shared';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(reply: Record<string, jest.Mock>) {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
}

function makeReply() {
  const reply: Record<string, jest.Mock> = {};
  reply.code = jest.fn().mockReturnValue(reply);
  reply.send = jest.fn().mockReturnValue(reply);
  reply.header = jest.fn().mockReturnValue(reply);
  return reply;
}

describe('HttpExceptionFilter', () => {
  it('logs unknown exceptions without stack traces', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const filter = new HttpExceptionFilter();
    const reply = makeReply();
    const err = new Error('database password leaked in stack marker');
    err.stack = 'Error: database password leaked in stack marker\n    at secret/path.ts:1:2';

    filter.catch(err, makeHost(reply));

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      code: ErrorCode.INTERNAL_ERROR,
      message: '服务器内部错误',
      data: null,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Unhandled exception: Error: database password leaked in stack marker',
    );
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('secret/path.ts'));

    errorSpy.mockRestore();
  });
});
