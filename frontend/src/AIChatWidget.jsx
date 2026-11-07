import React, { useEffect, useRef, useState } from 'react';
import { Bot, CalendarDays, MessageCircle, Minus, Send, Sparkles, Store, Trash2, X } from 'lucide-react';
import apiClient from './api/axios.js';
import { useLanguage } from './language.js';
import './aiChatWidget.css';

const copy = {
  en: {
    open: 'Chat with EventHub AI',
    title: 'EventHub AI',
    subtitle: 'Event planning assistant',
    checking: 'Checking service',
    configured: 'Configured',
    online: 'Online',
    offline: 'Offline',
    placeholder: 'Ask about events, vendors, or planning…',
    send: 'Send message',
    close: 'Close chat',
    minimize: 'Minimize chat',
    clear: 'Clear conversation',
    you: 'You',
    assistant: 'EventHub AI',
    welcome: 'Hi! I can help you explore real EventHub events, verified vendors, services, and event-planning steps.',
    empty: 'No messages yet. Choose a question or tell me what you are planning.',
    suggestions: ['Find events near me', 'Find a vendor or service', 'How do bookings work?', 'Help me plan an event'],
    events: 'Browse events',
    vendors: 'Find vendors',
    services: 'Browse services',
    failed: 'I could not get a response right now. Please try again shortly.',
    noProvider: 'AI chat is temporarily unavailable. Please try again later.',
    links: 'Explore on EventHub',
  },
  am: {
    open: 'ከEventHub AI ጋር ይወያዩ',
    title: 'EventHub AI',
    subtitle: 'የዝግጅት እቅድ ረዳት',
    checking: 'አገልግሎቱን በመፈተሽ ላይ',
    configured: 'ተዘጋጅቷል',
    online: 'የበራ',
    offline: 'ከመስመር ውጭ',
    placeholder: 'ስለ ዝግጅቶች፣ አቅራቢዎች ወይም ዕቅድ ይጠይቁ…',
    send: 'መልዕክት ይላኩ',
    close: 'ውይይቱን ዝጋ',
    minimize: 'ውይይቱን አሳንስ',
    clear: 'ውይይቱን አጽዳ',
    you: 'እርስዎ',
    assistant: 'EventHub AI',
    welcome: 'ሰላም! በEventHub ያሉ ዝግጅቶችን፣ የተረጋገጡ አቅራቢዎችን፣ አገልግሎቶችን እና የዝግጅት እቅድ ሂደቶችን እንዲያገኙ እረዳዎታለሁ።',
    empty: 'ገና መልዕክቶች የሉም። ጥያቄ ይምረጡ ወይም ምን እንደሚያዘጋጁ ይንገሩኝ።',
    suggestions: ['በአቅራቢያዬ ያሉ ዝግጅቶችን ፈልግ', 'አቅራቢ ወይም አገልግሎት ፈልግ', 'የቦታ ማስያዣ ሂደቱ እንዴት ነው?', 'ዝግጅት እንዳዘጋጅ እርዳኝ'],
    events: 'ዝግጅቶችን ይመልከቱ',
    vendors: 'አቅራቢዎችን ያግኙ',
    services: 'አገልግሎቶችን ይመልከቱ',
    failed: 'አሁን ምላሽ ማግኘት አልቻልኩም። እባክዎ ቆይተው ይሞክሩ።',
    noProvider: 'የAI ውይይት ለጊዜው አይገኝም። እባክዎ ቆይተው ይሞክሩ።',
    links: 'በEventHub ይመልከቱ',
  },
};

function readMessages(key) {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(key) || '[]');
    return Array.isArray(stored) ? stored.slice(-40).filter((item) => (
      item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string'
    )) : [];
  } catch {
    return [];
  }
}

function createMessage(role, content, references = []) {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content, references, createdAt: new Date().toISOString() };
}

function formatTime(date, language) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'am' ? 'am-ET' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

export default function AIChatWidget({ user, onNavigate }) {
  const language = useLanguage();
  const text = copy[language === 'am' ? 'am' : 'en'];
  const storageKey = `eventhub-ai-widget:${user?.id || 'visitor'}`;
  const [messages, setMessages] = useState([]);
  const [hydratedKey, setHydratedKey] = useState('');
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  function refreshStatus() {
    setStatus('checking');
    apiClient.get('/ai/status')
      .then((response) => setStatus(response.data?.data?.configured ? 'configured' : 'offline'))
      .catch(() => setStatus('offline'));
  }

  useEffect(() => {
    setHydratedKey('');
    setMessages(readMessages(storageKey));
    setHydratedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (hydratedKey !== storageKey) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch (issue) {
      console.error('AI chat session could not be saved:', issue);
    }
  }, [messages, hydratedKey, storageKey]);

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open, minimized]);

  async function sendMessage(event, selectedText = draft) {
    event?.preventDefault();
    const message = selectedText.trim();
    if (!message || sending) return;
    const previousMessages = messagesRef.current;
    const userMessage = createMessage('user', message);
    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setError('');
    setSending(true);
    try {
      const response = await apiClient.post('/ai/assist', {
        message,
        language,
        history: previousMessages.slice(-8).map(({ role, content }) => ({ role, content })),
      }, { timeout: 65000 });
      const result = response.data?.data;
      if (typeof result?.content !== 'string' || !result.content.trim()) {
        throw new Error('The AI response was empty.');
      }
      setMessages((current) => [...current, createMessage('assistant', result.content, result.references || [])]);
      setStatus('online');
    } catch (issue) {
      const missingConfiguration = issue.status === 503 && /not configured/i.test(issue.message || '');
      setError(issue.status === 503
        ? text.noProvider
        : text.failed);
      setStatus(missingConfiguration ? 'offline' : 'configured');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function clearConversation() {
    setMessages([]);
    setError('');
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch (issue) {
      console.error('AI chat session could not be cleared:', issue);
    }
  }

  const statusText = status === 'checking'
    ? text.checking
    : status === 'online'
      ? text.online
      : status === 'configured'
        ? text.configured
        : text.offline;

  return <div className="ai-chat-widget">
    {open && <section className={`ai-widget-panel ${minimized ? 'is-minimized' : ''}`} aria-label={text.title}>
      <header className="ai-widget-header">
        <div className="ai-widget-brand">
          <span className="ai-widget-logo"><Sparkles size={18}/></span>
          <span><strong>{text.title}</strong><small><i className={`ai-widget-status is-${status}`}/>{statusText}</small></span>
        </div>
        <div className="ai-widget-controls">
          <button type="button" aria-label={text.clear} title={text.clear} onClick={clearConversation}><Trash2 size={16}/></button>
          <button type="button" aria-label={text.minimize} title={text.minimize} onClick={() => setMinimized((value) => !value)}><Minus size={17}/></button>
          <button type="button" aria-label={text.close} title={text.close} onClick={() => { setOpen(false); setMinimized(false); }}><X size={17}/></button>
        </div>
      </header>
      {!minimized && <>
        <div className="ai-widget-messages" ref={scrollRef} aria-live="polite">
          {messages.length === 0 && <div className="ai-widget-welcome">
            <span className="ai-widget-welcome-icon"><Bot size={23}/></span>
            <p>{text.welcome}</p>
            <div className="ai-widget-suggestions">
              {text.suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => void sendMessage(undefined, suggestion)} disabled={sending}>{suggestion}</button>)}
            </div>
          </div>}
          {messages.map((message) => <article className={`ai-widget-message ${message.role}`} key={message.id}>
            <div className="ai-widget-message-meta"><strong>{message.role === 'user' ? text.you : text.assistant}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time></div>
            <p>{message.content}</p>
            {message.role === 'assistant' && message.references?.length > 0 && <div className="ai-widget-references">
              <span>{text.links}</span>
              {message.references.slice(0, 6).map((reference) => <button type="button" key={`${reference.href}-${reference.id}`} onClick={() => onNavigate(reference.href)}>
                {reference.title || reference.name}
              </button>)}
            </div>}
          </article>)}
          {sending && <div className="ai-widget-typing" role="status" aria-label={text.assistant}><i/><i/><i/></div>}
        </div>
        {error && <div className="ai-widget-error" role="alert">{error}<button type="button" aria-label={text.close} onClick={() => setError('')}><X size={14}/></button></div>}
        {status === 'offline' && !error && <div className="ai-widget-error" role="status">{text.noProvider}</div>}
        <div className="ai-widget-quick-actions">
          <button type="button" onClick={() => onNavigate('/events')}><CalendarDays size={14}/>{text.events}</button>
          <button type="button" onClick={() => onNavigate('/vendors')}><Store size={14}/>{text.vendors}</button>
          <button type="button" onClick={() => onNavigate('/services')}><MessageCircle size={14}/>{text.services}</button>
        </div>
        <form className="ai-widget-composer" onSubmit={(event) => void sendMessage(event)}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(event);
              }
            }}
            placeholder={text.placeholder}
            aria-label={text.placeholder}
            maxLength={4000}
            rows={1}
            disabled={sending || status === 'offline'}
          />
          <button type="submit" aria-label={text.send} disabled={!draft.trim() || sending || status === 'offline'}><Send size={17}/></button>
        </form>
      </>}
    </section>}
    <button className={`ai-widget-launcher ${open ? 'is-open' : ''}`} type="button" aria-label={text.open} title={text.open} aria-expanded={open} onClick={() => {
      if (!open && status === 'offline') refreshStatus();
      setOpen((value) => !value);
      setMinimized(false);
    }}>
      {open ? <X size={22}/> : <MessageCircle size={23}/>}
    </button>
  </div>;
}
