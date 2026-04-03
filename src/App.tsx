import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Agents from './components/Agents';
import WhatsApp from './components/WhatsApp';
import Conversations from './components/Conversations';
import Bulk from './components/Bulk';
import Settings from './components/Settings';
import LoadingOverlay from './components/LoadingOverlay';

export default function App() {
  const [token, setToken] = useState<string | null>(() => {
    const saved = localStorage.getItem('token');
    return (saved === 'null' || saved === 'undefined') ? null : saved;
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

  const handleLogin = (newToken: string) => {
    setToken(newToken);
    localStorage.setItem('token', newToken);
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('token');
  };

  if (!token) {
    return (
      <>
        <Login onLogin={handleLogin} />
        <LoadingOverlay />
      </>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard token={token} />;
      case 'agents':
        return <Agents token={token} initialAgentId={selectedAgentId} />;
      case 'whatsapp':
        return <WhatsApp token={token} />;
      case 'conversations':
        return <Conversations token={token} />;
      case 'bulk':
        return <Bulk token={token} />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard token={token} />;
    }
  };

  return (
    <>
      <Layout 
        activeTab={activeTab} 
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'agents') setSelectedAgentId(null);
        }} 
        onLogout={handleLogout}
      >
        {renderContent()}
      </Layout>
      <LoadingOverlay />
    </>
  );
}
