import React, { useState, useEffect } from 'react';
import { 
  Users, 
  MessageSquare, 
  QrCode, 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Loader2
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch } from '../lib/api';

interface DashboardProps {
  token: string;
}

export default function Dashboard({ token }: DashboardProps) {
  const [stats, setStats] = useState({
    agents: 0,
    sessions: 0,
    conversations: 0,
    messages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const [agents, sessions, conversations] = await Promise.all([
        apiFetch('/api/agents'),
        apiFetch('/api/whatsapp/sessions'),
        apiFetch('/api/conversations'),
      ]);
      
      setStats({
        agents: agents.length,
        sessions: sessions.length,
        conversations: conversations.length,
        messages: conversations.reduce((acc: number, curr: any) => acc + (curr.message_count || 0), 0),
      });
      setError(null);
    } catch (error: any) {
      console.error('Failed to fetch stats:', error);
      setError('Failed to load dashboard statistics. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const cards = [
    { label: 'Active Agents', value: stats.agents, icon: Users, color: 'bg-blue-500' },
    { label: 'WA Sessions', value: stats.sessions, icon: QrCode, color: 'bg-emerald-500' },
    { label: 'Total Chats', value: stats.conversations, icon: MessageSquare, color: 'bg-purple-500' },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-gray-900 font-bold">{error}</p>
        <button 
          onClick={fetchStats}
          className="bg-primary text-white px-6 py-2 rounded-xl text-sm font-bold"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard Overview</h2>
        <p className="text-gray-500 text-sm">Real-time performance of your AI automation system</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((card, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={`w-12 h-12 ${card.color} bg-opacity-10 rounded-2xl flex items-center justify-center`}>
                <card.icon className={`w-6 h-6 ${card.color.replace('bg-', 'text-')}`} />
              </div>
            </div>
            <h3 className="text-3xl font-bold text-gray-900">{card.value}</h3>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">{card.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* System Status */}
        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
          <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            System Status
          </h3>
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-medium text-gray-700">Grok API Connection</span>
              </div>
              <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Stable</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-medium text-gray-700">WhatsApp Web Protocol</span>
              </div>
              <span className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Active</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="text-sm font-medium text-gray-700">Voice Transcription Service</span>
              </div>
              <span className="text-xs font-bold text-orange-600 uppercase tracking-widest">Idle</span>
            </div>
          </div>
        </div>

        {/* Quick Tips */}
        <div className="bg-primary text-white p-8 rounded-3xl shadow-xl shadow-primary/20">
          <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            Optimization Tips
          </h3>
          <ul className="space-y-4 text-sm text-white/80">
            <li className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold">1</span>
              </div>
              <p>Train your agents with detailed FAQs to improve response accuracy.</p>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold">2</span>
              </div>
              <p>Monitor real-time conversations to refine agent personalities.</p>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-[10px] font-bold">3</span>
              </div>
              <p>Use bulk messaging with randomized delays to prevent account bans.</p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
