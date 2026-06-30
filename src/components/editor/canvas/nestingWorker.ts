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
    const rt = materialize(msg.prepared);
    const result = runPlacement(rt, msg.strategy);
    (self as unknown as Worker).postMessage({ type: "result", attemptId: msg.attemptId, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "result",
      attemptId: msg.attemptId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
