import { Request, Response, NextFunction } from 'express';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  ApiResponse,
  AuthResponseData,
  SessionDto,
  UserDto,
  WorkspaceDto,
} from '@mindvault/shared';
import { authService } from './auth.service.js';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_COOKIE_NAME,
} from './auth.security.js';
import { dbService } from '../../lib/db.js';

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = RegisterRequestSchema.parse(req.body);
      const result = await authService.register(data);

      setRefreshTokenCookie(res, result.refreshToken);

      const response: ApiResponse<AuthResponseData> = {
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          activeWorkspace: result.activeWorkspace,
        },
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = LoginRequestSchema.parse(req.body);
      const result = await authService.login(data);

      setRefreshTokenCookie(res, result.refreshToken);

      const response: ApiResponse<AuthResponseData> = {
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          activeWorkspace: result.activeWorkspace,
        },
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
      if (!rawToken) {
        clearRefreshTokenCookie(res);
        res.status(401).json({
          success: false,
          error: {
            code: 'MISSING_REFRESH_COOKIE',
            message: 'Refresh token cookie is missing',
          },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const result = await authService.refresh(rawToken);
      setRefreshTokenCookie(res, result.newRefreshToken);

      const response: ApiResponse<{ user: UserDto; accessToken: string }> = {
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
        },
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      clearRefreshTokenCookie(res);
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
      await authService.logout(rawToken);
      clearRefreshTokenCookie(res);

      const response: ApiResponse<{ message: string }> = {
        success: true,
        data: { message: 'Logged out successfully' },
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      clearRefreshTokenCookie(res);
      next(err);
    }
  }

  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const user = await dbService.findUserById(req.user.id);
      if (!user) {
        res.status(404).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User record not found' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const workspaces = await dbService.findUserWorkspaces(user.id);
      const workspacesDto: WorkspaceDto[] = workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
        role: w.role,
      }));

      const response: ApiResponse<{ user: UserDto; workspaces: WorkspaceDto[] }> = {
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
          },
          workspaces: workspacesDto,
        },
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  async getSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const currentToken = req.cookies?.[REFRESH_COOKIE_NAME];
      const sessions = await authService.listSessions(req.user.id, currentToken);

      const response: ApiResponse<SessionDto[]> = {
        success: true,
        data: sessions,
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  async revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
          meta: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const { id } = req.params;
      await authService.revokeSession(req.user.id, id);

      const response: ApiResponse<{ message: string }> = {
        success: true,
        data: { message: 'Session revoked successfully' },
        meta: { timestamp: new Date().toISOString() },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
