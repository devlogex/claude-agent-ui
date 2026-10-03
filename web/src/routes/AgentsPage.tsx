import { useQuery } from "@tanstack/react-query";
import { Bot, FileWarning } from "lucide-react";
import { useState } from "react";
import { DataTable, type Column, type SortState } from "../components/DataTable.tsx";
import { Page } from "../components/Page.tsx";
import { EmptyState, ErrorState, LoadingState } from "../components/States.tsx";
import { StatusBadge, type Status } from "../components/StatusBadge.tsx";
import { TwoPane } from "../components/TwoPane.tsx";
import { listAgents, listRuns, queryKeys, type Agent, type RunStatus, type RunView } from "../lib/api.ts";
import { cn, relativeTime } from "../lib/utils.ts";

/**
 * M2 placeholder for the Agents screen: the real list, the real runs, no editor yet.
 *
 * It reads `/api/agents` and `/api/runs`, which already exist, so the shell's primitives
 * (two-pane, data table, status badge, and the three states) are exercised against live data
 * instead of a mock. M3 replaces the right-hand pane with the agent editor.
 */

/**
 * Server run status → badge. Exhaustive by type: adding a member to RunStatus breaks this
 * until someone decides how it should read, which is the point.
 */
const RUN_STATUS: Record<RunStatus, Status> = {
  running: "running",
  waiting: "waiting",
  finished: "finished",
  failed: "failed",
  stopped: "idle",
  missing: "missing",
  unknown: "unknown",
};

export function AgentsPage() {
  const agents = useQuery({ queryKey: queryKeys.agents, queryFn: listAgents });
  const runs = useQuery({ queryKey: queryKeys.runs, queryFn: listRuns });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ columnId: "startedAt", direction: "desc" });

  const selected = agents.data?.find((a) => a.id === selectedId) ?? null;
  const agentRuns = (runs.data?.runs ?? []).filter((run) => !selected || run.agent === selected.runName);

  return (
    <Page
      title="Agents"
      description="Agent definitions found on disk, and the runs they have started"
      bodyClassName="flex"
    >
      <TwoPane
        listLabel="Agents"
        mobilePane={selected ? "detail" : "list"}
        list={
          agents.isLoading ? (
            <LoadingState label="Loading agents" className="p-2" />
          ) : agents.error ? (
            <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
          ) : (agents.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Bot}
              title="No agents found"
              description="Agent definitions are Markdown files in ~/.claude/agents. Add one and it will appear here."
            />
          ) : (
            <ul className="flex flex-col gap-px p-2">
              {agents.data!.map((agent) => (
                <AgentListItem
                  key={agent.id}
                  agent={agent}
                  selected={agent.id === selectedId}
                  onSelect={() => setSelectedId(agent.id)}
                />
              ))}
            </ul>
          )
        }
        detailLabel="Agent runs"
        detail={
          <DataTable<RunView>
            caption={selected ? `Runs of ${selected.name}` : "All runs"}
            columns={runColumns}
            rows={agentRuns}
            rowKey={(run) => run.runId}
            sort={sort}
            onSortChange={setSort}
            isLoading={runs.isLoading}
            error={runs.error}
            onRetry={() => void runs.refetch()}
            empty={{
              title: selected ? `${selected.name} has not run yet` : "No runs yet",
              description:
                "Starting an agent from this screen arrives in the next milestone. Runs started from the CLI show up here as soon as they begin.",
            }}
          />
        }
      />
    </Page>
  );
}

function AgentListItem({ agent, selected, onSelect }: { agent: Agent; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-[var(--radius-md)] px-3 py-2",
          "text-left transition-colors duration-[var(--duration-fast)]",
          selected ? "bg-surface-selected" : "hover:bg-surface-hover",
        )}
      >
        <span className="flex w-full items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{agent.name}</span>
          {!agent.valid && (
            <FileWarning className="ml-auto size-3.5 shrink-0 text-danger-fg" aria-label="Invalid frontmatter" />
          )}
        </span>
        <span className="line-clamp-2 text-xs text-fg-muted">{agent.error ?? agent.description}</span>
      </button>
    </li>
  );
}

const runColumns: Column<RunView>[] = [
  {
    id: "status",
    header: "Status",
    className: "w-36",
    cell: (run) => (
      <StatusBadge
        status={RUN_STATUS[run.status] ?? "unknown"}
        // What it is waiting for, when the CLI said. An operator should not have to attach
        // to the session to find out why it stopped.
        title={run.waiting?.detail || undefined}
      />
    ),
    sortValue: (run) => run.status,
  },
  {
    id: "agent",
    header: "Agent",
    cell: (run) => <span className="font-medium text-fg">{run.agent}</span>,
    sortValue: (run) => run.agent,
  },
  {
    id: "cwd",
    header: "Working directory",
    cell: (run) => (
      <span className="font-mono text-xs text-fg-muted" title={run.cwd}>
        {run.cwd}
      </span>
    ),
    sortValue: (run) => run.cwd,
  },
  {
    id: "startedAt",
    header: "Started",
    align: "right",
    className: "w-28 whitespace-nowrap",
    cell: (run) => (
      <time
        dateTime={new Date(run.startedAt).toISOString()}
        title={new Date(run.startedAt).toLocaleString()}
        className="text-xs text-fg-muted"
      >
        {relativeTime(run.startedAt)}
      </time>
    ),
    sortValue: (run) => run.startedAt,
  },
];
