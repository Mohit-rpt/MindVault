type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    console.log(`[${timestamp}] [${level}] [${this.context}] ${message}${metaStr}`);
  }

  info(message: string, meta?: unknown): void {
    this.log('INFO', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('WARN', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log('ERROR', message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.log('DEBUG', message, meta);
  }
}
