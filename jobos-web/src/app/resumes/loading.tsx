import AppShell from "../components/AppShell";
import WorkspaceLoading from "../components/WorkspaceLoading";

export default function Loading() {
  return <AppShell><WorkspaceLoading title="Resume Match" message="Opening your resume workspace…" /></AppShell>;
}
