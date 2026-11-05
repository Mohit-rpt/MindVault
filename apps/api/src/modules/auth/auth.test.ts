import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { InMemoryDatabaseService, setDatabaseService } from '../../lib/db.js';
import { REFRESH_COOKIE_NAME } from './auth.security.js';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

describe('Authentication Module (Phase 1)', () => {
  let app: ReturnType<typeof createApp>;
  let memoryDb: InMemoryDatabaseService;

  beforeEach(() => {
    memoryDb = new InMemoryDatabaseService();
    setDatabaseService(memoryDb);
    app = createApp();
  });

  describe('POST /api/auth/register', () => {
    it('should successfully register a user and create an initial workspace and session', async () => {
      const res = await request(app).post('/api/auth/register').send({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'securePassword123!',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data.user.email).toBe('ada@example.com');
      expect(res.body.data.user.name).toBe('Ada Lovelace');
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('activeWorkspace');
      expect(res.body.data.activeWorkspace.role).toBe('OWNER');

      // Verify HttpOnly refresh token cookie is set
      const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(cookies).toBeDefined();
      expect(cookies?.some((c) => c.includes(REFRESH_COOKIE_NAME))).toBe(true);
      expect(cookies?.some((c) => c.includes('HttpOnly'))).toBe(true);

      // Verify user and session are persisted in database
      const user = await memoryDb.findUserByEmail('ada@example.com');
      expect(user).not.toBeNull();
      expect(user?.passwordHash).not.toBe('securePassword123!'); // Hashed with Argon2id
    });

    it('should reject registration with duplicate email with 409 Conflict', async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'securePassword123!',
      });

      const duplicateRes = await request(app).post('/api/auth/register').send({
        name: 'Another Ada',
        email: 'ADA@example.com', // Case-insensitive normalized email check
        password: 'anotherPassword123!',
      });

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body.success).toBe(false);
      expect(duplicateRes.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('should reject invalid registration input (short password, invalid email)', async () => {
      const res = await request(app).post('/api/auth/register').send({
        name: 'A',
        email: 'not-an-email',
        password: '123',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Alan Turing',
        email: 'alan@example.com',
        password: 'password12345!',
      });
    });

    it('should successfully log in with valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'alan@example.com',
        password: 'password12345!',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('alan@example.com');
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data.activeWorkspace.role).toBe('OWNER');

      const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(cookies?.some((c) => c.includes(REFRESH_COOKIE_NAME))).toBe(true);
    });

    it('should reject incorrect password without revealing user existence', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'alan@example.com',
        password: 'wrongPassword999!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('should reject non-existent user with the same generic credentials error', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'somePassword123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.message).toBe('Invalid email or password');
    });
  });

  describe('POST /api/auth/refresh (Rotation & Reuse Detection)', () => {
    it('should rotate the refresh token and issue a new access token', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        name: 'Grace Hopper',
        email: 'grace@example.com',
        password: 'password12345!',
      });

      const cookieHeader = reg.headers['set-cookie'];
      expect(cookieHeader).toBeDefined();

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader as unknown as string[])
        .send();

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.data).toHaveProperty('accessToken');

      const newCookieHeader = refreshRes.headers['set-cookie'];
      expect(newCookieHeader).toBeDefined();
      expect(newCookieHeader).not.toEqual(cookieHeader); // Rotated to a new token!
    });

    it('should detect reuse of an old refresh token and revoke the entire session family', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        name: 'Grace Hopper',
        email: 'grace@example.com',
        password: 'password12345!',
      });

      const originalCookie = reg.headers['set-cookie'];

      // Legitimate rotation
      const refresh1 = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', originalCookie as unknown as string[])
        .send();
      expect(refresh1.status).toBe(200);

      // Now attempt to reuse the old/superseded refresh token (replay attack)
      const reuseRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', originalCookie as unknown as string[])
        .send();

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      // Verify all sessions for this user were revoked
      const activeSessions = await memoryDb.listActiveSessions(reg.body.data.user.id);
      expect(activeSessions.length).toBe(0);
    });

    it('should reject refresh when no refresh cookie is provided', async () => {
      const res = await request(app).post('/api/auth/refresh').send();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_REFRESH_COOKIE');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should revoke session and clear cookie on logout', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        name: 'Claude Shannon',
        email: 'claude@example.com',
        password: 'password12345!',
      });

      const cookieHeader = reg.headers['set-cookie'];

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookieHeader as unknown as string[])
        .send();

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Cookie should be cleared
      const setCookies = logoutRes.headers['set-cookie'] as unknown as string[] | undefined;
      expect(setCookies?.some((c) => c.includes(`${REFRESH_COOKIE_NAME}=;`))).toBe(true);

      // Subsequent refresh must fail
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader as unknown as string[])
        .send();
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('Authentication Middleware & Expired Tokens', () => {
    it('should reject requests with expired access tokens', async () => {
      // Create an already-expired JWT token
      const expiredToken = jwt.sign(
        { sub: 'user_123', email: 'test@example.com', name: 'Test' },
        env.JWT_ACCESS_SECRET,
        { expiresIn: '-1s' },
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('should reject requests with malformed tokens', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.token.value');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('should reject requests missing Authorization header', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/auth/sessions & DELETE /api/auth/sessions/:id', () => {
    it('should list active sessions and allow revoking an individual session', async () => {
      const reg = await request(app).post('/api/auth/register').send({
        name: 'Margaret Hamilton',
        email: 'margaret@example.com',
        password: 'password12345!',
      });

      const { accessToken } = reg.body.data;
      const cookieHeader = reg.headers['set-cookie'];

      const listRes = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', cookieHeader as unknown as string[]);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      const sessionId = listRes.body.data[0].id;

      // Revoke the session
      const revokeRes = await request(app)
        .delete(`/api/auth/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.success).toBe(true);

      // Verify list is now empty
      const listAfter = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(listAfter.body.data.length).toBe(0);
    });
  });
});
