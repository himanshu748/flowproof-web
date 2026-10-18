import { readFile, readdir } from "node:fs/promises";
/** Linux PSS apportions shared pages; RSS deliberately reports their double count. */
export function monitorProcessTree() {
  let measuring = false;
  let phase = "startup";
  const peaks: Record<
    string,
    { rssMiB: number; pssMiB: number; processes: number }
  > = {};
  const measure = async () => {
    if (measuring) return;
    measuring = true;
    const measuredPhase = phase;
    try {
      const parents = new Map<number, number[]>();
      await Promise.all(
        (await readdir("/proc"))
          .filter((x) => /^\d+$/.test(x))
          .map(async (pid) => {
            try {
              const status = await readFile(`/proc/${pid}/status`, "utf8");
              const parent = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]);
              parents.set(parent, [
                ...(parents.get(parent) ?? []),
                Number(pid),
              ]);
            } catch {
              /* Concurrent exit. */
            }
          }),
      );
      const seen = new Set<number>();
      const walk = async (
        pid: number,
      ): Promise<{ rss: number; pss: number }> => {
        if (seen.has(pid)) return { rss: 0, pss: 0 };
        seen.add(pid);
        let rss = 0,
          pss = 0;
        try {
          const usage = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
          rss = Number(/^Rss:\s+(\d+)/m.exec(usage)?.[1] ?? 0);
          pss = Number(/^Pss:\s+(\d+)/m.exec(usage)?.[1] ?? 0);
        } catch {
          /* Concurrent exit. */
        }
        for (const child of parents.get(pid) ?? []) {
          const usage = await walk(child);
          rss += usage.rss;
          pss += usage.pss;
        }
        return { rss, pss };
      };
      const memory = await walk(process.pid),
        before = peaks[measuredPhase] ?? { rssMiB: 0, pssMiB: 0, processes: 0 };
      peaks[measuredPhase] = {
        rssMiB: Math.max(before.rssMiB, memory.rss / 1024),
        pssMiB: Math.max(before.pssMiB, memory.pss / 1024),
        processes: Math.max(before.processes, seen.size),
      };
    } finally {
      measuring = false;
    }
  };
  const timer = setInterval(() => {
    void measure();
  }, 50);
  return {
    setPhase: (value: string) => {
      phase = value;
    },
    measure,
    stop: () => clearInterval(timer),
    get receipt() {
      return {
        samplingMs: 50,
        phases: structuredClone(peaks),
        peakRssMiB: Math.max(0, ...Object.values(peaks).map((x) => x.rssMiB)),
        peakPssMiB: Math.max(0, ...Object.values(peaks).map((x) => x.pssMiB)),
        explanation:
          "Linux process-tree smaps_rollup; RSS double-counts shared pages, PSS apportions them. Temporal excluded unless explicitly started by the verifier.",
      };
    },
  };
}
