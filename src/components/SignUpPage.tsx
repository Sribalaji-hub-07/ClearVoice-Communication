import React, { useState } from 'react';
import { signUpWithUsername, type UserProfile } from '../utils/userAuth';

interface Props {
  onSuccess: (user: UserProfile) => void;
  onGoToLogin: () => void;
  demoToast?: (msg: string) => void;
}

export default function SignUpPage({ onSuccess, onGoToLogin }: Props) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (!cleanUser || cleanUser.length < 3) {
      setError('Username must be at least 3 letters, numbers, or underscores.');
      return;
    }

    if (!password || password.length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await signUpWithUsername(cleanUser, password, displayName.trim() || cleanUser);
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
          <p>Decentralized Peer-to-Peer Voice &amp; Chat</p>
        </div>

        {/* SignUp Box */}
        <div className="auth-glass-box">
          <div className="auth-box-title">
            <h2>Create Your Identity</h2>
            <p>Pick a unique username to start calling &amp; messaging</p>
          </div>

          {error && <div className="auth-error-alert">{error}</div>}

          <form onSubmit={handleSignUp} className="auth-form-body">
            <div className="auth-input-group">
              <label>Choose Unique Username</label>
              <div className="auth-input-wrapper">
                <span className="auth-input-prefix">@</span>
                <input
                  type="text"
                  placeholder="e.g. sribalaji"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <span className="auth-hint-text">This will be your unique calling PIN &amp; ID.</span>
            </div>

            <div className="auth-input-group">
              <label>Display Name (Optional)</label>
              <div className="auth-input-wrapper">
                <input
                  type="text"
                  placeholder="e.g. Sri Balaji"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>

            <div className="auth-input-group">
              <label>Password</label>
              <div className="auth-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
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

            <div className="auth-input-group">
              <label>Confirm Password</label>
              <div className="auth-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? 'Creating Account...' : 'Sign Up Free'}
            </button>
          </form>

          <div className="auth-switch-prompt">
            Already have a username?{' '}
            <button type="button" onClick={onGoToLogin} className="auth-switch-link">
              Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
