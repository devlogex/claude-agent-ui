import { useQuery } from "@tanstack/react-query";
import { ApiError, api, listRuns, queryKeys, type RunStatus } from "../lib/api.ts";

/** Queue counters, from the task queue that M4 introduces. */
export interface TaskStats {
  queued: number;
  running: number;
}

/**
 * What the status bar shows, assembled from the resources that own each number.
 *
 * `queued` is `null` until M4 ships `/api/tasks/stats`. The bar renders that as a plain
 * "Queue unavailable" rather than inventing a zero — a console that reports a confident 0 for
 * a queue it cannot see is worse than one that admits it.
 */
export interface SystemStatus {
  /** `null` until the run list has been read, and again if reading it fails. */
  running: number | null;
  /** Runs parked on a prompt a human has to answer. The one counter that demands action. */
  needsInput: number | null;
  queued: number | null;
  isLoading: boolean;
  error: unknown;
}

/**
 * Both queries are invalidated by the SSE stream (see useEventStream.ts). Neither has a
 * refetch interval, here or in the client defaults: nothing in this app polls.
 */
export function useSystemStatus(): SystemStatus {
  const runs = useQuery({ queryKey: queryKeys.runs, queryFn: listRuns });

  const stats = useQuery({
    queryKey: queryKeys.taskStats,
    queryFn: async () => {
      try {
        return await api.get<TaskStats>("/api/tasks/stats");
      } catch (error) {
        // The endpoint lands in M4. Until then a 404 is the expected answer, not a failure
        // worth putting an error state on the whole status bar for.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });

  const count = (status: RunStatus) => (runs.data ? runs.data.runs.filter((r) => r.status === status).length : null);

  return {
    // Not `?? 0`: a confident zero while the read is failing is the same lie as a confident
    // zero for a queue we cannot see.
    running: count("running"),
    needsInput: count("waiting"),
    queued: stats.data?.queued ?? null,
    isLoading: runs.isLoading,
    error: runs.error,
  };
}
