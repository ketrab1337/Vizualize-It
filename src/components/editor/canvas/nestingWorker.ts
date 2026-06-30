// Web Worker skanu nestingu. Importuje WYŁĄCZNIE `nestingCore` (bez Paper.js), więc bundle
// workera nie zawiera Paper.js ani nie dotyka DOM. Każda wiadomość jest samowystarczalna
// (niesie własny `prepared`), dzięki czemu jeden worker może obsługiwać próby z RÓŻNYCH
// układań (różne projekty/płyty) bez współdzielonego stanu.

import { materialize, runPlacement, type PreparedNest, type NestStrategy } from "./nestingCore";

interface RunMsg {
  type: "run";
  attemptId: number;
  prepared: PreparedNest;
  strategy: NestStrategy;
}

self.onmessage = (e: MessageEvent<RunMsg>) => {
  const msg = e.data;
  if (msg.type !== "run") return;
  try {
    const tm0 = performance.now();
    const rt = materialize(msg.prepared);
    const tm1 = performance.now();
    const result = runPlacement(rt, msg.strategy);
    // DIAGNOSTYKA (tymczasowe) — gdzie idzie czas skanu. Jedna linia na próbę.
    const d = result.diag;
    if (d) {
      // eslint-disable-next-line no-console
      console.log(
        `[nesting diag] ${msg.strategy.sort}/${msg.strategy.seed} | materialize ${(tm1 - tm0).toFixed(0)}ms | place ${d.ms.toFixed(0)}ms | elems ${d.elements} ułożono ${result.placed.length} | frontierScan ${d.frontierScans} coarseFallback ${d.coarseFallbacks} firstScan ${d.firstScans} | evalPos ${d.evalPos.toLocaleString()} fits ${d.fits.toLocaleString()} coarseSkip ${d.coarseSkips.toLocaleString()} | frontierSum ${d.frontierSum.toLocaleString()} max ${d.maxFrontier}`,
      );
    }
    (self as unknown as Worker).postMessage({ type: "result", attemptId: msg.attemptId, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "result",
      attemptId: msg.attemptId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
