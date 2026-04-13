import axios from 'axios';
import axiosRetry from 'axios-retry';
import NodeCache from 'node-cache';
import { config } from './config';

// Create Axios client with timeout
const httpClient = axios.create({
  timeout: config.TIMEOUT_MS,
});

// Configure retry logic
axiosRetry(httpClient, {
  retries: config.RETRY_ATTEMPTS,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (err) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(err) || (err.response && err.response.status >= 500);
  },
});

// Cache results for 5 minutes
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

export async function priceChecker(productId: string) {
  const cached = cache.get<number[]>(productId);
  if (cached) {
    return { prices: cached, cached: true };
  }

  const urls = config.API_URLS.split(',').map(u => u.trim()).filter(Boolean);
  const fetches = urls.map(async (baseUrl) => {
    const urlObj = new URL(`${baseUrl}/price`);
    urlObj.searchParams.set('productId', productId);
    const endpoint = urlObj.toString();
    try {
      const resp = await httpClient.get(endpoint, { headers: { Accept: 'application/json' } });
      return resp.data?.price ?? null;
    } catch (err) {
      console.warn(`Failed to fetch price from ${endpoint}: ${err}`);
      return null;
    }
  });

  const results = await Promise.all(fetches);
  const prices = results.filter((p): p is number => typeof p === 'number');
  cache.set(productId, prices);
  return { prices, cached: false };
}
