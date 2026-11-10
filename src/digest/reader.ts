import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunLine, RunStatus } from './types.js';

// Plan morning-digest § 1. Parse at the edge, trust types after (styleguide).

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(v: unknown): v is RunStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

// One line → RunLine, or null when it doesn't parse or doesn't have the shape.
export function parseLine(line: string): RunLine | null {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.at !== 'string' || typeof r.job !== 'string' || !isStatus(r.status)) return null;
  if (r.owner !== null && r.owner !== undefined && typeof r.owner !== 'string') return null;
  if (r.error !== undefined && typeof r.error !== 'string') return null;
  return {
    at: r.at,
    job: r.job,
    status: r.status,
    owner: typeof r.owner === 'string' ? r.owner : null,
    ...(typeof r.error === 'string' ? { error: r.error } : {}),
  };
}

export function digestOf(night: string, text: string): NightDigest {
  const rows = new Map<string, DigestRow>();
  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (!line) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const row = rows.get(line.job);
    if (!row) {
      rows.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error ?? null,
        firstAt: line.at,
        lastAt: line.at,
      });
      continue;
    }
    row.runs++;
    if (line.status === 'retry') row.retries++;
    // The log is in time order; the latest line decides last status, error, owner.
    row.lastStatus = line.status;
    row.lastError = line.error ?? null;
    row.lastAt = line.at;
    if (line.owner !== null) row.owner = line.owner;
  }

  return {
    night,
    rows: [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0)),
    badLines,
    counts,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  return digestOf(night, text);
};
