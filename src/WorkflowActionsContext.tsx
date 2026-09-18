import { createContext, useContext, type ReactNode } from "react";

const WorkflowActionsContext = createContext<{ openQc: (quoteId: string, projectId?: string) => void } | undefined>(undefined);

export function WorkflowActionsProvider({ openQc, children }: { openQc: (quoteId: string, projectId?: string) => void; children: ReactNode }) {
  return <WorkflowActionsContext.Provider value={{ openQc }}>{children}</WorkflowActionsContext.Provider>;
}

export function useWorkflowActions() {
  const actions = useContext(WorkflowActionsContext);
  if (!actions) throw new Error("WorkflowActionsProvider is required");
  return actions;
}
