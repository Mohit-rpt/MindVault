import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Lock, Mail, User, AlertCircle, Loader2 } from 'lucide-react';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
}

export const RegisterForm: React.FC<RegisterFormProps> = ({ onSwitchToLogin }) => {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setIsSubmitting(true);

    try {
      await register({ name, email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-8 rounded-2xl bg-theme-surface border border-theme-border shadow-xl backdrop-blur-sm">
      <div className="mb-6 text-center">
        <div className="w-10 h-10 rounded-xl bg-theme-accent/10 border border-theme-accent/20 flex items-center justify-center text-theme-accent mx-auto mb-3 font-serif font-bold text-lg">
          MV
        </div>
        <h2 className="text-2xl font-bold text-theme-text tracking-tight font-serif">Create your Account</h2>
        <p className="text-xs text-theme-text-muted mt-1.5">
          Start your personal knowledge workspace
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-theme-text mb-1.5">Full Name</label>
          <div className="relative">
            <User className="w-4 h-4 text-theme-text-muted absolute left-3 top-3" />
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              className="w-full pl-9 pr-3 py-2 bg-theme-surface-secondary border border-theme-border rounded-xl text-sm text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-theme-text mb-1.5">Email Address</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-theme-text-muted absolute left-3 top-3" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ada@example.com"
              className="w-full pl-9 pr-3 py-2 bg-theme-surface-secondary border border-theme-border rounded-xl text-sm text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-theme-text mb-1.5">
            Password (min 8 characters)
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-theme-text-muted absolute left-3 top-3" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-9 pr-3 py-2 bg-theme-surface-secondary border border-theme-border rounded-xl text-sm text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-theme-text mb-1.5">
            Confirm Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-theme-text-muted absolute left-3 top-3" />
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-9 pr-3 py-2 bg-theme-surface-secondary border border-theme-border rounded-xl text-sm text-theme-text placeholder-theme-text-muted focus:outline-none focus:border-theme-accent transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 bg-theme-accent hover:opacity-90 text-white font-medium text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Creating account & workspace...</span>
            </>
          ) : (
            'Get Started'
          )}
        </button>
      </form>

      <div className="mt-6 text-center text-xs text-theme-text-muted">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-theme-text hover:underline font-medium"
        >
          Sign in
        </button>
      </div>
    </div>
  );
};
