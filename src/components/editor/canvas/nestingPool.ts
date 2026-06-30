// Pula Web Workerów do skanu nestingu. Trzyma stały zestaw workerów (≤ liczba rdzeni) i kolejkę
// zadań. Dzięki temu:
//  - jedno układanie z N próbami (multi-start) liczy się RÓWNOLEGLE na wielu rdzeniach,
//  - kilka układań odpalonych „na raz" (różne projekty/płyty) DZIELI pulę zamiast przeciążać CPU
//    (zadania ponad liczbę workerów czekają w kolejce).
// Główny wątek (UI) pozostaje wolny — skan dzieje się poza nim.

import {
  strategiesForAttempts,
  pickBest,
  type PreparedNest,
  type NestResult,
  type NestStrategy,
} from "./nestingCore";

interface Task {
  prepared: PreparedNest;
  strategy: NestStrategy;
  attemptId: number;
  resolve: (r: NestResult) => void;
  reject: (e: unknown) => void;
}

interface WorkerRec {
  worker: Worker;
  task: Task | null;
}

interface ResultMsg {
  type: "result";
  attemptId: number;
  result?: NestResult;
  error?: string;
}

class NestingPool {
  private recs: WorkerRec[] = [];
  private queue: Task[] = [];
  private nextId = 1;
  private readonly max: number;
  /** false dopóki nie potwierdzimy, że środowisko w ogóle tworzy workery. */
  private supported = true;

  constructor() {
    const hc = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    // Zostaw jeden rdzeń na UI/resztę; trzymaj sensowny sufit.
    this.max = Math.max(1, Math.min(hc - 1 || 1, 8));
  }

  /** Czy pula może działać (workery wspierane i dotąd nie zawiodły przy tworzeniu). */
  isSupported(): boolean {
    return this.supported && typeof Worker !== "undefined";
  }

  private spawn(): WorkerRec | null {
    try {
      const worker = new Worker(new URL("./nestingWorker.ts", import.meta.url), { type: "module" });
      const rec: WorkerRec = { worker, task: null };
      worker.onmessage = (e: MessageEvent<ResultMsg>) => this.onMessage(rec, e.data);
      worker.onerror = () => this.onWorkerError(rec);
      return rec;
    } catch {
      this.supported = false;
      return null;
    }
  }

  private ensureWorkers(): void {
    while (this.recs.length < this.max && (this.queue.length > 0 || this.recs.length === 0)) {
      const rec = this.spawn();
      if (!rec) break;
      this.recs.push(rec);
      if (this.recs.length >= this.queue.length) break; // tyle workerów ile trzeba (≤ max)
    }
  }

  private onMessage(rec: WorkerRec, data: ResultMsg): void {
    const task = rec.task;
    rec.task = null;
    if (task) {
      if (data.error) task.reject(new Error(data.error));
      else if (data.result) task.resolve(data.result);
      else task.reject(new Error("Nesting worker: pusty wynik"));
    }
    this.pump();
  }

  private onWorkerError(rec: WorkerRec): void {
    // Worker padł — odrzuć jego zadanie, usuń go i pozwól puli odtworzyć następny.
    const task = rec.task;
    rec.task = null;
    try {
      rec.worker.terminate();
    } catch {
      /* ignore */
    }
    this.recs = this.recs.filter((r) => r !== rec);
    if (task) task.reject(new Error("Nesting worker error"));
    this.pump();
  }

  private pump(): void {
    if (this.queue.length === 0) return;
    this.ensureWorkers();
    for (const rec of this.recs) {
      if (rec.task) continue;
      const task = this.queue.shift();
      if (!task) break;
      rec.task = task;
      rec.worker.postMessage({
        type: "run",
        attemptId: task.attemptId,
        prepared: task.prepared,
        strategy: task.strategy,
      });
    }
  }

  /** Zleca jedną próbę. Promise spełnia się wynikiem `runPlacement` z workera. */
  private submit(prepared: PreparedNest, strategy: NestStrategy): Promise<NestResult> {
    return new Promise<NestResult>((resolve, reject) => {
      this.queue.push({ prepared, strategy, attemptId: this.nextId++, resolve, reject });
      this.pump();
    });
  }

  /**
   * Uruchamia `attempts` prób na puli i zwraca NAJLEPSZY wynik. Wyniki zbierane są w kolejności
   * strategii (indeks 0 = domyślna), więc `pickBest` przy remisie wybiera domyślną → wynik
   * gwarantowany nie gorszy niż pojedyncze „Układaj".
   */
  async runBest(prepared: PreparedNest, attempts: number): Promise<NestResult> {
    const strategies = strategiesForAttempts(attempts);
    const results = await Promise.all(strategies.map((s) => this.submit(prepared, s)));
    return pickBest(results);
  }
}

/** Singleton — workery tworzone leniwie przy pierwszym zadaniu, współdzielone między układaniami. */
export const nestingPool = new NestingPool();
