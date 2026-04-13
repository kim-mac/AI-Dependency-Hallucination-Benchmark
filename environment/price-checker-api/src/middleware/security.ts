import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

export function securityMiddleware() {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
  });
  return (req: any, res: any, next: any) => {
    helmet()(req, res, () => {
      limiter(req, res, next);
    });
  };
}
