import pino from 'pino';

// Using environment variables for log level if needed
const logLevel = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
});
