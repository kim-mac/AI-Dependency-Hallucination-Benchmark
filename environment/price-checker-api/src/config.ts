import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env if present
dotenv.config();

// Validate config using zod
const EnvSchema = z.object({
  PORT: z.string().regex(/^[0-9]+$/).transform(Number).default('3000'),
  API_TIMEOUT: z.string().regex(/^[0-9]+$/).transform(Number).default('5000'),
  CACHE_TTL: z.string().regex(/^[0-9]+$/).transform(Number).default('300'),
});

export const config = EnvSchema.parse(process.env);
