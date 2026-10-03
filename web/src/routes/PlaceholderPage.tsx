import type * as React from "react";
import { Page } from "../components/Page.tsx";
import { EmptyState } from "../components/States.tsx";

/**
 * A screen whose shell is finished and whose content is not.
 *
 * It says which milestone fills it in, because an operator who clicks Tasks and finds a blank
 * pane has learned nothing — "this is empty" and "this is not built" look identical otherwise.
 */
export interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** What lands here, in the user's terms rather than the plan's. */
  comingUp: string;
}

export function PlaceholderPage({ title, description, icon, comingUp }: PlaceholderPageProps) {
  return (
    <Page title={title} description={description}>
      <EmptyState icon={icon} title={`${title} is not built yet`} description={comingUp} />
    </Page>
  );
}
