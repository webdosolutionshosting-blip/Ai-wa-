import React from 'react';
import { 
  LayoutDashboard, 
  Users, 
  MessageSquare, 
  QrCode, 
  Send, 
  LogOut,
  Menu,
  X,
  Plus,
  ChevronRight,
  UserCircle,
  Settings,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

export default function Layout({ children, activeTab, setActiveTab, onLogout }: LayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const menuItems = [
    { id: 'conversations', label: 'Inbox', icon: MessageSquare },
    { id: 'agents', label: 'Agents', icon: Users },
    { id: 'customers', label: 'Customers', icon: UserCircle },
    { id: 'whatsapp', label: 'Channels', icon: Layers },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FB] flex relative overflow-hidden">
      {/* Background Decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[20%] -right-[10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '3s' }} />
        <div className="absolute top-1/4 left-1/4 w-[40%] h-[40%] bg-purple-500/5 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-[40%] h-[40%] bg-orange-500/5 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '4.5s' }} />
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-[280px] glass-card border-r border-gray-100 h-screen sticky top-0 z-20 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-purple-500 to-orange-500" />
        
        <div className="p-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 rounded-2xl flex items-center justify-center shadow-xl shadow-gray-900/20 rotate-[-5deg] group hover:rotate-0 transition-all duration-500">
              <span className="text-white font-black text-2xl italic">G</span>
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tighter">
                Geeks Genics
              </h1>
              <p className="text-[10px] font-black text-primary uppercase tracking-widest">AI Intelligence</p>
            </div>
          </div>
        </div>

        <div className="px-6 mb-8">
          <button
            onClick={() => setActiveTab('agents')}
            className="group relative w-full bg-gray-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-2xl shadow-gray-900/20 transition-all active:scale-[0.98] overflow-hidden"
          >
            <div className="absolute inset-0 bg-primary translate-y-[100%] group-hover:translate-y-0 transition-transform duration-500" />
            <Plus className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Create Agent</span>
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl text-sm font-black uppercase tracking-widest transition-all ${
                activeTab === item.id 
                  ? 'bg-white text-gray-900 shadow-xl shadow-gray-200/50 ring-1 ring-gray-100' 
                  : 'text-gray-400 hover:bg-white/50 hover:text-gray-900'
              }`}
            >
              <item.icon className={`w-5 h-5 transition-colors ${activeTab === item.id ? 'text-primary' : 'text-gray-300'}`} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-6 space-y-6">
          <div className="p-5 bg-white/50 rounded-[2rem] border border-gray-100 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Credits</span>
              </div>
              <span className="text-xs font-black text-gray-900">100</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500 w-[60%] rounded-full" />
            </div>
          </div>

          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center border border-white shadow-sm">
                <UserCircle className="w-6 h-6 text-gray-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black text-gray-900 truncate">Admin</p>
                <p className="text-[10px] font-bold text-gray-400 truncate">Pro Plan</p>
              </div>
            </div>
            <button 
              onClick={onLogout} 
              className="p-2.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-100 z-50 px-4 py-3 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
            <span className="text-white font-black text-lg italic">G</span>
          </div>
          <h1 className="text-lg font-bold text-gray-900 tracking-tight">
            Geeks Genics
          </h1>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 text-gray-500 hover:bg-gray-50 rounded-xl transition-all"
        >
          {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="md:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="md:hidden fixed top-0 left-0 bottom-0 w-[280px] bg-white z-50 shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                    <span className="text-white font-black text-lg italic">G</span>
                  </div>
                  <h1 className="text-lg font-bold text-gray-900">Geeks Genics</h1>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4">
                <button
                  onClick={() => {
                    setActiveTab('agents');
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full bg-[#00C853] text-white py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#00C853]/20"
                >
                  <Plus className="w-4 h-4" />
                  Create Agent
                </button>
              </div>

              <nav className="flex-1 px-3 py-2 space-y-1">
                {menuItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                      activeTab === item.id 
                        ? 'bg-[#F0F2F5] text-gray-900' 
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <item.icon className={`w-5 h-5 ${activeTab === item.id ? 'text-gray-900' : 'text-gray-400'}`} />
                    {item.label}
                  </button>
                ))}
              </nav>

              <div className="p-6 border-t border-gray-100 space-y-4">
                <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold text-xs">
                    100
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Credits</p>
                    <p className="text-xs font-bold text-gray-900 truncate">Remaining</p>
                  </div>
                </div>
                <button 
                  onClick={onLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 transition-all"
                >
                  <LogOut className="w-5 h-5" />
                  Logout
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 pt-[60px] md:pt-0 overflow-auto h-screen relative z-10">
        <div className="h-full p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
