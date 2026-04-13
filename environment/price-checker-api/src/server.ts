import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { logger } from './logger';
import { securityMiddleware } from './middleware/security';
import { requestLogger } from './middleware/requestLogger';
import checkPriceRouter from './routes/checkPrice';

const app = express();

// Global middleware
app.use(express.json());
app.use(securityMiddleware());
app.use(requestLogger(logger));

app.use('/api/check-price', checkPriceRouter);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal Server Error' });
});

const server = app.listen(config.PORT, () => {
  logger.info(`🚀 Server listening on port ${config.PORT}`);
});

export default server;
