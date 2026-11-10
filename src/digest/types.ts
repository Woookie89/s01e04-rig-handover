// Plan morning-digest § 1. The contract every part of § 2 builds against: commit this first.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing at the edge.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night.
export type DigestRow = {
  job: string;
  owner: string | null; // null stays a row; views show it as `—`
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string; // as in the log, offset kept
  lastAt: string;
};

export type NightDigest = {
  night: string; // YYYY-MM-DD, the file name
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that did not parse; counted, never thrown
  counts: Record<RunStatus, number>; // log lines by status (board link, § 2c)
};

// null when runs/<night>.jsonl does not exist (the page answers 404).
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
