import { sanitizeErrorMessage } from '@mindvault/shared';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  constructor(private context: string) {}

  private format(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    let sanitizedMsg = sanitizeErrorMessage(message);

    // Redact any bearer tokens that might be in the message
    sanitizedMsg = sanitizedMsg.replace(/mvd_[a-f0-9]{32,64}/gi, 'mvd_[REDACTED]');
    sanitizedMsg = sanitizedMsg.replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');

    const metaStr = meta
      ? ` | ${typeof meta === 'object' ? JSON.stringify(meta) : String(meta)}`
      : '';
    return `[${timestamp}] [${level}] [${this.context}] ${sanitizedMsg}${metaStr}`;
  }

  public debug(message: string, meta?: any): void {
    if (process.env.LOG_LEVEL === 'DEBUG') {
      console.debug(this.format('DEBUG', message, meta));
    }
  }

  public info(message: string, meta?: any): void {
    console.info(this.format('INFO', message, meta));
  }

  public warn(message: string, meta?: any): void {
    console.warn(this.format('WARN', message, meta));
  }

  public error(message: string, meta?: any): void {
    console.error(this.format('ERROR', message, meta));
  }
}
