export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'read';
  isVoiceNote?: boolean;
}

export interface ChatThread {
  contactId: string;
  contactName: string;
  contactEmail?: string;
  contactStatus?: string;
  avatarColor: string;
  lastMessage: string;
  lastTimestamp: number;
  unreadCount: number;
}

const CHAT_THREADS_KEY = 'clearvoice_chat_threads';
const CHAT_MESSAGES_KEY_PREFIX = 'clearvoice_chat_msg_';

export function getChatThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(CHAT_THREADS_KEY);
    if (!raw) {
      return [
        {
          contactId: '2048',
          contactName: 'ClearVoice Echo Bot',
          contactEmail: 'echobot@clearvoice.app',
          contactStatus: 'Direct peer audio & text testing',
          avatarColor: '#FFE600',
          lastMessage: 'Welcome to ClearVoice! Send a message or call with real-time DSP.',
          lastTimestamp: Date.now() - 1000 * 60 * 5,
          unreadCount: 0,
        },
      ];
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to get chat threads', e);
    return [];
  }
}

export function saveChatThread(thread: ChatThread): void {
  const threads = getChatThreads().filter((t) => t.contactId !== thread.contactId);
  const updated = [thread, ...threads];
  try {
    localStorage.setItem(CHAT_THREADS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save chat thread', e);
  }
}

export function getMessagesForContact(contactId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${CHAT_MESSAGES_KEY_PREFIX}${contactId}`);
    if (!raw) {
      if (contactId === '2048') {
        return [
          {
            id: 'msg_welcome_1',
            senderId: '2048',
            receiverId: 'me',
            text: 'Welcome to ClearVoice! 🎙️⚡ You are connected to the peer-to-peer noise-cancelling network.',
            timestamp: Date.now() - 1000 * 60 * 5,
            status: 'read',
          },
          {
            id: 'msg_welcome_2',
            senderId: '2048',
            receiverId: 'me',
            text: 'Tap the 📞 Call icon above to test direct voice calling with adaptive spectral subtraction!',
            timestamp: Date.now() - 1000 * 60 * 4,
            status: 'read',
          },
        ];
      }
      return [];
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load messages for contact', e);
    return [];
  }
}

export function saveMessage(contactId: string, message: Omit<ChatMessage, 'id'>): ChatMessage {
  const messages = getMessagesForContact(contactId);
  const newMsg: ChatMessage = {
    ...message,
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  };

  const updatedMessages = [...messages, newMsg];
  try {
    localStorage.setItem(`${CHAT_MESSAGES_KEY_PREFIX}${contactId}`, JSON.stringify(updatedMessages));
  } catch (e) {
    console.error('Failed to save message', e);
  }

  const threads = getChatThreads();
  const existingThread = threads.find((t) => t.contactId === contactId);
  if (existingThread) {
    saveChatThread({
      ...existingThread,
      lastMessage: newMsg.text,
      lastTimestamp: newMsg.timestamp,
    });
  }

  return newMsg;
}

export function markThreadRead(contactId: string): void {
  const threads = getChatThreads();
  const index = threads.findIndex((t) => t.contactId === contactId);
  if (index !== -1 && threads[index].unreadCount > 0) {
    threads[index].unreadCount = 0;
    try {
      localStorage.setItem(CHAT_THREADS_KEY, JSON.stringify(threads));
    } catch (e) {
      console.error('Failed to mark thread as read', e);
    }
  }
}

export function clearAllChats(): void {
  const threads = getChatThreads();
  threads.forEach((t) => {
    localStorage.removeItem(`${CHAT_MESSAGES_KEY_PREFIX}${t.contactId}`);
  });
  localStorage.removeItem(CHAT_THREADS_KEY);
}
