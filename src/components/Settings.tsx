import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Save, Key, Trash2, AlertCircle, CheckCircle2, Loader2, RefreshCw, Coins, Shield, Smartphone, FileText, Upload, X, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ApiSetting {
  id: number;
  provider: string;
  api_key: string;
  status: string;
  is_active: number;
  credits_remaining: number;
}

interface UserInfo {
  id: number;
  email: string;
  role: string;
  is_two_factor_enabled: boolean;
}

const PROVIDERS = [
  { id: 'gemini', name: 'Gemini (Google)' },
  { id: 'openai', name: 'OpenAI (GPT-4/3.5)' }
];

export default function Settings() {
  const [settings, setSettings] = useState<ApiSetting[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [newKeys, setNewKeys] = useState<Record<string, string>>({});

  // Training Data State
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [trainingFiles, setTrainingFiles] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  // 2FA Setup State
  const [show2faSetup, setShow2faSetup] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [twoFactorSecret, setTwoFactorSecret] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [isEnabling2fa, setIsEnabling2fa] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchUser();
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const data = await apiFetch('/api/agents');
      setAgents(data);
      if (data.length > 0) setSelectedAgentId(data[0].id.toString());
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    }
  };

  useEffect(() => {
    if (selectedAgentId) {
      fetchTrainingFiles(selectedAgentId);
    }
  }, [selectedAgentId]);

  const fetchTrainingFiles = async (agentId: string) => {
    try {
      const data = await apiFetch(`/api/agents/${agentId}/training-files`);
      setTrainingFiles(data);
    } catch (error) {
      console.error('Failed to fetch training files:', error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAgentId) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/agents/${selectedAgentId}/train-file`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (response.ok) {
        setMessage({ type: 'success', text: 'File uploaded and processed successfully!' });
        fetchTrainingFiles(selectedAgentId);
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || 'Upload failed' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Connection error' });
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDeleteFile = async (fileId: number) => {
    if (!confirm('Are you sure you want to delete this training file?')) return;
    try {
      await apiFetch(`/api/agents/${selectedAgentId}/training-files/${fileId}`, { method: 'DELETE' });
      fetchTrainingFiles(selectedAgentId);
      setMessage({ type: 'success', text: 'File deleted successfully' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to delete file' });
    }
  };

  const fetchUser = async () => {
    try {
      const data = await apiFetch('/api/auth/me');
      setUser(data);
    } catch (error) {
      console.error('Failed to fetch user:', error);
    }
  };

  const fetchSettings = async () => {
    try {
      const data = await apiFetch('/api/settings');
      setSettings(data);
      const keys: Record<string, string> = {};
      data.forEach((s: ApiSetting) => {
        keys[s.provider] = s.api_key;
      });
      setNewKeys(keys);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiFetch('/api/settings/refresh', { method: 'POST' });
      setSettings(data);
      setMessage({ type: 'success', text: 'All API statuses and credits updated!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to refresh API statuses.' });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async (provider: string) => {
    const apiKey = newKeys[provider];
    if (!apiKey) return;

    setSaving(provider);
    setMessage(null);

    try {
      const response = await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ provider, api_key: apiKey })
      });
      setMessage({ 
        type: 'success', 
        text: `API connected successfully! Initial credits: $${response.credits?.toFixed(2) || '0.00'}` 
      });
      fetchSettings();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || `Failed to save ${provider} API key.` });
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (provider: string) => {
    if (!confirm(`Are you sure you want to remove the ${provider} API key?`)) return;

    try {
      await apiFetch(`/api/settings/${provider}`, { method: 'DELETE' });
      setMessage({ type: 'success', text: `${provider} API key removed.` });
      fetchSettings();
      const updatedKeys = { ...newKeys };
      delete updatedKeys[provider];
      setNewKeys(updatedKeys);
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to remove ${provider} API key.` });
    }
  };

  const handleSetup2fa = async () => {
    try {
      const data = await apiFetch('/api/auth/setup-2fa', { method: 'POST' });
      setQrCodeUrl(data.qrCodeUrl);
      setTwoFactorSecret(data.secret);
      setShow2faSetup(true);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to setup 2FA' });
    }
  };

  const handleEnable2fa = async () => {
    if (!twoFactorCode.trim()) return;
    setIsEnabling2fa(true);
    try {
      await apiFetch('/api/auth/enable-2fa', {
        method: 'POST',
        body: JSON.stringify({ code: twoFactorCode })
      });
      setMessage({ type: 'success', text: 'Two-factor authentication enabled successfully!' });
      setShow2faSetup(false);
      fetchUser();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to enable 2FA' });
    } finally {
      setIsEnabling2fa(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'New password must be at least 8 characters' });
      return;
    }

    setIsChangingPassword(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setMessage({ type: 'success', text: 'Password changed successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to change password' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Settings</h1>
          <p className="text-gray-500 dark:text-gray-400">Configure your API keys and system preferences.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-xl text-sm font-bold text-gray-700 dark:text-white hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh All
        </button>
      </div>

      <div className="space-y-6">
        {/* Security Section */}
        <section className="glass-card p-6 rounded-2xl border border-white/20 dark:border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Security & Authentication</h2>
              <p className="text-sm text-gray-500">Manage your password and 2-step verification.</p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Password Change */}
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Key className="w-4 h-4 text-gray-400" /> Change Password
              </h3>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Current Password</label>
                    <div className="relative">
                      <input
                        type={showPasswords ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        placeholder="••••••••"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords(!showPasswords)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">New Password</label>
                    <input
                      type={showPasswords ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Confirm New Password</label>
                    <input
                      type={showPasswords ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium flex items-center gap-2"
                >
                  {isChangingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Update Password
                </button>
              </form>
            </div>

            {/* 2FA Section */}
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">2-Step Google Authentication</p>
                    <p className="text-xs text-gray-500">Protect your account with Google Authenticator.</p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  user?.is_two_factor_enabled ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
                }`}>
                  {user?.is_two_factor_enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>

              {!user?.is_two_factor_enabled && !show2faSetup && (
                <button
                  onClick={handleSetup2fa}
                  className="w-full py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium"
                >
                  Setup 2-Step Verification
                </button>
              )}

              {show2faSetup && (
                <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-white/10">
                  <div className="flex flex-col items-center gap-4">
                    <p className="text-xs text-gray-500 text-center">
                      Scan this QR code with your **Google Authenticator** app or Authy.
                    </p>
                    <img src={qrCodeUrl} alt="2FA QR Code" className="w-48 h-48 bg-white p-2 rounded-lg" />
                    <div className="text-center">
                      <p className="text-[10px] text-gray-400 uppercase font-bold mb-1">Manual Entry Key</p>
                      <code className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{twoFactorSecret}</code>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                      Enter 6-digit verification code
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        className="flex-1 px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 focus:ring-2 focus:ring-blue-500 outline-none text-sm text-center tracking-[0.5em] font-bold"
                      />
                      <button
                        onClick={handleEnable2fa}
                        disabled={isEnabling2fa || twoFactorCode.length !== 6}
                        className="px-6 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        {isEnabling2fa ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify & Enable'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Training Data Section */}
        <section className="glass-card p-6 rounded-2xl border border-white/20 dark:border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <FileText className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Training Data</h2>
              <p className="text-sm text-gray-500">Upload documents to train your AI agents.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Select Agent</label>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                >
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                  {agents.length === 0 && <option value="">No agents found</option>}
                </select>
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Upload New File (PDF, DOCX, TXT)</label>
                <div className="relative">
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    accept=".pdf,.docx,.txt"
                    className="hidden"
                    id="training-file-upload"
                    disabled={isUploading || !selectedAgentId}
                  />
                  <label
                    htmlFor="training-file-upload"
                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-200 dark:border-white/10 hover:border-blue-500 cursor-pointer transition-all text-sm font-medium ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {isUploading ? 'Processing...' : 'Choose File'}
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Uploaded Documents</h3>
              <div className="space-y-2">
                {trainingFiles.map(file => (
                  <div key={file.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-blue-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{file.original_name}</p>
                        <p className="text-[10px] text-gray-500">{new Date(file.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteFile(file.id)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {trainingFiles.length === 0 && (
                  <p className="text-center py-8 text-sm text-gray-500 italic">No training files uploaded yet.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="glass-card p-6 rounded-2xl border border-white/20 dark:border-white/10">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Key className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">API Configurations</h2>
              <p className="text-sm text-gray-500">Add multiple keys for automatic failover.</p>
            </div>
          </div>

          {message && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
                message.type === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
              }`}
            >
              {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <span className="text-sm font-medium">{message.text}</span>
            </motion.div>
          )}

          <div className="grid gap-6">
            {PROVIDERS.map((provider) => {
              const setting = settings.find(s => s.provider === provider.id);
              const isSaving = saving === provider.id;

              return (
                <div key={provider.id} className="flex flex-col gap-3 p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {provider.name}
                      </label>
                      {setting && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-full">
                          <Coins className="w-3 h-3" />
                          <span className="text-[10px] font-bold">${setting.credits_remaining.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    {setting && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        setting.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                      }`}>
                        {setting.status}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={newKeys[provider.id] || ''}
                      onChange={(e) => setNewKeys({ ...newKeys, [provider.id]: e.target.value })}
                      placeholder={`Enter ${provider.name} API Key`}
                      className="flex-1 px-4 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                    <button
                      onClick={() => handleSave(provider.id)}
                      disabled={isSaving || !newKeys[provider.id]}
                      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save
                    </button>
                    {setting && (
                      <button
                        onClick={() => handleDelete(provider.id)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="glass-card p-6 rounded-2xl border border-white/20 dark:border-white/10">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">System Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
              <p className="text-xs text-gray-500 mb-1">Failover Logic</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Enabled (Sequential)</p>
            </div>
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10">
              <p className="text-xs text-gray-500 mb-1">Active AI Provider</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">User-Configured (Dynamic)</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
