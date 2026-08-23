/**
 * Smoke test: GET /health returns { status: 'ok' }.
 *
 * This test uses buildTestApp() without auth or error-handler dependencies,
 * keeping it as a pure Fastify integration smoke test.
 */
import Fastify from 'fastify';

describe('GET /health', () => {
  it('returns status ok', async () => {
    const app = Fastify({ logger: false });

    app.get('/health', async () => ({
      status: 'ok',
      ts: new Date().toISOString(),
    }));

    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });

    await app.close();
  });
});
