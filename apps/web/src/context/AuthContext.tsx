import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type {
  UserDto,
  WorkspaceDto,
  RegisterRequest,
  LoginRequest,
  ApiResponse,
  AuthResponseData,
} from '@mindvault/shared';

interface AuthContextType {
  user: UserDto | null;
  accessToken: string | null;
  workspaces: WorkspaceDto[];
  activeWorkspace: WorkspaceDto | null;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  setActiveWorkspace: (ws: WorkspaceDto) => void;
  refreshWorkspaces: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserDto | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [activeWorkspace, setActiveWorkspaceState] = useState<WorkspaceDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchWorkspaces = useCallback(async (token: string): Promise<WorkspaceDto[]> => {
    try {
      const res = await fetch('/api/workspaces', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const json: ApiResponse<WorkspaceDto[]> = await res.json();
        if (json.success && json.data) {
          setWorkspaces(json.data);
          return json.data;
        }
      }
    } catch (err) {
      console.error('Failed to fetch workspaces:', err);
    }
    return [];
  }, []);

  // Try refreshing session on initial app load using HttpOnly cookie
  useEffect(() => {
    let mounted = true;

    async function initSession() {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });

        if (res.ok) {
          const json: ApiResponse<{ user: UserDto; accessToken: string }> = await res.json();
          if (json.success && json.data && mounted) {
            setUser(json.data.user);
            setAccessToken(json.data.accessToken);

            const userWs = await fetchWorkspaces(json.data.accessToken);
            if (userWs.length > 0 && mounted) {
              setActiveWorkspaceState(userWs[0]);
            }
          }
        }
      } catch {
        // No active session
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initSession();

    return () => {
      mounted = false;
    };
  }, [fetchWorkspaces]);

  const login = async (data: LoginRequest) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const json: ApiResponse<AuthResponseData> = await res.json();
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error?.message || 'Login failed');
    }

    setUser(json.data.user);
    setAccessToken(json.data.accessToken);

    const userWs = await fetchWorkspaces(json.data.accessToken);
    if (json.data.activeWorkspace) {
      setActiveWorkspaceState(json.data.activeWorkspace);
    } else if (userWs.length > 0) {
      setActiveWorkspaceState(userWs[0]);
    }
  };

  const register = async (data: RegisterRequest) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const json: ApiResponse<AuthResponseData> = await res.json();
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error?.message || 'Registration failed');
    }

    setUser(json.data.user);
    setAccessToken(json.data.accessToken);

    if (json.data.activeWorkspace) {
      setWorkspaces([json.data.activeWorkspace]);
      setActiveWorkspaceState(json.data.activeWorkspace);
    } else {
      await fetchWorkspaces(json.data.accessToken);
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
    } finally {
      setUser(null);
      setAccessToken(null);
      setWorkspaces([]);
      setActiveWorkspaceState(null);
    }
  };

  const setActiveWorkspace = (ws: WorkspaceDto) => {
    setActiveWorkspaceState(ws);
  };

  const refreshWorkspaces = async () => {
    if (accessToken) {
      await fetchWorkspaces(accessToken);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        workspaces,
        activeWorkspace,
        isLoading,
        login,
        register,
        logout,
        setActiveWorkspace,
        refreshWorkspaces,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
