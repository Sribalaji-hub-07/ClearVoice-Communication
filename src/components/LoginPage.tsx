import React, { useState } from 'react';
import { loginWithUsername, type UserProfile } from '../utils/userAuth';

interface Props {
  onSuccess: (user: UserProfile) => void;
  onGoToSignUp: () => void;
  demoToast?: (msg: string) => void;
}

export default function LoginPage({ onSuccess, onGoToSignUp }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanUser) {
      setError('Please enter your unique username.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await loginWithUsername(cleanUser, password);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.user) {
      onSuccess(result.user);
    }
  };

  return (
    <div className="auth-page-container">
      <div className="auth-card-wrap">
        {/* Brand Header */}
        <div className="auth-brand-badge">
          <div className="auth-logo-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#00a884">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.07L2 22l5.07-1.34C8.51 21.52 10.21 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
            </svg>
          </div>
          <h1>ClearVoice</h1>
          <p>Decentralized Voice &amp; Messaging Network</p>
        </div>

        {/* Login Box */}
        <div className="auth-glass-box">
          <div className="auth-box-title">
            <h2>Welcome Back</h2>
            <p>Sign in with your username to connect</p>
          </div>

          {error && <div className="auth-error-alert">{error}</div>}

          <form onSubmit={handleLogin} className="auth-form-body">
            <div className="auth-input-group">
              <label>Username</label>
              <div className="auth-input-wrapper">
                <span className="auth-input-prefix">@</span>
                <input
                  type="text"
                  placeholder="e.g. sribalaji"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  autoComplete="username"
                  autoFocus
                />
              </div>
            </div>

            <div className="auth-input-group">
              <label>Password</label>
              <div className="auth-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          <div className="auth-switch-prompt">
            Don't have a username?{' '}
            <button type="button" onClick={onGoToSignUp} className="auth-switch-link">
              Create an Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
