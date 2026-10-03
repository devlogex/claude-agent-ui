/**
 * The in-process event bus behind the SSE stream.
 *
 * Events are small notifications ("runs changed", "task finished"), never payload dumps: a client
 * that misses one re-reads the resource. That keeps the bus memory flat — the replay buffer is
 * capped, and a slow subscriber can be dropped instead of being buffered without limit.
 */

export interface BusEvent<T = unknown> {
  /** Monotonic within one server process; used as the SSE `id:` field. */
  id: number;
  type: string;
  data: T;
  at: number;
}

export type Listener = (event: BusEvent) => void;

/** How many recent events are kept for reconnecting clients. */
export const DEFAULT_BUFFER_SIZE = 200;

export class EventBus {
  private listeners = new Set<Listener>();
  private buffer: BusEvent[] = [];
  private nextId = 1;
  private readonly bufferSize: number;

  constructor(opts: { bufferSize?: number } = {}) {
    this.bufferSize = Math.max(1, opts.bufferSize ?? DEFAULT_BUFFER_SIZE);
  }

  get lastEventId(): number {
    return this.nextId - 1;
  }

  emit<T>(type: string, data: T): BusEvent<T> {
    const event: BusEvent<T> = { id: this.nextId++, type, data, at: Date.now() };
    this.buffer.push(event as BusEvent);
    if (this.buffer.length > this.bufferSize) this.buffer.splice(0, this.buffer.length - this.bufferSize);
    for (const listener of [...this.listeners]) {
      try {
        listener(event as BusEvent);
      } catch {
        // One broken subscriber must not stop delivery to the others.
      }
    }
    return event;
  }

  /**
   * Events newer than `lastEventId` that are still buffered.
   * Returns null when the client is too far behind to be caught up — it should reload instead.
   */
  since(lastEventId: number): BusEvent[] | null {
    if (lastEventId >= this.lastEventId) return [];
    const oldest = this.buffer[0];
    if (oldest && lastEventId < oldest.id - 1) return null;
    return this.buffer.filter((e) => e.id > lastEventId);
  }

  /** Returns an unsubscribe function; calling it twice is harmless. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}
