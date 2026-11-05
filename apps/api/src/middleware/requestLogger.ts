import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { statusCode } = res;
    const timestamp = new Date().toISOString();

    const logLevel = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(
      `[${timestamp}] [${logLevel}] ${method} ${originalUrl} ${statusCode} - ${duration}ms`,
    );
  });

  next();
}
