export default function Sidebar() {
    return (
      <aside className="w-64 h-screen bg-slate-900 border-r border-slate-800 text-white">
        <div className="p-6">
          <h2 className="text-lg font-bold mb-6">Navigation</h2>
  
          <nav className="space-y-3">
            <button className="block w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800">
              📊 Dashboard
            </button>
  
            <button className="block w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800">
              💼 Applications
            </button>
  
            <button className="block w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800">
              📄 Resume Match
            </button>
  
            <button className="block w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800">
              📈 Analytics
            </button>
  
            <button className="block w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800">
              ⚙️ Settings
            </button>
          </nav>
        </div>
      </aside>
    );
  }