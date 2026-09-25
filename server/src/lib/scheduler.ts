import type { FastifyBaseLogger } from 'fastify';

/**
 * Periodic background jobs (recurring invoices, and later expiries and monthly statements).
 * Jobs must be safe to run on several server instances at once: they claim their work with
 * `FOR UPDATE SKIP LOCKED`, so a second instance simply finds nothing left to do.
 */
export interface Job {
  name: string;
  everySeconds: number;
  run: () => Promise<unknown>;
}

interface JobState extends Job {
  timer?: NodeJS.Timeout;
  running?: Promise<void>;
  runs: number;
  failures: number;
  lastRunAt: Date | null;
  lastError: string | null;
}

export interface JobStatus {
  name: string;
  everySeconds: number;
  runs: number;
  failures: number;
  lastRunAt: string | null;
  lastError: string | null;
}

export class Scheduler {
  private readonly jobs = new Map<string, JobState>();
  private started = false;

  constructor(private readonly log: FastifyBaseLogger) {}

  add(job: Job) {
    if (this.jobs.has(job.name)) throw new Error(`Job ${job.name} is already scheduled`);
    const state: JobState = { ...job, runs: 0, failures: 0, lastRunAt: null, lastError: null };
    this.jobs.set(job.name, state);
    if (this.started) this.arm(state);
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const job of this.jobs.values()) this.arm(job);
  }

  async stop() {
    this.started = false;
    for (const job of this.jobs.values()) clearInterval(job.timer);
    await Promise.all([...this.jobs.values()].map((j) => j.running));
  }

  /** Run a job now (and wait for it); a run already in progress is awaited instead. */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job ${name}`);
    await this.tick(job);
  }

  status(): JobStatus[] {
    return [...this.jobs.values()].map((j) => ({
      name: j.name,
      everySeconds: j.everySeconds,
      runs: j.runs,
      failures: j.failures,
      lastRunAt: j.lastRunAt?.toISOString() ?? null,
      lastError: j.lastError,
    }));
  }

  private arm(job: JobState) {
    job.timer = setInterval(() => void this.tick(job), job.everySeconds * 1000);
    job.timer.unref();
    // A first run soon after start, so work that fell due while the server was down is not late.
    setTimeout(() => this.started && void this.tick(job), 2_000).unref();
  }

  private tick(job: JobState): Promise<void> {
    job.running ??= (async () => {
      const started = Date.now();
      try {
        await job.run();
        job.lastError = null;
      } catch (error) {
        job.failures += 1;
        job.lastError = error instanceof Error ? error.message : String(error);
        this.log.error({ err: error, job: job.name }, 'scheduled job failed');
      } finally {
        job.runs += 1;
        job.lastRunAt = new Date(started);
        job.running = undefined;
      }
    })();
    return job.running;
  }
}
