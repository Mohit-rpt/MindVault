import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('GET /api/health', () => {
  const app = createApp();

  it('should return 200 OK with process metadata and dependency status', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(['healthy', 'degraded']).toContain(res.body.status);
    expect(res.body).toHaveProperty('service', 'mindvault-api');
    expect(res.body).toHaveProperty('version', '1.0.0');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('process');
    expect(res.body.process).toHaveProperty('pid');
    expect(res.body.dependencies).toHaveProperty('database');
    expect(res.body.dependencies).toHaveProperty('redis');
  });

  it('should return 404 for unknown endpoints with structured error', async () => {
    const res = await request(app).get('/api/unknown-endpoint');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body.error).toHaveProperty('code', 'NOT_FOUND');
  });
});
