import { QueryClientProvider } from "@tanstack/react-query";
import { CalendarClock, ListChecks, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.tsx";
import { Page } from "./components/Page.tsx";
import { EmptyState } from "./components/States.tsx";
import { ThemeContext } from "./hooks/themeContext.ts";
import { useTheme } from "./hooks/useTheme.ts";
import { createQueryClient } from "./lib/queryClient.ts";
import { AgentsPage } from "./routes/AgentsPage.tsx";
import { PlaceholderPage } from "./routes/PlaceholderPage.tsx";

export function App() {
  // One client for the lifetime of the app; recreating it on render would drop the cache.
  const queryClient = useMemo(createQueryClient, []);
  const theme = useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeContext.Provider value={theme}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/agents" replace />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route
              path="/skills"
              element={
                <PlaceholderPage
                  title="Skills"
                  description="Skills discovered on disk"
                  icon={Sparkles}
                  comingUp="Browsing and editing the skills in ~/.claude/skills lands alongside the Agents editor."
                />
              }
            />
            <Route
              path="/tasks"
              element={
                <PlaceholderPage
                  title="Tasks"
                  description="The work queue"
                  icon={ListChecks}
                  comingUp="The queue, the worker loop and the task list land in the next milestone. Until then the Queued counter in the status bar reads as unavailable rather than zero."
                />
              }
            />
            <Route
              path="/schedule"
              element={
                <PlaceholderPage
                  title="Schedule"
                  description="Recurring runs"
                  icon={CalendarClock}
                  comingUp="Cron schedules that enqueue tasks land after the queue. They will only fire while this server is running, and the screen will say so."
                />
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ThemeContext.Provider>
    </QueryClientProvider>
  );
}

function NotFound() {
  return (
    <Page title="Not found" description="That address does not match a screen">
      <EmptyState title="There is nothing at this address" description="Pick one of the four areas in the sidebar." />
    </Page>
  );
}
