import express, { Request, Response } from 'express';
import { logger } from '../logger';
import { config } from '../config';
import { z } from 'zod';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import NodeCache from 'node-cache';

const router = express.Router();

// Request body schema
const bodySchema = z.object({
  productId: z.string().min(1, 'productId is required'),
});

// Cache instance
const cache = new NodeCache({ stdTTL: config.CACHE_TTL_SECONDS, useClones: false });

router.post('/', async (req: Request, res: Response) => {
  // Validate body
  const parseResult = bodySchema.safeParse(req.body);
  if (!parseResult.success) {
    logger.warn({ body: req.body }, 'Invalid request body');
    return res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
  }
  const { productId } = parseResult.data;
  const cacheKey = `product:${productId}`;

  // Check cache
  const cached = cache.get<Array<{ source: string; price: number }>>(cacheKey);
  if (cached) {
    logger.info({ cacheKey }, 'Serving from cache');
    return res.json({ prices: cached, cached: true });
  }

  logger.info({ productId }, 'Fetching prices from external APIs');

  try {
    const axiosInstance = axios.create({ timeout: config.API_TIMEOUT_MS });
    axiosRetry(axiosInstance, { retries: 2, retryDelay: axiosRetry.exponentialDelay });
    const requestPromises = config.apiEndpoints.map((endpoint) =>
      axiosInstance
        .get(endpoint.url, { params: { productId } })
        .then((resp) => {
          const data = resp.data;
          if (!data || typeof data.price !== 'number') {
            throw new Error(`Invalid response from ${endpoint.source}`);
          }
          return {
            source: endpoint.source,
            price: data.price,
          };
        })
    );

    const prices = await Promise.all(requestPromises);
    // Store in cache
    cache.set(cacheKey, prices);
    return res.json({ prices, cached: false });
  } catch (err: any) {
    logger.error({ err, productId }, 'Failed to fetch prices');
    const status = err.response?.status ?? 502;
    const message = err.message ?? 'Failed to fetch prices';
    return res.status(status).json({ error: message });
  }
});

export default router;
