import { Logger } from '../utils/logger.js';

export interface JobCountsBreakdown {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export interface JobAvailabilityResponse {
  hasPendingJobs: boolean;
  hasActiveJobs: boolean;
  summary: JobCountsBreakdown;
  queues: {
    documentProcessing: JobCountsBreakdown;
    graphExtraction: JobCountsBreakdown;
  };
  timestamp: string;
}

export interface DeviceStatusResponse {
  deviceId: string;
  deviceName: string;
  platform: string;
  isRevoked: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface RegisterDeviceResponse {
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  platform: string;
  createdAt: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code = 'AUTH_ERROR',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class CloudApiClient {
  private logger = new Logger('CloudApiClient');

  constructor(
    private baseUrl: string,
    private timeoutMs = 8000,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Helper executing fetch with timeout and error classification.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit & { token?: string },
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.status === 401 || res.status === 403) {
        let errMessage = 'Authentication failed';
        try {
          const body = (await res.json()) as any;
          errMessage = body?.error?.message || errMessage;
        } catch {
          // ignore parse errors
        }
        throw new AuthError(errMessage, res.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
      }

      if (!res.ok) {
        let errMessage = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as any;
          errMessage = body?.error?.message || errMessage;
        } catch {
          // ignore
        }
        throw new Error(`API request failed: ${errMessage}`);
      }

      const json = (await res.json()) as any;
      return json.data as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err instanceof AuthError) {
        throw err;
      }
      if (err.name === 'AbortError') {
        throw new NetworkError(`Request timed out after ${this.timeoutMs}ms`);
      }
      if (err.message?.includes('fetch failed') || err.message?.includes('ECONNREFUSED')) {
        throw new NetworkError(`Network connection error: ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * Pairs and registers this device using a short-lived one-time pairing code (§SEC-01).
   */
  public async claimPairingCode(
    pairingCode: string,
    deviceName: string,
    platform = 'win32',
  ): Promise<RegisterDeviceResponse & { workspaceId?: string }> {
    this.logger.info(`Pairing device "${deviceName}" via one-time pairing code...`);
    return this.request<RegisterDeviceResponse & { workspaceId?: string }>(
      '/api/companion/pairing/claim',
      {
        method: 'POST',
        body: JSON.stringify({ pairingCode, deviceName, platform }),
      },
    );
  }

  /**
   * Pairs and registers this device using user JWT credentials.
   */
  public async registerDevice(
    userToken: string,
    deviceName: string,
    platform = 'win32',
  ): Promise<RegisterDeviceResponse> {
    this.logger.info(`Registering device "${deviceName}" with cloud API...`);
    return this.request<RegisterDeviceResponse>('/api/companion/device/register', {
      method: 'POST',
      token: userToken,
      body: JSON.stringify({ deviceName, platform }),
    });
  }

  /**
   * Verifies current device registration status.
   */
  public async getDeviceStatus(deviceToken: string): Promise<DeviceStatusResponse> {
    return this.request<DeviceStatusResponse>('/api/companion/device/status', {
      method: 'GET',
      token: deviceToken,
    });
  }

  /**
   * Queries pending and active job status across BullMQ queues.
   */
  public async getJobStatus(deviceToken: string): Promise<JobAvailabilityResponse> {
    return this.request<JobAvailabilityResponse>('/api/companion/jobs/status', {
      method: 'GET',
      token: deviceToken,
    });
  }

  /**
   * Dispatches companion heartbeat telemetry to the cloud API.
   */
  public async sendHeartbeat(deviceToken: string, payload: any): Promise<void> {
    await this.request<{ status: string }>('/api/companion/heartbeat', {
      method: 'POST',
      token: deviceToken,
      body: JSON.stringify(payload),
    });
  }

  /**
   * Revokes this device registration.
   */
  public async revokeDevice(deviceToken: string): Promise<void> {
    await this.request<{ message: string }>('/api/companion/device/revoke', {
      method: 'POST',
      token: deviceToken,
    });
  }
}
