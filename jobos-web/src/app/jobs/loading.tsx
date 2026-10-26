import AppShell from "../components/AppShell";
import WorkspaceLoading from "../components/WorkspaceLoading";
export default function Loading() {
  return <AppShell><WorkspaceLoading title="Find jobs" message="Loading your job search…" /></AppShell>;
}
