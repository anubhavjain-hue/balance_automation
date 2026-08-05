export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(partner: string, task: string): Logger {
  function write(level: string, msg: string, meta?: Record<string, unknown>) {
    process.stdout.write(
      JSON.stringify({ ts: new Date().toISOString(), level, partner, task, msg, ...meta }) + '\n'
    );
  }
  return {
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
  };
}
