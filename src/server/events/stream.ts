import { withWorkspace } from "@/server/db/client";
import { mapEvent, type EventRow } from "@/server/events/repository";

interface EventStreamFilter {
  workspaceId: string;
  conversationId?: string;
  runId?: string;
  after: number;
}

const encoder = new TextEncoder();

function eventChunk(row: EventRow): Uint8Array {
  const event = mapEvent(row);
  return encoder.encode(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

async function readEvents(filter: EventStreamFilter, after: number): Promise<EventRow[]> {
  return withWorkspace(filter.workspaceId, async (transaction) => {
    return transaction<EventRow[]>`
      SELECT id, type, run_id, iteration_id, payload, created_at
      FROM events
      WHERE workspace_id = ${filter.workspaceId}
        AND id > ${after}
        AND (${filter.conversationId ?? null}::uuid IS NULL OR conversation_id = ${filter.conversationId ?? null})
        AND (${filter.runId ?? null}::uuid IS NULL OR run_id = ${filter.runId ?? null})
      ORDER BY id
      LIMIT 100
    `;
  });
}

export function createEventStream(filter: EventStreamFilter, signal: AbortSignal): ReadableStream<Uint8Array> {
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener("abort", () => {
        cancelled = true;
      }, { once: true });

      void (async () => {
        let cursor = filter.after;
        let lastHeartbeat = Date.now();
        controller.enqueue(encoder.encode("retry: 2000\n\n"));

        try {
          while (!cancelled && !signal.aborted) {
            const rows = await readEvents(filter, cursor);

            for (const row of rows) {
              if (cancelled || signal.aborted) {
                break;
              }
              controller.enqueue(eventChunk(row));
              cursor = Number(row.id);
              lastHeartbeat = Date.now();
            }

            if (rows.length === 100) {
              continue;
            }

            if (Date.now() - lastHeartbeat >= 15_000) {
              controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
              lastHeartbeat = Date.now();
            }

            await wait(1_000, signal);
          }
        } catch (error) {
          if (!cancelled && !signal.aborted) {
            console.error("Event stream failed", error);
          }
        } finally {
          if (!cancelled) {
            try {
              controller.close();
            } catch {
              cancelled = true;
            }
          }
        }
      })();
    },
    cancel() {
      cancelled = true;
    }
  });
}
