import React from 'react';
import { Header } from './Header';

interface LayoutProps {
  children: React.ReactNode;
  apiStatus: 'checking' | 'connected' | 'disconnected';
}

export const Layout: React.FC<LayoutProps> = ({ children, apiStatus }) => {
  return (
    <div className="min-h-screen flex flex-col bg-vault-950 text-slate-100">
      <Header apiStatus={apiStatus} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      <footer className="border-t border-vault-800/60 bg-vault-950 py-6 text-center text-xs text-vault-500">
        <p>MindVault v1.0 • Modular Monolith • Local-First, Provider-Agnostic, Evidence-Grounded</p>
      </footer>
    </div>
  );
};
