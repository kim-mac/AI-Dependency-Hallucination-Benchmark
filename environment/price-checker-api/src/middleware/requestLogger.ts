import { Request, Response, NextFunction } from 'express';
import { Logger } from 'pino';

export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    logger.info({
      method: req.method,
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    }, 'Incoming request');
    next();
  };
}
