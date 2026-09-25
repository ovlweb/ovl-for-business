import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, platformSettings } from '../src/db/schema';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let ann: Session;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  owner = await api.owner();
  ann = await api.register('ann');
});
afterAll(() => app.close());

describe('metrics', () => {
  it('counts requests per route for Prometheus, from private networks only', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/api/v1/stock/listings/NOPE' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
    expect(res.body).toContain('# TYPE ovl_http_requests_total counter');
    expect(res.body).toContain('ovl_http_requests_total{method="GET",route="/health",status="200"} 1');
    expect(res.body).toContain(
      'ovl_http_requests_total{method="GET",route="/api/v1/stock/listings/:ticker",status="404"} 1',
    );
    expect(res.body).toMatch(
      /ovl_http_request_duration_seconds_bucket\{method="GET",route="\/health",le="\+Inf"\} 1/,
    );
    expect(res.body).toMatch(/ovl_realtime_connections 0/);
    expect(res.body).toMatch(/ovl_notifications_waiting \d+/);
    expect(res.body).toMatch(/ovl_process_resident_memory_bytes \d+/);

    const outside = await app.inject({ method: 'GET', url: '/metrics', remoteAddress: '203.0.113.9' });
    expect(outside.statusCode).toBe(404);
  });
});

describe('trace context', () => {
  it('continues an incoming trace and starts one otherwise', async () => {
    const trace = '4bf92f3577b34da6a3ce929d0e0e4736';
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { traceparent: `00-${trace}-00f067aa0ba902b7-01` },
    });
    expect(res.headers.traceparent).toMatch(new RegExp(`^00-${trace}-[0-9a-f]{16}-01$`));
    expect(res.headers['server-timing']).toMatch(/^app;dur=\d+(\.\d)?$/);
    const fresh = await app.inject({ method: 'GET', url: '/health', headers: { traceparent: 'garbage' } });
    expect(fresh.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(fresh.headers.traceparent).not.toContain(trace);
  });
});

describe('system status', () => {
  it('shows admins the instances, queues, jobs and the last backup', async () => {
    expect((await api.get('/admin/system', ann)).status).toBe(403);
    const before = await api.get('/admin/system', owner);
    expect(before.body).toMatchObject({ instances: 1, onlineUsers: 0, lastBackup: null });
    expect(before.body.jobs.map((j: { name: string }) => j.name)).toContain('notifications');
    await app.db.insert(platformSettings).values({
      key: 'backup',
      value: { at: '2026-09-25T03:00:00Z', file: 'ovl-20260925-0300.dump', bytes: 123456 },
    });
    expect((await api.get('/admin/system', owner)).body.lastBackup).toEqual({
      at: '2026-09-25T03:00:00.000Z',
      file: 'ovl-20260925-0300.dump',
      bytes: 123456,
    });
  });
});

describe('audit export', () => {
  it('exports the audit log as CSV or NDJSON, safely for spreadsheets', async () => {
    await app.db.insert(auditLogs).values([
      {
        actorId: owner.id,
        action: 'user.update',
        targetType: 'user',
        targetId: ann.id,
        data: { role: 'user' },
      },
      {
        actorId: null,
        action: 'cash.deposit',
        targetType: 'wallet',
        targetId: '=HYPERLINK("x")',
        data: { note: 'a, "b"' },
      },
    ]);
    expect((await api.get('/admin/audit-logs/export', ann)).status).toBe(403);

    const csv = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs/export?format=csv&action=cash.',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-disposition']).toMatch(
      /attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const lines = csv.body.trim().split('\n');
    expect(lines[0]).toBe('id,created_at,actor_id,actor_username,action,target_type,target_id,ip,data');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`cash.deposit,wallet,"'=HYPERLINK(""x"")",,"{""note"":""a, \\""b\\""""}"`);

    const ndjson = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs/export?format=ndjson',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const entries = ndjson.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { id: number; action: string; actor: { username: string } | null });
    expect(entries.map((e) => e.id)).toEqual([...entries.map((e) => e.id)].sort((x, y) => x - y));
    expect(entries.find((e) => e.action === 'user.update')?.actor?.username).toBe('owner');
    // Exporting is itself audited.
    expect(entries.some((e) => e.action === 'audit.export')).toBe(true);
  });
});

// Last: a second app starts from an empty database.
describe('metrics with a token', () => {
  it('asks for the token when one is configured', async () => {
    const token = 'metrics-token-0123456789';
    const guarded = await createTestApp({ METRICS_TOKEN: token });
    try {
      expect((await guarded.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(404);
      const ok = await guarded.inject({
        method: 'GET',
        url: '/metrics',
        remoteAddress: '203.0.113.9',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);
    } finally {
      await guarded.close();
    }
  });
});
