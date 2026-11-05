import {
  RegisterRequest,
  LoginRequest,
  UserDto,
  WorkspaceDto,
  SessionDto,
} from '@mindvault/shared';
import { dbService } from '../../lib/db.js';
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  getRefreshTokenExpiry,
} from './auth.security.js';

export class AuthService {
  async register(data: RegisterRequest): Promise<{
    user: UserDto;
    accessToken: string;
    refreshToken: string;
    activeWorkspace: WorkspaceDto;
  }> {
    const normalizedEmail = data.email.toLowerCase().trim();

    const existing = await dbService.findUserByEmail(normalizedEmail);
    if (existing) {
      const error = new Error('An account with this email address already exists');
      (error as unknown as { statusCode: number; code: string }).statusCode = 409;
      (error as unknown as { statusCode: number; code: string }).code = 'EMAIL_ALREADY_EXISTS';
      throw error;
    }

    const passwordHash = await hashPassword(data.password);

    const user = await dbService.createUser({
      name: data.name.trim(),
      email: normalizedEmail,
      passwordHash,
    });

    // Create initial personal workspace
    const baseSlug =
      user.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'workspace';
    const uniqueSlug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

    const { workspace, member } = await dbService.createWorkspace({
      name: `${user.name}'s Workspace`,
      slug: uniqueSlug,
      ownerId: user.id,
    });

    // Create initial authenticated session
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = getRefreshTokenExpiry();

    await dbService.createSession({
      userId: user.id,
      refreshTokenHash,
      expiresAt,
    });

    const userDto: UserDto = {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };

    const workspaceDto: WorkspaceDto = {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      role: member.role,
    };

    const accessToken = generateAccessToken(user);

    return {
      user: userDto,
      accessToken,
      refreshToken,
      activeWorkspace: workspaceDto,
    };
  }

  async login(data: LoginRequest): Promise<{
    user: UserDto;
    accessToken: string;
    refreshToken: string;
    activeWorkspace?: WorkspaceDto;
  }> {
    const normalizedEmail = data.email.toLowerCase().trim();

    const user = await dbService.findUserByEmail(normalizedEmail);
    if (!user) {
      const error = new Error('Invalid email or password');
      (error as unknown as { statusCode: number; code: string }).statusCode = 401;
      (error as unknown as { statusCode: number; code: string }).code = 'INVALID_CREDENTIALS';
      throw error;
    }

    const isValidPassword = await verifyPassword(data.password, user.passwordHash);
    if (!isValidPassword) {
      const error = new Error('Invalid email or password');
      (error as unknown as { statusCode: number; code: string }).statusCode = 401;
      (error as unknown as { statusCode: number; code: string }).code = 'INVALID_CREDENTIALS';
      throw error;
    }

    // Create new rotating session
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = getRefreshTokenExpiry();

    await dbService.createSession({
      userId: user.id,
      refreshTokenHash,
      expiresAt,
    });

    const userDto: UserDto = {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };

    // Find default active workspace for user
    const workspaces = await dbService.findUserWorkspaces(user.id);
    let activeWorkspace: WorkspaceDto | undefined;
    if (workspaces.length > 0) {
      const firstWs = workspaces[0];
      activeWorkspace = {
        id: firstWs.id,
        name: firstWs.name,
        slug: firstWs.slug,
        createdAt: firstWs.createdAt.toISOString(),
        updatedAt: firstWs.updatedAt.toISOString(),
        role: firstWs.role,
      };
    }

    const accessToken = generateAccessToken(user);

    return {
      user: userDto,
      accessToken,
      refreshToken,
      activeWorkspace,
    };
  }

  async refresh(rawRefreshToken: string): Promise<{
    accessToken: string;
    newRefreshToken: string;
    user: UserDto;
  }> {
    if (!rawRefreshToken) {
      const error = new Error('Refresh token missing');
      (error as unknown as { statusCode: number; code: string }).statusCode = 401;
      (error as unknown as { statusCode: number; code: string }).code = 'MISSING_REFRESH_TOKEN';
      throw error;
    }

    const refreshTokenHash = hashRefreshToken(rawRefreshToken);
    const session = await dbService.findSessionByHash(refreshTokenHash);

    if (!session) {
      const error = new Error('Invalid or expired refresh token');
      (error as unknown as { statusCode: number; code: string }).statusCode = 401;
      (error as unknown as { statusCode: number; code: string }).code = 'INVALID_REFRESH_TOKEN';
      throw error;
    }

    // Token reuse detection: If session was already revoked, someone may be reusing an old token!
    if (session.revokedAt !== null) {
      // Revoke all active sessions for this user family
      await dbService.revokeAllUserSessions(session.userId);
      const error = new Error(
        'Refresh token reuse detected. All sessions for this account have been revoked for security.',
      );
      (error as unknown as { statusCode: number; code: string }).statusCode = 401;
      (error as unknown as { statusCode: number; code: string }).code = 'TOKEN_REUSE_DETECTED';
      throw error;
    }

    // Expiry check
    if (session.expiresAt.getTime() < Date.now()) {
      await dbService.revokeSession(session.id);
      const error = new Error('Session expired. Please log in again.');
      (error as unknown as { statusCode: number; code: string }).statusCode = 401;
      (error as unknown as { statusCode: number; code: string }).code = 'SESSION_EXPIRED';
      throw error;
    }

    const user = await dbService.findUserById(session.userId);
    if (!user) {
      const error = new Error('User not found');
      (error as unknown as { statusCode: number; code: string }).statusCode = 401;
      (error as unknown as { statusCode: number; code: string }).code = 'USER_NOT_FOUND';
      throw error;
    }

    // Rotate refresh token: revoke old session to detect future reuse, create new session
    await dbService.revokeSession(session.id);

    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
    const newExpiresAt = getRefreshTokenExpiry();

    await dbService.createSession({
      userId: user.id,
      refreshTokenHash: newRefreshTokenHash,
      expiresAt: newExpiresAt,
    });

    const accessToken = generateAccessToken(user);

    return {
      accessToken,
      newRefreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken) {
      const hash = hashRefreshToken(rawRefreshToken);
      const session = await dbService.findSessionByHash(hash);
      if (session) {
        await dbService.revokeSession(session.id);
      }
    }
  }

  async listSessions(userId: string, currentRefreshToken?: string): Promise<SessionDto[]> {
    const sessions = await dbService.listActiveSessions(userId);
    const currentHash = currentRefreshToken ? hashRefreshToken(currentRefreshToken) : undefined;

    return sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: currentHash ? s.refreshTokenHash === currentHash : false,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const active = await dbService.listActiveSessions(userId);
    const target = active.find((s) => s.id === sessionId);

    if (!target) {
      const error = new Error('Session not found or does not belong to you');
      (error as unknown as { statusCode: number; code: string }).statusCode = 404;
      (error as unknown as { statusCode: number; code: string }).code = 'SESSION_NOT_FOUND';
      throw error;
    }

    await dbService.revokeSession(sessionId);
  }
}

export const authService = new AuthService();
