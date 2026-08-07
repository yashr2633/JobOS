import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import ApplicationsContent from "./components/ApplicationsContent";

export default function ApplicationsPage() {
  return (
    <>
      <Navbar />

      <div className="flex">
        <Sidebar />

        <main className="min-h-screen flex-1 bg-slate-950 p-6 text-white sm:p-8">
          <ApplicationsContent />
        </main>
      </div>
    </>
  );
}
