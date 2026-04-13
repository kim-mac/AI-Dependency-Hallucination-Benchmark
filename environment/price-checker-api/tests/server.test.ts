import request from 'supertest';
import server from '../src/server';
import { vi } from 'vitest';
import axios from 'axios';

// Mock axios to avoid real HTTP calls
const mockGet = vi.fn();
const mockInterceptorUse = vi.fn();
const mockInstance = {
  get: mockGet,
  interceptors: {
    response: {
      use: mockInterceptorUse,
    },
  },
};

const mockAxiosCreate = vi.fn().mockReturnValue(mockInstance);

vi.mock('axios', () => {
  return {
    ...axios,
    default: mockAxiosCreate,
  };
});

// Prepare mocked responses for three endpoints
mockGet.mockResolvedValue({
  data: { price: 10 },
});

describe('POST /api/check-price', () => {
  afterAll(() => {
    server.close();
  });

  test('returns 200 and prices array when valid body', async () => {
    const res = await request(server).post('/api/check-price').send({ productId: 'ABC' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('prices');
    expect(res.body.prices).toHaveLength(3);
    expect(res.body).toHaveProperty('cached', false);
  });

  test('returns cached response on second request', async () => {
    const res1 = await request(server).post('/api/check-price').send({ productId: 'XYZ' });
    const res2 = await request(server).post('/api/check-price').send({ productId: 'XYZ' });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body).toHaveProperty('cached', true);
  });

  test('returns 400 for invalid body', async () => {
    const res = await request(server).post('/api/check-price').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
