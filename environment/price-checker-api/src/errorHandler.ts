import { Request, Response, NextFunction } from 'express';
import pino from 'pino';
import { config } from './config';

const logger = pino({ level: config.logLevel });

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
};

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const status = err.status || 500;
  logger.error({ err, status }, 'Unhandled error');
  res.status(status).json({ error: err.message || 'Internal Server Error' });
};
