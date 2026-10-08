/// <reference lib="webworker" />
import { createStaticQueryHandler, type WorkerRequest } from './staticQueryWorkerProtocol';

/** Web Worker entry (module worker). Reads only the pinned snapshot's static files; never writes, never calls an API. */
const handle = createStaticQueryHandler(async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Static snapshot file unavailable (${response.status}).`);
  return response.json() as Promise<unknown>;
});

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  self.postMessage(await handle(event.data));
};
