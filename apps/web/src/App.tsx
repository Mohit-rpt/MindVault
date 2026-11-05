import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { LoginForm } from './components/auth/LoginForm';
import { RegisterForm } from './components/auth/RegisterForm';
import { WorkspaceDashboard } from './components/dashboard/WorkspaceDashboard';
import { CreateWorkspaceModal } from './components/workspace/CreateWorkspaceModal';
import { Sparkles, Loader2 } from 'lucide-react';

const MainApp: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-vault-950 flex flex-col items-center justify-center text-vault-400 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="text-sm font-medium">Initializing MindVault session...</span>
      </div>
    );
  }

  // If unauthenticated, show Authentication Portal
  if (!user) {
    return (
      <div className="min-h-screen bg-vault-950 flex flex-col items-center justify-center p-4">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <span className="font-bold text-xl tracking-tight text-white block">MindVault</span>
            <span className="text-xs text-vault-400">Personal Knowledge Operating System</span>
          </div>
        </div>

        {authMode === 'login' ? (
          <LoginForm onSwitchToRegister={() => setAuthMode('register')} />
        ) : (
          <RegisterForm onSwitchToLogin={() => setAuthMode('login')} />
        )}

        <footer className="mt-8 text-center text-xs text-vault-600">
          MindVault v1.0 • Phase 1: Authentication & Workspace Isolation Active
        </footer>
      </div>
    );
  }

  // Authenticated Workspace Experience
  return (
    <div className="min-h-screen bg-vault-950 text-slate-100 flex flex-col">
      <Navbar onOpenCreateModal={() => setIsCreateModalOpen(true)} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <WorkspaceDashboard />
      </main>

      <footer className="border-t border-vault-800/60 bg-vault-950 py-6 text-center text-xs text-vault-500">
        MindVault v1.0 • Evidence-Grounded, Local-First, Provider-Agnostic
      </footer>

      <CreateWorkspaceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
};
