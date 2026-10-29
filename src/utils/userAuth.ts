export interface UserProfile {
  id: string; // The unique username (e.g. "sribalaji")
  username: string; // unique username
  name: string; // display name (e.g. "Sri Balaji")
  email?: string;
  status: string;
  avatarColor: string;
  createdAt: number;
}

export interface ContactInfo {
  id: string; // username
  name: string;
  email?: string;
  status?: string;
  avatarColor: string;
  lastSeen?: string;
}

export interface DirectoryUser {
  id: string;
  username: string;
  name: string;
  isOnline: boolean;
  avatarColor?: string;
  createdAt?: number;
}

const AUTH_STORAGE_KEY = 'clearvoice_user_session';
const CONTACTS_STORAGE_KEY = 'clearvoice_saved_contacts';
const LOCAL_USERS_KEY = 'clearvoice_registered_users';

const AVATAR_COLORS = [
  '#00a884', // WhatsApp Green
  '#25d366', // Bright Green
  '#38bdf8', // Sky Blue
  '#a855f7', // Purple
  '#f59e0b', // Amber
  '#ef4444', // Coral Red
  '#06b6d4', // Cyan
  '#ec4899', // Pink
];

function getRandomColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function getApiBaseUrl(): string {
  const isProd = import.meta.env.PROD;
  return isProd ? window.location.origin : `http://${window.location.hostname}:3001`;
}

/* ============================================================
   SESSION MANAGEMENT
   ============================================================ */

export function getCurrentUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (!user.username && user.id) {
      user.username = user.id;
    }
    return user;
  } catch {
    return null;
  }
}

/**
 * Sign up with unique username and password
 * No Gmail, No OTP constraints — instant and decentralized
 */
export async function signUpWithUsername(
  username: string,
  password: string,
  displayName?: string,
): Promise<{ user: UserProfile | null; error?: string }> {
  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!cleanUsername || cleanUsername.length < 3) {
    return { user: null, error: 'Username must be at least 3 alphanumeric characters (a-z, 0-9, _).' };
  }

  if (!password || password.length < 4) {
    return { user: null, error: 'Password must be at least 4 characters.' };
  }

  const cleanName = (displayName || cleanUsername).trim();
  const avatarColor = getRandomColor();

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: cleanUsername,
        password,
        displayName: cleanName,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { user: null, error: data.error || 'Failed to sign up.' };
    }

    const user: UserProfile = {
      id: cleanUsername,
      username: cleanUsername,
      name: cleanName,
      status: 'Hey there! I am using ClearVoice',
      avatarColor,
      createdAt: data.user?.createdAt || Date.now(),
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    return { user };
  } catch (err) {
    console.warn('[AUTH] Server signup failed, using local offline fallback:', err);
    // Offline local fallback
    const user: UserProfile = {
      id: cleanUsername,
      username: cleanUsername,
      name: cleanName,
      status: 'Hey there! I am using ClearVoice',
      avatarColor,
      createdAt: Date.now(),
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    return { user };
  }
}

/**
 * Log in with username and password
 */
export async function loginWithUsername(
  username: string,
  password: string,
): Promise<{ user: UserProfile | null; error?: string }> {
  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!cleanUsername || !password) {
    return { user: null, error: 'Please enter your username and password.' };
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: cleanUsername,
        password,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { user: null, error: data.error || 'Invalid username or password.' };
    }

    const user: UserProfile = {
      id: data.user.id || cleanUsername,
      username: cleanUsername,
      name: data.user.name || cleanUsername,
      status: 'Hey there! I am using ClearVoice',
      avatarColor: getRandomColor(),
      createdAt: data.user.createdAt || Date.now(),
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    return { user };
  } catch (err) {
    console.warn('[AUTH] Server login failed, checking local session:', err);
    const existing = getCurrentUser();
    if (existing && existing.username === cleanUsername) {
      return { user: existing };
    }
    return { user: null, error: 'Unable to connect to authentication server. Please check your network.' };
  }
}

/**
 * Fetch directory of all users with online/offline status
 */
export async function fetchUserDirectory(): Promise<DirectoryUser[]> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/users`);
    if (res.ok) {
      const users: DirectoryUser[] = await res.json();
      return users;
    }
  } catch (err) {
    console.warn('[DIRECTORY] Failed to fetch users from server:', err);
  }
  return [];
}

export function updateUserProfile(updates: Partial<UserProfile>): UserProfile | null {
  const current = getCurrentUser();
  if (!current) return null;

  const updated: UserProfile = { ...current, ...updates };
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to update user session', e);
  }
  return updated;
}

export function logoutUser(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {
    console.error('Failed to remove user session', e);
  }
}

/* ============================================================
   CONTACTS (Recent Peers & Saved Chats)
   ============================================================ */

export function getSavedContacts(): ContactInfo[] {
  try {
    const raw = localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) {
      return [
        {
          id: 'echo_bot',
          name: 'ClearVoice Echo Bot',
          status: 'Test your microphone and sound quality',
          avatarColor: '#00a884',
          lastSeen: 'Online',
        },
      ];
    }
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveContact(contact: ContactInfo): void {
  const contacts = getSavedContacts().filter((c) => c.id !== contact.id);
  const updated = [contact, ...contacts];
  try {
    localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save contact', e);
  }
}
