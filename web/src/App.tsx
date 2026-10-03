import { QueryClientProvider } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
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
import { SkillsPage } from "./routes/SkillsPage.tsx";
import { TaskDetailPage } from "./routes/TaskDetailPage.tsx";
import { TasksPage } from "./routes/TasksPage.tsx";

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
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
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
