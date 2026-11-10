import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('digest api', () => {
  it('answers 2026-10-28 with the same jobs readNight gives, and 404 for a missing night', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string }[] };
    expect(body.night).toBe('2026-10-28');
    expect(body.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);

    const missing = await createApp(config).request('/api/digest/2026-10-31');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'no run log', night: '2026-10-31' });
  });
});
