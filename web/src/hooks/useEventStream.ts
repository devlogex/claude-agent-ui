import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { queryKeys } from "../lib/api.ts";
import {
  SERVER_EVENTS,
  connectEventStream,
  type ConnectionState,
  type EventStreamOptions,
  type StreamEvent,
} from "../lib/eventStream.ts";

/**
 * Which caches a server event makes stale.
 *
 * Deliberately a lookup table rather than a switch buried in the effect: when M3–M5 add
 * `task:*` and `schedule:*` events, the change is one row here and nothing else moves.
 * `null` means "everything" — that is the reset case, where we cannot know what we missed.
 */
const INVALIDATES: Record<string, readonly (readonly unknown[])[] | null> = {
  [SERVER_EVENTS.runStarted]: [queryKeys.runs, queryKeys.taskStats],
  [SERVER_EVENTS.runStopped]: [queryKeys.runs, queryKeys.taskStats],
  [SERVER_EVENTS.runRemoved]: [queryKeys.runs, queryKeys.taskStats],
  [SERVER_EVENTS.reset]: null,
};

export const ConnectionContext = createContext<ConnectionState>("connecting");

/** The stream's health, for the status bar. */
export function useConnectionState(): ConnectionState {
  return useContext(ConnectionContext);
}

/**
 * Opens the one SSE connection for the app and wires it to the query cache.
 *
 * Call this exactly once, from the shell. The ref guard is not belt-and-braces: React 19 Strict
 * Mode mounts effects twice in development, and without it that is two sockets on every reload.
 */
export function useEventStreamConnection(opts: EventStreamOptions = {}): ConnectionState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>("connecting");

  // Keep the live options in a ref so a caller passing an inline object literal does not
  // reconnect the stream on every render.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handleEvent = ({ name }: StreamEvent) => {
      const keys = INVALIDATES[name];
      if (keys === undefined) return; // An event this client version does not know about.
      if (keys === null) {
        void queryClient.invalidateQueries();
        return;
      }
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    };

    return connectEventStream({ onEvent: handleEvent, onStateChange: setState }, optsRef.current);
    // queryClient is stable for the life of the provider; the stream opens once.
  }, [queryClient]);

  return state;
}
