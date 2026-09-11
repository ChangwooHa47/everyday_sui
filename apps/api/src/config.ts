export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const portName = env.PORT !== undefined ? 'PORT' : 'API_PORT';
  const rawPort = env[portName];
  const port = rawPort === undefined ? 3001 : Number(rawPort);
  if ((rawPort !== undefined && !/^\d+$/.test(rawPort)) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${portName} must be an integer between 1 and 65535`);
  }
  return { port, host: env.API_HOST ?? (env.NODE_ENV === 'production' || env.PORT !== undefined ? '0.0.0.0' : '127.0.0.1') };
}
