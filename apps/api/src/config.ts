export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = env.API_PORT === undefined ? 3001 : Number(env.API_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  return { port, host: env.API_HOST ?? '127.0.0.1' };
}
