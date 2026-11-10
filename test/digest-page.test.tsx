import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('digest page (smoke)', () => {
  it('renders a night with all jobs and warn markers', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of ['rig/rotate-logs', 'lane/sync', 'fixtures/refresh', 'notes/backup', 'digest/render']) {
      expect(html).toContain(job);
    }
    expect(html).toContain('class="warn"');
  });

  it('404s for a night without a log', async () => {
    const res = await createApp(config).request('/digest/2020-01-01');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for 2020-01-01');
  });
});
