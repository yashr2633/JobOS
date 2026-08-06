import Navbar from "./components/Navbar";

export default function Home() {
  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center px-6">
          <h1 className="text-5xl font-bold mb-4">Welcome to JobOS</h1>

          <p className="text-xl text-slate-300 mb-8">
            Your AI Career Operating System
          </p>

          <button className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-semibold">
            Get Started
          </button>
        </div>
      </main>
    </>
  );
}