/**
 * A small Prometheus registry: counters, gauges and histograms with labels, rendered in the text
 * exposition format at GET /metrics. Gauges can be read at scrape time with a callback.
 */
type Labels = Record<string, string | number>;

const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labelText = (labels: Labels) => {
  const entries = Object.entries(labels);
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${escape(String(v))}"`).join(',')}}` : '';
};
const keyOf = (labels: Labels) =>
  JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: 'counter' | 'gauge' | 'histogram',
  ) {}
  abstract lines(): Promise<string[]>;
}

export class Counter extends Metric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(name: string, help: string) {
    super(name, help, 'counter');
  }
  inc(labels: Labels = {}, by = 1) {
    const key = keyOf(labels);
    const entry = this.values.get(key) ?? { labels, value: 0 };
    entry.value += by;
    this.values.set(key, entry);
  }
  async lines() {
    return [...this.values.values()].map((v) => `${this.name}${labelText(v.labels)} ${v.value}`);
  }
}

type Collect = () => Promise<{ labels?: Labels; value: number }[]> | { labels?: Labels; value: number }[];

/** A value read when scraped: a gauge, or a counter kept elsewhere. */
export class Gauge extends Metric {
  constructor(
    name: string,
    help: string,
    private readonly collect: Collect,
    type: 'gauge' | 'counter' = 'gauge',
  ) {
    super(name, help, type);
  }
  async lines() {
    return (await this.collect()).map((v) => `${this.name}${labelText(v.labels ?? {})} ${v.value}`);
  }
}

export class Histogram extends Metric {
  private readonly values = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();
  constructor(
    name: string,
    help: string,
    private readonly buckets: number[],
  ) {
    super(name, help, 'histogram');
  }
  observe(labels: Labels, value: number) {
    const key = keyOf(labels);
    const entry = this.values.get(key) ?? { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
    this.buckets.forEach((b, i) => {
      if (value <= b) entry.counts[i]! += 1;
    });
    entry.sum += value;
    entry.count += 1;
    this.values.set(key, entry);
  }
  async lines() {
    const out: string[] = [];
    for (const v of this.values.values()) {
      this.buckets.forEach((b, i) =>
        out.push(`${this.name}_bucket${labelText({ ...v.labels, le: b })} ${v.counts[i]}`),
      );
      out.push(`${this.name}_bucket${labelText({ ...v.labels, le: '+Inf' })} ${v.count}`);
      out.push(`${this.name}_sum${labelText(v.labels)} ${v.sum}`);
      out.push(`${this.name}_count${labelText(v.labels)} ${v.count}`);
    }
    return out;
  }
}

export class Metrics {
  private readonly metrics: Metric[] = [];

  counter(name: string, help: string) {
    const m = new Counter(name, help);
    this.metrics.push(m);
    return m;
  }

  gauge(name: string, help: string, collect: Collect, type: 'gauge' | 'counter' = 'gauge') {
    const m = new Gauge(name, help, collect, type);
    this.metrics.push(m);
    return m;
  }

  histogram(name: string, help: string, buckets: number[]) {
    const m = new Histogram(name, help, buckets);
    this.metrics.push(m);
    return m;
  }

  async render(): Promise<string> {
    const parts: string[] = [];
    for (const m of this.metrics) {
      let lines: string[];
      try {
        lines = await m.lines();
      } catch {
        continue; // A gauge whose source is down is left out rather than failing the scrape.
      }
      parts.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} ${m.type}`, ...lines);
    }
    return `${parts.join('\n')}\n`;
  }
}
