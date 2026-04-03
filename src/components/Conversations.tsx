import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  User, 
  Clock, 
  Loader2, 
  Send, 
  Users, 
  Phone, 
  AlertCircle, 
  Paperclip, 
  Image as ImageIcon, 
  FileText, 
  Mic, 
  X, 
  Smartphone, 
  Plus, 
  Trash2,
  Search,
  MoreVertical,
  Check,
  CheckCheck,
  Smile,
  Video,
  Target,
  Zap,
  Bot,
  User as UserIcon,
  ChevronDown,
  ChevronLeft,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch } from '../lib/api';
import { io } from 'socket.io-client';
// import { GoogleGenAI } from '@google/genai';
import QRCode from 'qrcode';

const socket = io();

interface Conversation {
  id: number;
  session_id: number;
  contact_number: string;
  last_message_at: string;
  session_number: string;
  agent_name: string;
  contact_name?: string;
  unread_count: number;
  is_saved: number;
  is_ordered: number;
  is_rated: number;
  is_audited: number;
  is_autopilot: number;
  last_message_content?: string;
  last_message_type?: string;
}

interface Contact {
  id: number;
  session_id: number;
  number: string;
  name?: string;
  session_number: string;
}

interface Message {
  id: number;
  conversation_id: number;
  sender: 'contact' | 'agent';
  content: string;
  type: string;
  transcription?: string;
  created_at: string;
}

interface ConversationsProps {
  token: string;
}

export default function Conversations({ token }: ConversationsProps) {
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts'>('chats');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [qrCodes, setQrCodes] = useState<{ [key: string]: string }>({});
  const [qrModalSessionId, setQrModalSessionId] = useState<number | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<number[]>([]);
  const [isAddingSession, setIsAddingSession] = useState(false);
  const [selectedAgentForSession, setSelectedAgentForSession] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<number | null>(null);
  const [selectedSessionsForBulk, setSelectedSessionsForBulk] = useState<number[]>([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [syncingSessions, setSyncingSessions] = useState<Record<number, { status: string, progress: number, message?: string }>>({});
  
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAutopilot, setIsAutopilot] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<'text' | 'image' | 'video' | 'audio' | 'document'>('text');
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchConversations = async () => {
    try {
      const data = await apiFetch('/api/conversations');
      setConversations(data);
      setError(null);
    } catch (error: any) {
      console.error('Failed to fetch conversations:', error);
      setError(`Failed to load conversations: ${error.message || 'Please check your connection.'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchContacts = async () => {
    try {
      const data = await apiFetch('/api/whatsapp/contacts');
      setContacts(data);
    } catch (error: any) {
      console.error('Failed to fetch contacts:', error);
      setError(`Failed to load contacts: ${error.message || 'Please check your connection.'}`);
    }
  };

  const fetchSessions = async () => {
    try {
      const data = await apiFetch('/api/whatsapp/sessions');
      setSessions(data);
      if (data.length > 0 && !selectedSessionId) {
        setSelectedSessionId(data[0].id);
      }
    } catch (err: any) {
      console.error('Failed to fetch sessions:', err);
      setError(`Failed to load sessions: ${err.message || 'Please check your connection.'}`);
    }
  };

  const fetchAgents = async () => {
    try {
      const data = await apiFetch('/api/agents');
      setAgents(data);
    } catch (err: any) {
      console.error('Failed to fetch agents:', err);
      setError(`Failed to load agents: ${err.message || 'Please check your connection.'}`);
    }
  };

  const validateSessionForm = () => {
    const errors: Record<string, string> = {};
    if (!sessionName.trim()) errors.sessionName = 'WhatsApp name is required';
    if (!selectedAgentForSession) errors.selectedAgent = 'Please assign an agent';
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddSession = async () => {
    if (!validateSessionForm()) return;
    try {
      const result = await apiFetch('/api/whatsapp/sessions', {
        method: 'POST',
        body: JSON.stringify({ 
          agent_id: parseInt(selectedAgentForSession),
          name: sessionName
        }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      const newSessionId = result.id;
      fetchSessions();
      setIsAddingSession(false);
      setSelectedAgentForSession('');
      setSessionName('');
      setValidationErrors({});
      
      // Open QR Modal and start connection
      setQrModalSessionId(newSessionId);
      handleConnect(newSessionId);
    } catch (error) {
      console.error('Failed to add session');
    }
  };

  const handleDeleteSession = async (id: number) => {
    try {
      // Try to disconnect first for a cleaner exit
      const session = sessions.find(s => s.id === id);
      if (session && session.status === 'connected') {
        await apiFetch(`/api/whatsapp/sessions/${id}/disconnect`, { method: 'POST' }).catch(() => {});
      }

      await apiFetch(`/api/whatsapp/sessions/${id}`, {
        method: 'DELETE',
      });
      
      if (selectedSessionId === id) {
        setSelectedSessionId(null);
        setSelectedConversation(null);
        setMessages([]);
      }
      setSelectedSessionsForBulk(prev => prev.filter(sid => sid !== id));
      fetchSessions();
      setSessionToDelete(null);
    } catch (error) {
      console.error('Failed to delete session');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedSessionsForBulk.length === 0) return;
    try {
      for (const id of selectedSessionsForBulk) {
        // Try to disconnect first
        const session = sessions.find(s => s.id === id);
        if (session && session.status === 'connected') {
          await apiFetch(`/api/whatsapp/sessions/${id}/disconnect`, { method: 'POST' }).catch(() => {});
        }
        await apiFetch(`/api/whatsapp/sessions/${id}`, { method: 'DELETE' });
      }
      
      if (selectedSessionId && selectedSessionsForBulk.includes(selectedSessionId)) {
        setSelectedSessionId(null);
        setSelectedConversation(null);
        setMessages([]);
      }
      
      fetchSessions();
      setSelectedSessionsForBulk([]);
      setIsBulkMode(false);
    } catch (error) {
      console.error('Failed to perform bulk delete');
    }
  };

  const toggleSessionSelection = (id: number, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedSessionsForBulk(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedSessions.length === sessions.length) {
      setSelectedSessions([]);
    } else {
      setSelectedSessions(sessions.map(s => s.id));
    }
  };

  const handleConnect = async (id: number) => {
    try {
      await apiFetch(`/api/whatsapp/sessions/${id}/connect`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Failed to connect');
    }
  };

  const handleDisconnect = async (id: number) => {
    try {
      await apiFetch(`/api/whatsapp/sessions/${id}/disconnect`, {
        method: 'POST',
      });
      fetchSessions();
    } catch (error) {
      console.error('Failed to disconnect');
    }
  };

  const fetchMessages = async (id: number) => {
    try {
      const data = await apiFetch(`/api/conversations/${id}/messages`);
      setMessages(data);
    } catch (error) {
      console.error('Failed to fetch messages');
    }
  };

  useEffect(() => {
    console.log('Connecting to socket...');
    socket.on('connect', () => console.log('Socket connected:', socket.id));
    socket.on('disconnect', () => console.log('Socket disconnected'));
    socket.on('connect_error', (err) => console.error('Socket connection error:', err));

    fetchConversations();
    fetchContacts();
    fetchSessions();
    fetchAgents();

    socket.on('new_message', async (data) => {
      console.log('Received new message via socket:', data);
      
      // Update conversations list state directly for better performance
      setConversations(prev => {
        const index = prev.findIndex(c => c.id === data.conversation_id);
        if (index === -1) {
          // If conversation not in list, add it if we have enough info
          if (data.contact_number) {
            const newConv: Conversation = {
              id: data.conversation_id,
              session_id: data.session_id || 0,
              contact_number: data.contact_number,
              last_message_at: data.created_at,
              session_number: '', // Not strictly needed for display
              agent_name: 'AI Agent', // Default
              contact_name: data.contact_name,
              unread_count: data.unread_count || 1,
              is_saved: data.is_saved || 0,
              is_ordered: data.is_ordered || 0,
              is_rated: data.is_rated || 0,
              is_audited: data.is_audited || 0,
              is_autopilot: data.is_autopilot || 1
            };
            return [newConv, ...prev];
          }
          fetchConversations();
          return prev;
        }
        
        const updated = [...prev];
        const conv = { ...updated[index] };
        conv.last_message_at = data.created_at;
        
        if (data.contact_number) {
          conv.contact_number = data.contact_number;
        }
        
        // Update unread count if not selected
        if (selectedConversation !== data.conversation_id && data.sender === 'contact') {
          conv.unread_count = (data.unread_count !== undefined) ? data.unread_count : (conv.unread_count + 1);
        } else if (selectedConversation === data.conversation_id) {
          conv.unread_count = 0;
        }

        if (data.contact_name) {
          conv.contact_name = data.contact_name;
        }
        
        if (data.is_autopilot !== undefined) {
          conv.is_autopilot = data.is_autopilot;
          if (selectedConversation === data.conversation_id) {
            setIsAutopilot(data.is_autopilot === 1);
          }
        }
        
        updated.splice(index, 1);
        updated.unshift(conv); // Move to top
        return updated;
      });
      
      // If the new message belongs to the selected conversation, add it to the messages state
      if (selectedConversation === data.conversation_id) {
        setMessages(prev => {
          // Avoid duplicates
          if (prev.some(m => m.content === data.content && m.created_at === data.created_at)) {
            return prev;
          }
          return [...prev, {
            id: Date.now(), // Temporary ID
            ...data
          }];
        });
      }
    });

    socket.on('unread_reset', (data) => {
      setConversations(prev => prev.map(c => 
        c.id === parseInt(data.conversationId) ? { ...c, unread_count: 0 } : c
      ));
    });

    socket.on('qr', async ({ sessionId, qr }) => {
      const qrDataUrl = await QRCode.toDataURL(qr);
      setQrCodes(prev => ({ ...prev, [sessionId]: qrDataUrl }));
    });

    socket.on('connection_status', ({ sessionId, status, number }) => {
      setSessions(prev => prev.map(s => 
        s.id === parseInt(sessionId) ? { ...s, status, number } : s
      ));
      if (status === 'connected') {
        setQrCodes(prev => {
          const newCodes = { ...prev };
          delete newCodes[sessionId];
          return newCodes;
        });
        // Don't close modal immediately if it's the one we're watching
        // The sync_status will handle showing progress in the modal
        // Refresh data when connected
        fetchConversations();
        fetchContacts();
      }
    });

    socket.on('sync_status', ({ sessionId, status, progress, message }) => {
      const sid = parseInt(sessionId);
      if (status === 'syncing') {
        setSyncingSessions(prev => ({ ...prev, [sid]: { status, progress: progress || 0, message } }));
      } else if (status === 'completed') {
        setSyncingSessions(prev => {
          const newState = { ...prev };
          delete newState[sid];
          return newState;
        });
        // Close modal if it was showing sync progress
        if (qrModalSessionId === sid) {
          setQrModalSessionId(null);
        }
        fetchConversations();
        fetchContacts();
      } else if (status === 'error') {
        setSyncingSessions(prev => {
          const newState = { ...prev };
          delete newState[sid];
          return newState;
        });
        if (qrModalSessionId === sid) {
          setQrModalSessionId(null);
        }
      }
    });

    socket.on('session_disconnected', ({ sessionId }) => {
      const sid = parseInt(sessionId);
      setConversations(prev => prev.filter(c => c.session_id !== sid));
      setContacts(prev => prev.filter(c => c.session_id !== sid));
      if (selectedSessionId === sid) {
        setSelectedConversation(null);
      }
    });

    return () => {
      socket.off('new_message');
      socket.off('unread_reset');
      socket.off('qr');
      socket.off('connection_status');
      socket.off('sync_status');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
    };
  }, [selectedConversation]);

  useEffect(() => {
    if (selectedConversation) {
      setIsMessagesLoading(true);
      fetchMessages(selectedConversation).finally(() => setIsMessagesLoading(false));
    }
  }, [selectedConversation]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !selectedFile) || isSending || !selectedConversation) return;

    setIsSending(true);
    const conv = conversations.find(c => c.id === selectedConversation);
    if (!conv) return;

    try {
      const formData = new FormData();
      formData.append('sessionId', conv.session_id.toString());
      formData.append('jid', conv.contact_number);
      formData.append('text', newMessage);
      formData.append('type', selectedFile ? fileType : 'text');
      if (selectedFile) {
        formData.append('file', selectedFile);
      }

      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });

      if (response.ok) {
        setNewMessage('');
        setSelectedFile(null);
        setFileType('text');
        fetchMessages(selectedConversation);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const generateAiSuggestion = async () => {
    if (!selectedConversation || !currentConv) return;
    setIsSending(true);
    try {
      const lastMessage = messages[messages.length - 1]?.content || 'Hello';
      
      const response = await fetch('/api/ai/suggestion', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: currentConv.session_id,
          lastMessage
        })
      });
      
      if (!response.ok) throw new Error('Failed to fetch suggestion');
      const data = await response.json();
      setNewMessage(data.suggestion || '');
    } catch (err) {
      console.error('Failed to generate AI suggestion:', err);
    } finally {
      setIsSending(false);
    }
  };

  const updateConversationFlags = async (id: number, flags: { is_saved?: boolean, is_ordered?: boolean, is_rated?: boolean, is_audited?: boolean }) => {
    try {
      await fetch(`/api/conversations/${id}/flags`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(flags),
      });
      
      setConversations(prev => prev.map(c => 
        c.id === id ? { ...c, ...flags as any } : c
      ));
    } catch (err) {
      console.error('Failed to update flags:', err);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: typeof fileType) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setFileType(type);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/ogg; codecs=opus' });
        const file = new File([audioBlob], 'recording.ogg', { type: 'audio/ogg' });
        setSelectedFile(file);
        setFileType('audio');
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const transcribeAudio = async (messageId: number, audioUrl: string) => {
    try {
      const response = await fetch(audioUrl);
      const blob = await response.blob();
      const base64Audio = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result?.toString().split(',')[1] || '');
        reader.readAsDataURL(blob);
      });

      const transcribeResp = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audio: base64Audio,
          mimeType: blob.type || "audio/mp3"
        })
      });

      if (!transcribeResp.ok) throw new Error('Transcription failed');
      const data = await transcribeResp.json();
      const transcription = data.text || '';
      
      // Update local state
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, transcription } : m));
      
      // Save to DB
      if (messageId) {
        await fetch(`/api/messages/${messageId}/transcription`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ transcription })
        });
      }
    } catch (err) {
      console.error('Failed to transcribe audio:', err);
    }
  };

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
          onClick={fetchConversations}
          className="bg-primary text-white px-6 py-2 rounded-xl text-sm font-bold"
        >
          Retry
        </button>
      </div>
    );
  }

  const currentConv = conversations.find(c => c.id === selectedConversation);
  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const filteredConversations = (selectedSession?.status === 'connected' 
    ? conversations.filter(c => c.session_id === selectedSessionId)
    : []).filter(c => 
      (c.contact_name || c.contact_number).toLowerCase().includes(searchQuery.toLowerCase())
    );
  const filteredContacts = selectedSession?.status === 'connected'
    ? contacts.filter(c => c.session_id === selectedSessionId)
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-20px)] bg-[#F8F9FB] overflow-hidden rounded-3xl border border-gray-100 shadow-sm">
      {/* Sync Status Bar */}
      <AnimatePresence>
        {Object.keys(syncingSessions).length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-primary/10 border-b border-primary/20 px-4 py-2 flex items-center justify-between overflow-hidden"
          >
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-xs font-bold text-primary">Loading chats...</span>
            </div>
            <div className="flex items-center gap-4">
              {Object.entries(syncingSessions).map(([sid, data]) => (
                <div key={sid} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    {sessions.find(s => s.id === parseInt(sid))?.name || 'WhatsApp'}
                  </span>
                  <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${data.progress}%` }}
                      transition={{ type: 'tween', ease: 'linear', duration: 0.5 }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-primary">{data.progress}%</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sessions Bar */}
      <div className="flex items-center gap-2 p-4 bg-white border-b border-gray-100 overflow-x-auto scrollbar-hide shrink-0">
        <div className="flex items-center gap-2 flex-1">
          {sessions.map(session => (
            <div key={session.id} className="relative group flex items-center">
              {isBulkMode && (
                <input 
                  type="checkbox"
                  checked={selectedSessionsForBulk.includes(session.id)}
                  onChange={(e) => toggleSessionSelection(session.id, e)}
                  className="mr-2 w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/20"
                />
              )}
              <button 
                onClick={() => {
                  if (isBulkMode) {
                    setSelectedSessionsForBulk(prev => 
                      prev.includes(session.id) ? prev.filter(sid => sid !== session.id) : [...prev, session.id]
                    );
                  } else {
                    setSelectedSessionId(session.id);
                    setSelectedConversation(null);
                  }
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 border pr-8 relative ${
                  selectedSessionId === session.id 
                    ? 'bg-primary/5 text-primary border-primary/20' 
                    : 'bg-white text-gray-500 border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${session.status === 'connected' ? 'bg-[#00C853]' : 'bg-gray-300'}`} />
                {session.name || session.number || 'WhatsApp'}
                {session.status !== 'connected' && (
                  <span 
                    onClick={(e) => {
                      e.stopPropagation();
                      setQrModalSessionId(session.id);
                      handleConnect(session.id);
                    }}
                    className="ml-1 text-[10px] bg-primary text-white px-2 py-0.5 rounded-lg"
                  >
                    Connect
                  </span>
                )}
                {session.status === 'connected' && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      apiFetch(`/api/whatsapp/sessions/${session.id}/sync`, { method: 'POST' });
                    }}
                    className="ml-2 p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-all"
                    title="Sync Chats"
                  >
                    <RefreshCw className={`w-3 h-3 ${syncingSessions[session.id] ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </button>

              {!isBulkMode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSessionToDelete(session.id);
                  }}
                  className="absolute right-2 p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 transition-all text-gray-300"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          <button 
            onClick={() => setIsAddingSession(true)}
            className="p-2 rounded-xl bg-gray-50 text-gray-400 border border-dashed border-gray-200 hover:bg-gray-100 transition-all"
            title="Add Session"
          >
            <Plus className="w-4 h-4" />
          </button>
          
          {sessions.some(s => s.status === 'connected') && (
            <button 
              onClick={() => {
                if (confirm('This will re-sync all connected WhatsApp sessions. Continue?')) {
                  sessions.filter(s => s.status === 'connected').forEach(s => {
                    apiFetch(`/api/whatsapp/sessions/${s.id}/sync`, { method: 'POST' });
                  });
                }
              }}
              className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all flex items-center gap-2 text-xs font-bold px-4"
              title="Re-sync All Sessions"
            >
              <RefreshCw className={`w-4 h-4 ${Object.keys(syncingSessions).length > 0 ? 'animate-spin' : ''}`} />
              Re-sync All
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4">
          {isBulkMode ? (
            <>
              <button 
                onClick={handleBulkDelete}
                disabled={selectedSessionsForBulk.length === 0}
                className="px-4 py-2 bg-red-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-red-500/20 disabled:opacity-50 flex items-center gap-2"
              >
                <Trash2 className="w-3 h-3" /> Delete ({selectedSessionsForBulk.length})
              </button>
              <button 
                onClick={() => {
                  setIsBulkMode(false);
                  setSelectedSessionsForBulk([]);
                }}
                className="px-4 py-2 bg-gray-100 text-gray-500 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
            </>
          ) : (
            <button 
              onClick={() => setIsBulkMode(true)}
              className="px-4 py-2 bg-gray-50 text-gray-500 border border-gray-200 rounded-xl text-xs font-bold hover:bg-gray-100 transition-all flex items-center gap-2"
            >
              <Trash2 className="w-3 h-3" /> Bulk Delete
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Chat List Column */}
        <div className={`w-full md:w-[320px] bg-white border-r border-gray-100 flex flex-col shrink-0 ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search"
                  className="w-full bg-[#F0F2F5] border-none rounded-xl py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button 
                onClick={() => {
                  if (selectedSessionId) {
                    apiFetch(`/api/whatsapp/sessions/${selectedSessionId}/sync`, { method: 'POST' });
                  } else {
                    fetchConversations();
                    fetchContacts();
                  }
                }}
                className={`p-2.5 rounded-xl transition-all ${selectedSessionId && syncingSessions[selectedSessionId] ? 'bg-primary/10 text-primary animate-pulse' : 'bg-[#F0F2F5] text-gray-500 hover:bg-gray-200'}`}
                title={selectedSessionId ? "Re-sync WhatsApp" : "Refresh Data"}
              >
                <RefreshCw className={`w-4 h-4 ${selectedSessionId && syncingSessions[selectedSessionId] ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {filteredConversations.length > 0 ? (
              filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => {
                    setSelectedConversation(conv.id);
                    setIsAutopilot(conv.is_autopilot === 1);
                    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, unread_count: 0 } : c));
                  }}
                  className={`w-full p-4 text-left flex items-center gap-3 transition-all hover:bg-gray-50 ${
                    selectedConversation === conv.id ? 'bg-[#F0F2F5]' : ''
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className="w-12 h-12 bg-gray-100 rounded-2xl overflow-hidden">
                      <img 
                        src={`https://ui-avatars.com/api/?name=${conv.contact_name || 'Unknown'}&background=random`} 
                        alt="" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#00C853] border-2 border-white rounded-full flex items-center justify-center">
                      <MessageSquare className="w-2 h-2 text-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-0.5">
                      <h4 className="font-bold text-sm text-gray-900 truncate">
                        {conv.contact_name || 'Unknown'}
                      </h4>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-gray-500 truncate">
                        {conv.unread_count > 0 ? (
                          <span className="text-gray-900 font-medium">New message...</span>
                        ) : (
                          conv.last_message_content || 'No messages yet'
                        )}
                      </p>
                      {conv.unread_count > 0 && (
                        <div className="w-4 h-4 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                          {conv.unread_count}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="p-12 text-center text-gray-400">
                <MessageSquare className="w-10 h-10 mx-auto mb-4 opacity-10" />
                <p className="text-xs font-bold">No chats found</p>
              </div>
            )}
          </div>
        </div>

        {/* Chat Area Column */}
        <div className={`flex-1 flex flex-col bg-white min-w-0 relative ${selectedConversation ? 'flex' : 'hidden md:flex'}`}>
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setSelectedConversation(null)}
                    className="md:hidden p-2 -ml-2 text-gray-400 hover:bg-gray-50 rounded-lg"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <div className="w-10 h-10 bg-gray-100 rounded-xl overflow-hidden">
                    <img 
                      src={`https://ui-avatars.com/api/?name=${currentConv?.contact_name || 'Unknown'}&background=random`} 
                      alt="" 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-gray-900">
                      {currentConv?.contact_name || 'Unknown'}
                    </h3>
                    <p className="text-[10px] text-gray-400 font-medium">
                      {currentConv?.contact_number.split('@')[0]}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setShowRightSidebar(!showRightSidebar)}
                    className={`p-2 rounded-xl transition-all ${showRightSidebar ? 'bg-primary/10 text-primary' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                    title={showRightSidebar ? "Hide Details" : "Show Details"}
                  >
                    <Bot className="w-5 h-5" />
                  </button>
                  <div className="flex bg-gray-50 p-1 rounded-xl border border-gray-100">
                    <button 
                      onClick={async () => {
                        if (!selectedConversation) return;
                        setIsAutopilot(true);
                        try {
                          await apiFetch(`/api/conversations/${selectedConversation}/flags`, {
                            method: 'PUT',
                            body: JSON.stringify({ is_autopilot: 1 }),
                            headers: { 'Content-Type': 'application/json' }
                          });
                          setConversations(prev => prev.map(c => c.id === selectedConversation ? { ...c, is_autopilot: 1 } : c));
                        } catch (err) {
                          console.error('Failed to update autopilot flag');
                        }
                      }}
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                        isAutopilot ? 'bg-white text-[#00C853] shadow-sm' : 'text-gray-400'
                      }`}
                    >
                      Autopilot
                    </button>
                    <button 
                      onClick={async () => {
                        if (!selectedConversation) return;
                        setIsAutopilot(false);
                        try {
                          await apiFetch(`/api/conversations/${selectedConversation}/flags`, {
                            method: 'PUT',
                            body: JSON.stringify({ is_autopilot: 0 }),
                            headers: { 'Content-Type': 'application/json' }
                          });
                          setConversations(prev => prev.map(c => c.id === selectedConversation ? { ...c, is_autopilot: 0 } : c));
                        } catch (err) {
                          console.error('Failed to update autopilot flag');
                        }
                      }}
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                        !isAutopilot ? 'bg-[#00C853] text-white shadow-sm' : 'text-gray-400'
                      }`}
                    >
                      Copilot
                    </button>
                  </div>
                </div>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-auto p-6 space-y-6 bg-whatsapp-pattern scroll-smooth">
                <div className="flex justify-center">
                  <span className="px-3 py-1 bg-white/80 backdrop-blur-sm border border-white/40 rounded-full text-[10px] font-bold text-gray-400 uppercase tracking-widest shadow-sm">
                    Yesterday
                  </span>
                </div>
                
                {messages.map((msg, idx) => (
                  <div 
                    key={msg.id} 
                    className={`flex ${msg.sender === 'agent' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[70%] space-y-1 ${msg.sender === 'agent' ? 'items-end' : 'items-start'}`}>
                      <div className={`p-4 rounded-2xl text-sm break-words whitespace-pre-wrap overflow-hidden ${
                        msg.sender === 'agent' 
                          ? 'bg-[#E1F5FE] text-gray-900 rounded-tr-none' 
                          : 'bg-white text-gray-900 rounded-tl-none border border-gray-100 shadow-sm'
                      }`}>
                        {msg.type === 'image' ? (
                          <div className="space-y-2">
                            <img src={msg.content} alt="WhatsApp Image" className="max-w-full rounded-lg" referrerPolicy="no-referrer" />
                          </div>
                        ) : msg.type === 'video' ? (
                          <video src={msg.content} controls className="max-w-full rounded-lg" />
                        ) : msg.type === 'audio' ? (
                          <div className="space-y-3 min-w-[200px]">
                            <audio src={msg.content} controls className="max-w-full" />
                            {msg.transcription ? (
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-600 italic leading-relaxed">
                                <span className="font-bold text-[10px] uppercase tracking-widest text-gray-400 block mb-1">Transcription</span>
                                {msg.transcription}
                              </div>
                            ) : (
                              <button 
                                onClick={() => transcribeAudio(msg.id, msg.content)}
                                className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest hover:opacity-80 transition-all"
                              >
                                <RefreshCw className="w-3 h-3" /> Read Voice Message
                              </button>
                            )}
                          </div>
                        ) : msg.type === 'document' ? (
                          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-100">
                            <FileText className="w-5 h-5 text-primary" />
                            <span className="text-xs font-medium truncate max-w-[200px]">{msg.content}</span>
                          </div>
                        ) : (
                          msg.content
                        )}
                      </div>
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[10px] text-gray-400 font-medium">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.sender === 'agent' && <CheckCheck className="w-3 h-3 text-[#00C853]" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input Area */}
              <div className="p-4 bg-white border-t border-gray-100 shrink-0">
                <form onSubmit={handleSendMessage} className="space-y-3">
                  <div className="relative">
                    {isRecording ? (
                      <div className="w-full bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center justify-between animate-pulse">
                        <div className="flex items-center gap-3">
                          <div className="w-3 h-3 bg-red-500 rounded-full animate-ping" />
                          <span className="text-sm font-black text-red-500 uppercase tracking-widest">Recording Voice... {formatTime(recordingTime)}</span>
                        </div>
                        <button 
                          type="button"
                          onClick={stopRecording}
                          className="w-10 h-10 bg-red-500 text-white rounded-xl flex items-center justify-center shadow-lg shadow-red-500/20"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <textarea
                          placeholder="Type here"
                          className="w-full bg-[#F8F9FB] border border-gray-100 rounded-2xl p-4 pr-12 text-sm min-h-[100px] resize-none focus:ring-2 focus:ring-primary/10 outline-none"
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                        />
                        {selectedFile && (
                          <div className="absolute top-2 left-2 right-12 bg-white p-2 rounded-xl border border-gray-100 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-2">
                              {fileType === 'image' ? <ImageIcon className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-primary" />}
                              <span className="text-[10px] font-bold truncate max-w-[150px]">{selectedFile.name}</span>
                            </div>
                            <button onClick={() => setSelectedFile(null)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                          </div>
                        )}
                        <button 
                          type="submit"
                          disabled={isSending || (!newMessage.trim() && !selectedFile)}
                          className="absolute bottom-4 right-4 w-10 h-10 bg-[#00C853] text-white rounded-xl flex items-center justify-center shadow-lg shadow-[#00C853]/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <Send className="w-5 h-5" />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <button 
                        type="button"
                        onClick={generateAiSuggestion}
                        className="bg-[#00C853] text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-[#00C853]/20"
                      >
                        Generate
                      </button>
                      <div className="flex items-center gap-2 text-gray-400">
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          className="hidden" 
                          onChange={(e) => handleFileSelect(e, fileType)} 
                        />
                        <button 
                          type="button" 
                          onClick={() => { setFileType('image'); fileInputRef.current?.click(); }}
                          className="p-2 hover:bg-gray-50 rounded-lg transition-all"
                        >
                          <ImageIcon className="w-5 h-5" />
                        </button>
                        <button 
                          type="button" 
                          onClick={() => { setFileType('video'); fileInputRef.current?.click(); }}
                          className="p-2 hover:bg-gray-50 rounded-lg transition-all"
                        >
                          <Video className="w-5 h-5" />
                        </button>
                        <button 
                          type="button" 
                          onClick={() => { setFileType('document'); fileInputRef.current?.click(); }}
                          className="p-2 hover:bg-gray-50 rounded-lg transition-all"
                        >
                          <Paperclip className="w-5 h-5" />
                        </button>
                        <button 
                          type="button" 
                          onClick={isRecording ? stopRecording : startRecording}
                          className={`p-2 rounded-lg transition-all ${isRecording ? 'bg-red-50 text-red-500' : 'hover:bg-gray-50'}`}
                        >
                          <Mic className={`w-5 h-5 ${isRecording ? 'animate-pulse' : ''}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-gray-400">
              <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mb-6">
                <MessageSquare className="w-10 h-10 opacity-20" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Select a conversation</h3>
              <p className="text-sm max-w-xs mt-2">Choose a chat from the left to start messaging with your customers.</p>
            </div>
          )}
        </div>

        {/* Right Sidebar Column */}
        <AnimatePresence>
          {showRightSidebar && (
            <motion.div 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute lg:relative right-0 top-0 bottom-0 z-30 lg:z-0 border-l border-gray-100 flex flex-col shrink-0 bg-white shadow-2xl lg:shadow-none overflow-hidden"
            >
              <div className="w-[300px] h-full p-6 space-y-8 relative flex flex-col overflow-y-auto">
                {/* Close Button */}
                <button 
                  onClick={() => setShowRightSidebar(false)}
                  className="absolute top-4 right-4 p-2 text-gray-400 hover:bg-gray-50 rounded-lg transition-all"
                  title="Close Sidebar"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Agent Profile */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#E8F5E9] rounded-xl flex items-center justify-center text-[#00C853]">
                      <Bot className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-gray-900 flex items-center gap-1">
                        {agents.find(a => a.id === selectedSession?.agent_id)?.name || 'Agent'} <ChevronDown className="w-3 h-3 text-gray-400" />
                      </h4>
                      <p className="text-[10px] text-[#00C853] font-bold uppercase tracking-wider">
                        {selectedSession?.name || 'VINI ONLINE'}
                      </p>
                    </div>
                  </div>
                  <button className="p-2 text-gray-400 hover:bg-gray-50 rounded-lg transition-all">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>

                {/* Objective Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-purple-500">
                    <Zap className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Objective</span>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-orange-500">
                        <Clock className="w-3 h-3" />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Objective Progress</span>
                        <AlertCircle className="w-3 h-3 text-gray-300" />
                      </div>
                      <span className="text-xs font-bold text-gray-900">0%</span>
                    </div>
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: '0%' }}
                        className="h-full bg-gradient-to-r from-orange-400 to-orange-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Motivational Card */}
                <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 pt-10">
                  <div className="relative">
                    <div className="w-32 h-32 bg-gray-50 rounded-full flex items-center justify-center">
                      <Sparkles className="w-12 h-12 text-gray-200" />
                    </div>
                    <motion.div 
                      animate={{ y: [0, -10, 0] }}
                      transition={{ repeat: Infinity, duration: 3 }}
                      className="absolute -top-2 -right-2 bg-white p-3 rounded-2xl shadow-xl border border-gray-100"
                    >
                      <MessageSquare className="w-6 h-6 text-[#00C853]" />
                    </motion.div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-bold text-gray-900">Let's team up and win this client!</h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      Use AI suggestions to provide fast and accurate responses.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {qrModalSessionId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl text-center relative"
            >
              <button 
                onClick={() => setQrModalSessionId(null)}
                className="absolute top-6 right-6 p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
              
              <div className="mb-6">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mx-auto mb-4">
                  <Smartphone className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900">Link WhatsApp</h3>
                <p className="text-sm text-gray-500 mt-2">Scan the QR code below with your WhatsApp to connect.</p>
              </div>

              <div className="bg-gray-50 p-6 rounded-3xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center min-h-[280px]">
                {syncingSessions[qrModalSessionId] ? (
                  <div className="flex flex-col items-center gap-6 w-full px-4">
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary animate-pulse">
                      <RefreshCw className="w-10 h-10 animate-spin" />
                    </div>
                    <div className="space-y-4 w-full">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black uppercase tracking-widest text-primary">Syncing Contacts...</span>
                        <span className="text-xs font-black text-primary">{syncingSessions[qrModalSessionId].progress}%</span>
                      </div>
                      <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden shadow-inner">
                        <motion.div 
                          className="h-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${syncingSessions[qrModalSessionId].progress}%` }}
                          transition={{ type: 'tween', ease: 'linear', duration: 0.5 }}
                        />
                      </div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest animate-pulse">
                        {syncingSessions[qrModalSessionId].message || 'Please wait while we load your chat history...'}
                      </p>
                    </div>
                  </div>
                ) : qrCodes[qrModalSessionId] ? (
                  <motion.img 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    src={qrCodes[qrModalSessionId]} 
                    alt="WhatsApp QR Code" 
                    className="w-full max-w-[200px] shadow-sm rounded-xl"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    <p className="text-xs font-bold text-gray-400">Generating QR Code...</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAddingSession && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-6">Add WhatsApp Session</h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">WhatsApp Name <span className="text-red-500 ml-1">*Required</span></label>
                  <input
                    type="text"
                    placeholder="e.g. Sales Support"
                    className={`w-full bg-gray-50 border ${validationErrors.sessionName ? 'border-red-500' : 'border-gray-200'} rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-primary/20`}
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Assign Agent <span className="text-red-500 ml-1">*Required</span></label>
                  <select
                    className={`w-full bg-gray-50 border ${validationErrors.selectedAgent ? 'border-red-500' : 'border-gray-200'} rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-primary/20`}
                    value={selectedAgentForSession}
                    onChange={(e) => setSelectedAgentForSession(e.target.value)}
                  >
                    <option value="">Select Agent</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleAddSession}
                    className="flex-1 bg-primary text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-primary/20"
                  >
                    Create Session
                  </button>
                  <button
                    onClick={() => setIsAddingSession(false)}
                    className="flex-1 bg-gray-100 text-gray-500 py-3 rounded-xl font-bold text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sessionToDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[32px] p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 mx-auto mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Delete Session?</h3>
              <p className="text-sm text-gray-500 mt-2 mb-8">
                Are you sure you want to delete this WhatsApp session? This action cannot be undone and all conversation history will be lost.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleDeleteSession(sessionToDelete)}
                  className="flex-1 bg-red-500 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-red-500/20"
                >
                  Delete
                </button>
                <button
                  onClick={() => setSessionToDelete(null)}
                  className="flex-1 bg-gray-100 text-gray-500 py-3 rounded-xl font-bold text-sm"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
