import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { env } from '../config/env.js';
import { formatZodDetails } from '../lib/zod-error-map.js';

/**
 * Centralized error handler.
 *
 * - HttpError   -> its status + a stable error code
 * - ZodError    -> 422 with field-level details (each with a stable code)
 * - Everything else -> 500 with a generic message in production (the stack is
 *   logged server-side, never leaked to the client).
 */
export async function errorHandler(app: FastifyInstance): Promise<void> {
  app.setErrorHandler(
    (err: FastifyError & { details?: unknown }, req: FastifyRequest, reply: FastifyReply) => {
      if (err instanceof HttpError) {
        return reply.status(err.statusCode).send({
          error: { code: err.code, message: err.message, details: err.details },
        });
      }

      if (err instanceof ZodError) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed.',
            details: formatZodDetails(err),
          },
        });
      }

      // Fastify's own schema-validation errors carry validation as an array.
      if (err.validation) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: err.message,
          },
        });
      }

      req.log.error({ err }, 'Unhandled error.');
      return reply.status(500).send({
        error: {
          code: 'INTERNAL',
          message:
            env.NODE_ENV === 'production'
              ? 'Internal server error.'
              : err.message ?? 'Unknown error.',
        },
      });
    },
  );
}
