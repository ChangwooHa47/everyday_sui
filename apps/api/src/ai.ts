import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import { characterSchema, messagesSchema, generateTurn, type AiConfig } from './turn-service.js';
export type { AiConfig } from './turn-service.js';
const inputSchema = z.object({ requestId: z.uuid(), character: characterSchema,
  episode: z.string().max(1000).optional(), messages: messagesSchema }).strict();
// Studio-only freeform characters. Paid characters use the market route and server package.
export function registerAi(app: FastifyInstance, db: Database, auth: AuthConfig, config?: AiConfig) {
  app.post('/v1/ai/turns', async req => {
    const actor = await authenticate(req, db, auth);
    const input = inputSchema.parse(req.body);
    return generateTurn(db, config, { actor, requestId: input.requestId,
      fingerprint: { scope: 'studio', ...input, requestId: undefined }, messages: input.messages,
      system: `You are a fictional companion. Reply in Korean. Character: ${JSON.stringify(input.character)}. Episode: ${input.episode ?? 'ordinary conversation'}` });
  });
}
