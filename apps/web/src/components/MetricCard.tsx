import React from 'react';

interface MetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  status: 'active' | 'ready' | 'pending';
  icon: React.ReactNode;
}

export const MetricCard: React.FC<MetricCardProps> = ({ title, value, subtitle, status, icon }) => {
  const statusStyles = {
    active: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    ready: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
    pending: 'text-vault-400 bg-vault-800 border-vault-700',
  };

  return (
    <div className="p-5 rounded-xl bg-vault-900/40 border border-vault-800/80 hover:border-vault-700/80 transition-all shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-vault-400">{title}</span>
        <div className="p-2 rounded-lg bg-vault-800/50 text-vault-300">{icon}</div>
      </div>
      <div className="text-2xl font-semibold tracking-tight text-white mb-1 font-mono">{value}</div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-vault-400">{subtitle}</span>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusStyles[status]}`}
        >
          {status.toUpperCase()}
        </span>
      </div>
    </div>
  );
};
