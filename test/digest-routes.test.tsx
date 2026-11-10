import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { NightDigest } from '../src/digest/types.js';

// Routes through createApp().request(), with our own small logs in a temp dir (runs/ stays untouched).

const NORMAL = '2026-11-01';
const EMPTY = '2026-11-02';
const BAD = '2026-11-03';
const MISSING = '2026-11-04';

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error ? { error } : {}) });

// Lines are deliberately out of job order in the file; both views must still sort by job.
const normalLog = [
  line('2026-11-01T02:00:00+01:00', 'lane/sync', 'ok', 'lukas'),
  line('2026-11-01T02:01:00+01:00', 'rig/rotate-logs', 'ok', null),
  line('2026-11-01T02:02:00+01:00', 'notes/backup', 'ok', 'lukas'),
  line('2026-11-01T02:03:00+01:00', 'digest/render', 'retry', 'ana', 'timeout'),
  line('2026-11-01T02:04:00+01:00', 'fixtures/refresh', 'retry', 'ana', 'timeout'),
  line('2026-11-01T02:05:00+01:00', 'digest/render', 'retry', 'ana', 'timeout'),
  line('2026-11-01T02:06:00+01:00', 'digest/render', 'retry', 'ana', 'timeout'),
  line('2026-11-01T02:07:00+01:00', 'digest/render', 'ok', 'ana'),
  line('2026-11-01T02:08:00+01:00', 'fixtures/refresh', 'retry', 'ana', 'timeout'),
  line('2026-11-01T02:09:00+01:00', 'fixtures/refresh', 'ok', 'ana'),
  line('2026-11-01T02:10:00+01:00', 'notes/backup', 'fail', 'lukas', 'disk full'),
  line('2026-11-01T02:11:00+01:00', 'rig/rotate-logs', 'ok', null),
  line('2026-11-01T02:12:00+01:00', 'lane/sync', 'ok', null),
].join('\n');

const badLog = [
  line('2026-11-03T02:00:00+01:00', 'lane/sync', 'ok', 'lukas'),
  'this is not json',
  line('2026-11-03T02:01:00+01:00', 'notes/backup', 'fail', 'lukas', 'disk full'),
].join('\n');

let runsDir: string;
let config: RigConfig;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), `${normalLog}\n`);
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD}.jsonl`), `${badLog}\n`);
  config = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

type PageRow = { job: string; owner: string; cls: string | undefined };

// Table body rows of the digest page, in document order.
function pageRows(html: string): PageRow[] {
  const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  const rows: PageRow[] = [];
  for (const m of tbody.matchAll(/<tr(?: class="([^"]*)")?>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[2].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    rows.push({ job: cells[0], owner: cells[1], cls: m[1] });
  }
  return rows;
}

async function page(night: string) {
  const res = await createApp(config).request(`/digest/${night}`);
  return { res, html: await res.text() };
}

async function api(night: string) {
  return createApp(config).request(`/api/digest/${night}`);
}

describe('GET /digest/:night (page)', () => {
  it('200 for a normal night, with every job listed', async () => {
    const { res, html } = await page(NORMAL);
    expect(res.status).toBe(200);
    expect(html).toContain('<h1>digest 2026-11-01</h1>');
    expect(pageRows(html).map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(html).not.toContain('could not be read');
  });

  it('404 for a night with no file, saying so', async () => {
    const { res, html } = await page(MISSING);
    expect(res.status).toBe(404);
    expect(html).toContain(`no run log for ${MISSING}`);
  });

  it('shows "nothing ran" and no table for the empty night', async () => {
    const { res, html } = await page(EMPTY);
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table>');
    expect(html).not.toContain('could not be read');
  });

  it('shows the bad-line note and still renders the rows for a night with a bad line', async () => {
    const { res, html } = await page(BAD);
    expect(res.status).toBe(200);
    expect(html).toContain('1 line could not be read');
    expect(pageRows(html).map((r) => r.job)).toEqual(['lane/sync', 'notes/backup']);
  });

  it('renders a null owner as the dash', async () => {
    const rows = pageRows((await page(NORMAL)).html);
    const rotate = rows.find((r) => r.job === 'rig/rotate-logs');
    expect(rotate?.owner).toBe('—');
    expect(rows.find((r) => r.job === 'lane/sync')?.owner).toBe('lukas');
  });

  it('marks retries >= 3 and a last status of fail with class warn, and nothing else', async () => {
    const rows = pageRows((await page(NORMAL)).html);
    const byJob = Object.fromEntries(rows.map((r) => [r.job, r.cls]));
    expect(byJob['digest/render']).toBe('warn'); // 3 retries, last ok
    expect(byJob['notes/backup']).toBe('warn'); // last fail
    expect(byJob['fixtures/refresh']).toBeUndefined(); // 2 retries, last ok
    expect(byJob['lane/sync']).toBeUndefined();
    expect(byJob['rig/rotate-logs']).toBeUndefined();
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('200 for a normal night, with rows and counts', async () => {
    const res = await api(NORMAL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as NightDigest;
    expect(body.night).toBe(NORMAL);
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 7, retry: 5, fail: 1 });
    expect(body.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('404 with the error body for a night with no file', async () => {
    const res = await api(MISSING);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('empty night: rows [] and badLines 0', async () => {
    const res = await api(EMPTY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as NightDigest;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('night with a bad line: badLines 1, rows still present', async () => {
    const res = await api(BAD);
    expect(res.status).toBe(200);
    const body = (await res.json()) as NightDigest;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync', 'notes/backup']);
  });

  it('null owner stays null in JSON', async () => {
    const body = (await (await api(NORMAL)).json()) as NightDigest;
    expect(body.rows.find((r) => r.job === 'rig/rotate-logs')?.owner).toBeNull();
    expect(body.rows.find((r) => r.job === 'lane/sync')?.owner).toBe('lukas');
  });
});

describe('page and JSON agree', () => {
  it.each([NORMAL, EMPTY, BAD])('%s lists the same jobs in the same order', async (night) => {
    const { html } = await page(night);
    const body = (await (await api(night)).json()) as NightDigest;
    expect(pageRows(html).map((r) => r.job)).toEqual(body.rows.map((r) => r.job));
  });

  it('the page owner cell is the JSON owner, or the dash when JSON owner is null', async () => {
    const { html } = await page(NORMAL);
    const body = (await (await api(NORMAL)).json()) as NightDigest;
    const rows = pageRows(html);
    for (const row of body.rows) {
      const shown = rows.find((r) => r.job === row.job)?.owner;
      expect(shown).toBe(row.owner ?? '—');
    }
  });
});
