import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";

export default function Home() {
  return (
    <>
      <Navbar />

      <div className="flex">
        <Sidebar />

        <main className="flex-1 min-h-screen bg-slate-950 text-white p-8">
          <h1 className="text-3xl font-bold">Dashboard</h1>

          <p className="mt-3 text-slate-400">
            Welcome to JobOS 🚀
          </p>
        </main>
      </div>
    </>
  );
}