import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

describe('readNight', () => {
  it('reads 2026-10-28: 5 jobs, 1 bad line', () => {
    const d = readNight('runs', '2026-10-28');
    expect(d).not.toBeNull();
    expect(d!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(d!.badLines).toBe(1);
    expect(d!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('builds one row per job with runs, retries, last status and times', () => {
    const rows = readNight('runs', '2026-10-28')!.rows;
    const refresh = rows.find((r) => r.job === 'fixtures/refresh')!;
    expect(refresh).toMatchObject({
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      lastStatus: 'fail',
      lastError: 'quota exceeded',
    });
  });

  it('keeps a row whose owner is null', () => {
    const render = readNight('runs', '2026-10-28')!.rows.find((r) => r.job === 'digest/render');
    expect(render).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok' });
  });

  it('returns null for a night with no file, and no rows for an empty file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
    writeFileSync(join(dir, '2026-10-30.jsonl'), '');
    expect(readNight(dir, '2026-10-31')).toBeNull();
    expect(readNight(dir, '../etc')).toBeNull();
    expect(readNight(dir, '2026-10-30')).toEqual({
      night: '2026-10-30',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });
});
