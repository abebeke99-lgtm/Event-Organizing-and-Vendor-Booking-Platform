import React, { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ArrowUp, Check, Clipboard, Copy, FileText, Menu, MessageSquare, Mic, PanelLeftClose, PanelLeftOpen, Pencil, Pin, Plus, Search, Sparkles, Square, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import apiClient from './api/axios.js';
import { translate, translateText, useLanguage } from './language.js';
import { redactAiChatSecrets } from './aiChatSecurity.js';
import { buildChatMessageContent, isSupportedChatTextFile, MAX_CHAT_FILE_BYTES, MAX_CHAT_PROMPT_LENGTH, parseSseEvent } from './aiChatUtils.js';
import './aiChat.css';

function getErrorMessage(error, language) {
  return translateText(error?.message || 'Something went wrong. Please try again.', language);
}

export default function AIChat({ user, currentPath, onNavigate }) {
  const language = useLanguage();
  const t = (key, values = {}) => Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    translate(key, language),
  );
  const routeId = currentPath.match(/^\/ai-chat\/(\d+)(?:\?|$)/)?.[1] || null;
  const [config, setConfig] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifyingModel, setVerifyingModel] = useState(false);
  const [verifiedModel, setVerifiedModel] = useState('');
  const [checkedModel, setCheckedModel] = useState('');
  const [retryContent, setRetryContent] = useState('');
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const streamController = useRef(null);
  const voiceRecognition = useRef(null);
  const voiceTranscript = useRef('');
  const fileInput = useRef(null);
  const modelVerificationRequest = useRef(0);
  const skipNextConversationLoad = useRef(false);
  const endOfMessages = useRef(null);
  const inputRef = useRef(null);
  const retryIsRegeneration = useRef(false);
  async function loadConversations(query = '', archived = showArchived) {
    const response = await apiClient.get('/ai/conversations', {
      params: { ...(query ? { search: query } : {}), ...(archived ? { archived: 'true' } : {}) },
    });
    if (!Array.isArray(response.data?.data)) throw new Error('Conversation history could not be loaded.');
    setConversations(response.data.data);
  }

  useEffect(() => {
    let active = true;
    Promise.all([apiClient.get('/ai/config'), apiClient.get('/ai/conversations')])
      .then(([configResponse, historyResponse]) => {
        if (!active) return;
        const nextConfig = configResponse.data?.data;
        if (!nextConfig || !Array.isArray(nextConfig.models) || !Array.isArray(historyResponse.data?.data)) {
          throw new Error('AI chat settings could not be loaded.');
        }
        setConfig(nextConfig);
        const selectedModel = nextConfig.defaultModel || nextConfig.models[0]?.id || '';
        setModel(selectedModel);
        setConversations(historyResponse.data.data);
        setVerifiedModel('');
        setCheckedModel('');
      })
      .catch((issue) => {
        if (active) setError(getErrorMessage(issue, language));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      modelVerificationRequest.current += 1;
      streamController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (loading || !config?.configured || !model || checkedModel === model || verifyingModel) return;
    void verifyModel(model);
  }, [loading, config?.configured, model, checkedModel, verifyingModel]);

  useEffect(() => {
    let active = true;
    if (skipNextConversationLoad.current) {
      skipNextConversationLoad.current = false;
      return () => { active = false; };
    }
    if (!routeId) {
      setMessages([]);
      setError('');
      if (config?.defaultModel) setModel(config.defaultModel);
      return () => { active = false; };
    }

    setMessages([]);
    setError('');
    apiClient.get(`/ai/conversations/${routeId}/messages`)
      .then((response) => {
        if (!Array.isArray(response.data?.data)) throw new Error('Messages could not be loaded.');
        if (active) setMessages(response.data.data);
      })
      .catch((issue) => {
        if (active) setError(getErrorMessage(issue, language));
      });
    return () => { active = false; };
  }, [routeId, config?.defaultModel]);

  useEffect(() => {
    if (loading) return undefined;
    const timer = window.setTimeout(() => {
      loadConversations(search).catch((issue) => setError(getErrorMessage(issue, language)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, loading, showArchived, language]);

  useEffect(() => {
    endOfMessages.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => () => {
    streamController.current?.abort();
    voiceRecognition.current?.abort();
  }, []);

  async function startConversation(selectedModel) {
    const response = await apiClient.post('/ai/conversations', { model: selectedModel });
    const conversation = response.data?.data;
    if (!conversation?.id) throw new Error('A new conversation could not be created.');
    setConversations((items) => [conversation, ...items]);
    skipNextConversationLoad.current = true;
    onNavigate(`/ai-chat/${conversation.id}`);
    return conversation;
  }

  async function verifyModel(selectedModel = model) {
    if (!selectedModel || verifyingModel) return;
    const requestId = modelVerificationRequest.current + 1;
    modelVerificationRequest.current = requestId;
    setVerifyingModel(true);
    setCheckedModel(selectedModel);
    setError('');
    let editPersisted = false;
    try {
      const response = await apiClient.post('/ai/model/verify', { model: selectedModel });
      if (requestId !== modelVerificationRequest.current) return;
      if (response.data?.data?.available !== true || response.data.data.model !== selectedModel) {
        throw new Error('The selected AI model could not be verified.');
      }
      setVerifiedModel(selectedModel);
    } catch (issue) {
      if (requestId !== modelVerificationRequest.current) return;
      setVerifiedModel('');
      setError(getErrorMessage(issue, language));
    } finally {
      if (requestId === modelVerificationRequest.current) setVerifyingModel(false);
    }
  }

  async function sendMessage(event, contentOverride = null, options = {}) {
    event?.preventDefault();
    const isRetry = typeof contentOverride === 'string';
    const isRegeneration = options.regenerate === true;
    const editId = options.editMessageId ?? (!isRetry && !isRegeneration ? editingMessageId : null);
    const content = isRetry ? contentOverride : buildChatMessageContent(draft, attachment);
    if (!content || sending || !config?.configured || verifiedModel !== model) return;
    if (content.length > MAX_CHAT_PROMPT_LENGTH) {
      setError(t('aiChatMessageTooLong'));
      return;
    }
    if (!isRetry) {
      setDraft('');
      if (inputRef.current) inputRef.current.style.height = '';
      setAttachment(null);
      setEditingMessageId(null);
    }
    setError('');
    setSending(true);
    setRetryContent(content);
    retryIsRegeneration.current = isRegeneration;
    const controller = new AbortController();
    streamController.current = controller;
    const assistantMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', pending: true };
    let completedGeneration = false;
    setMessages((items) => {
      if (isRetry) {
        return retryIsRegeneration.current
          ? items.map((item, index) => index === items.length - 1 ? assistantMessage : item)
          : [...items, assistantMessage];
      }
      if (isRegeneration) {
        return items.map((item, index) => index === items.length - 1
          ? { ...assistantMessage, id: assistantMessage.id }
          : item);
      }
      if (editId) {
        const index = items.findIndex((item) => String(item.id) === String(editId));
        if (index >= 0) {
          return [
            ...items.slice(0, index),
            { ...items[index], content: redactAiChatSecrets(content) },
            assistantMessage,
          ];
        }
      }
      return [...items, { id: `user-${Date.now()}`, role: 'user', content: redactAiChatSecrets(content) }, assistantMessage];
    });

    try {
      const conversation = routeId
        ? { id: routeId }
        : await startConversation(model || config.defaultModel);
      if (editId) {
        await apiClient.patch(`/ai/conversations/${conversation.id}/messages/${editId}`, { content });
        editPersisted = true;
      }
      const baseURL = String(apiClient.defaults.baseURL || '/api').replace(/\/$/, '');
      const response = await fetch(`${baseURL}/ai/conversations/${conversation.id}/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Accept-Language': document.documentElement.lang || 'en',
        },
        body: JSON.stringify({ content, model: model || config.defaultModel, ...(isRegeneration ? { regenerate: true } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event('eventhub:auth-invalidated'));
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || body?.error || `AI request failed (${response.status}).`);
      }
      if (!response.body) throw new Error('This browser does not support streamed responses.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantId = assistantMessage.id;
      let completed = false;
      function handleEvent(text) {
        const parsed = parseSseEvent(text);
        if (!parsed) return;
        if (parsed.event === 'delta' && typeof parsed.data.delta === 'string') {
          setMessages((items) => items.map((item) => item.id === assistantId
            ? { ...item, content: item.content + parsed.data.delta }
            : item));
        } else if (parsed.event === 'complete') {
          completed = true;
          completedGeneration = true;
          assistantId = String(parsed.data.id || assistantId);
          setMessages((items) => items.map((item) => item.id === assistantMessage.id
            ? { ...item, id: assistantId, model: parsed.data.model, pending: false }
            : item));
          setRetryContent('');
        } else if (parsed.event === 'error') {
          throw new Error(parsed.data.message || 'The AI response failed.');
        }
      }
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const eventText of events) handleEvent(eventText);
        if (done) break;
      }
      if (buffer.trim()) handleEvent(buffer);
      if (!completed) throw new Error('The AI stream ended before the response was complete. Please retry.');
      await loadConversations(search);
    } catch (issue) {
      if (editId && !editPersisted) setMessages(messages);
      if (isRegeneration && !completedGeneration) setMessages(messages);
      if (issue.name !== 'AbortError') {
        setError(getErrorMessage(issue, language));
        setMessages((items) => items.map((item) => item.id === assistantMessage.id
          ? { ...item, pending: false }
          : item));
      }
    } finally {
      if (streamController.current === controller) {
        streamController.current = null;
        setSending(false);
      }
      inputRef.current?.focus();
    }
  }

  function stopGenerating() {
    streamController.current?.abort();
    streamController.current = null;
    setSending(false);
    if (retryContent) setError(t('aiChatStopped'));
    setMessages((items) => items.map((item) => item.pending ? { ...item, pending: false } : item));
  }

  async function attachTextFile(file) {
    if (!isSupportedChatTextFile(file)) {
      setError(t('aiChatAttachmentUnsupported'));
      return;
    }
    try {
      const text = await file.text();
      setAttachment({ name: file.name, text: text.slice(0, MAX_CHAT_FILE_BYTES) });
      setError('');
    } catch {
      setError(t('aiChatAttachmentReadError'));
    }
  }

  function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError(t('aiChatVoiceUnsupported'));
      return;
    }
    if (voiceListening) {
      voiceRecognition.current?.stop();
      setVoiceListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    voiceRecognition.current = recognition;
    voiceTranscript.current = '';
    recognition.lang = document.documentElement.lang || 'en';
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript || '')
        .join('');
      if (!transcript) return;
      voiceTranscript.current += transcript;
      setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${transcript}`);
    };
    recognition.onerror = () => {
      setVoiceListening(false);
      setError(t('aiChatVoiceError'));
    };
    recognition.onend = () => setVoiceListening(false);
    recognition.start();
    setVoiceListening(true);
  }

  async function renameConversation(conversation) {
    const title = window.prompt(t('aiChatRename'), conversation.title);
    if (!title?.trim() || title.trim() === conversation.title) return;
    setError('');
    try {
      await apiClient.patch(`/ai/conversations/${conversation.id}`, { title: title.trim() });
      await loadConversations(search);
    } catch (issue) {
      setError(getErrorMessage(issue, language));
    }
  }

  async function deleteConversation(conversation) {
    if (!window.confirm(t('aiChatDeleteConfirm', { title: conversation.title }))) return;
    setError('');
    try {
      await apiClient.delete(`/ai/conversations/${conversation.id}`);
      setConversations((items) => items.filter((item) => item.id !== conversation.id));
      if (String(conversation.id) === routeId) onNavigate('/ai-chat');
    } catch (issue) {
      setError(getErrorMessage(issue, language));
    }
  }

  async function updateConversation(conversation, changes) {
    setError('');
    try {
      await apiClient.patch(`/ai/conversations/${conversation.id}`, changes);
      if (changes.is_archived && String(conversation.id) === routeId) onNavigate('/ai-chat');
      await loadConversations(search);
    } catch (issue) {
      setError(getErrorMessage(issue, language));
    }
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard.writeText(redactAiChatSecrets(message.content));
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(null), 1500);
    } catch {
      setError(t('aiChatNoClipboard'));
    }
  }

  function onComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(event);
    }
  }

  const activeConversation = conversations.find((item) => String(item.id) === routeId);
  const latestUserMessage = [...messages].reverse().find((item) => item.role === 'user');
  const supportsVoiceInput = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  return <main className={`ai-chat-app ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
    <aside className={`ai-chat-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="ai-sidebar-brand">
        <button className="ai-icon-button ai-collapse-button" type="button" aria-label={t(sidebarCollapsed ? 'aiChatExpandHistory' : 'aiChatCollapseHistory')} title={t(sidebarCollapsed ? 'aiChatExpandHistory' : 'aiChatCollapseHistory')} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button>
        <button className="ai-icon-button ai-mobile-close" type="button" aria-label={t('aiChatCloseHistory')} onClick={() => setSidebarOpen(false)}><X size={18}/></button>
        <img src="/eventhub-symbol.png" alt="" />
        <strong>{t('aiChatAssistant')}</strong>
      </div>
      <button className="ai-new-chat" type="button" aria-label={t('aiChatNew')} title={t('aiChatNew')} onClick={() => { stopGenerating(); setMessages([]); setError(''); setDraft(''); setAttachment(null); setShowArchived(false); onNavigate('/ai-chat'); setSidebarOpen(false); }}>
        <Plus size={17}/> {t('aiChatNew')}
      </button>
      <label className="ai-history-search"><Search size={16}/><input aria-label={t('aiChatSearch')} placeholder={t('aiChatSearch')} value={search} onChange={(event) => {
        const nextSearch = event.target.value;
        setSearch(nextSearch);
      }}/></label>
      <div className="ai-history-heading"><span className="ai-history-label">{t(showArchived ? 'aiChatArchived' : 'aiChatRecent')}</span><button type="button" onClick={() => setShowArchived((value) => !value)}>{t(showArchived ? 'aiChatRecent' : 'aiChatArchived')}</button></div>
      <nav className="ai-conversation-list" aria-label={t('aiChatHistory')}>
        {loading ? <p className="ai-sidebar-message">{t('aiChatLoading')}</p>
          : conversations.map((conversation) => <div className={`ai-history-item ${String(conversation.id) === routeId ? 'active' : ''}`} key={conversation.id}>
            <button type="button" className="ai-history-select" onClick={() => { setModel(conversation.model); onNavigate(`/ai-chat/${conversation.id}`); setSidebarOpen(false); }}>
              <MessageSquare size={15}/><span>{conversation.title}</span>
            </button>
            <div className="ai-history-actions">
              {!showArchived && <button type="button" aria-label={`${t(conversation.is_pinned ? 'aiChatUnpin' : 'aiChatPin')} ${conversation.title}`} title={t(conversation.is_pinned ? 'aiChatUnpin' : 'aiChatPin')} onClick={() => void updateConversation(conversation, { is_pinned: !conversation.is_pinned })}><Pin size={14}/></button>}
              <button type="button" aria-label={`${t('aiChatRename')} ${conversation.title}`} title={t('aiChatRename')} onClick={() => void renameConversation(conversation)}><Pencil size={14}/></button>
              <button type="button" aria-label={`${t(showArchived ? 'aiChatRestore' : 'aiChatArchive')} ${conversation.title}`} title={t(showArchived ? 'aiChatRestore' : 'aiChatArchive')} onClick={() => void updateConversation(conversation, { is_archived: !showArchived })}>{showArchived ? <ArchiveRestore size={14}/> : <Archive size={14}/>}</button>
              <button type="button" aria-label={`${t('aiChatDelete')} ${conversation.title}`} title={t('aiChatDelete')} onClick={() => void deleteConversation(conversation)}><Trash2 size={14}/></button>
            </div>
          </div>)}
        {!loading && conversations.length === 0 && <p className="ai-sidebar-message">{t(showArchived ? 'aiChatNoArchived' : 'aiChatNoConversations')}</p>}
      </nav>
      <div className="ai-sidebar-user"><span>{(user?.name || user?.full_name || user?.email || 'U').charAt(0).toUpperCase()}</span><div><strong>{user?.name || user?.full_name || 'EventHub user'}</strong><small>{t('aiChatPrivateWorkspace')}</small></div></div>
    </aside>
    {sidebarOpen && <button className="ai-sidebar-scrim" type="button" aria-label={t('aiChatCloseHistory')} onClick={() => setSidebarOpen(false)}/>}
    <section className="ai-chat-main">
      <header className="ai-chat-header">
        <div className="ai-header-title"><button type="button" className="ai-icon-button ai-mobile-menu" aria-label={t('aiChatOpenHistory')} onClick={() => setSidebarOpen(true)}><Menu size={19}/></button><Sparkles size={18}/><span>{activeConversation?.title || t('aiChatAssistant')}</span></div>
        {config?.models?.length > 0 && <div className="ai-model-controls">
          <label className="ai-model-picker"><span className="visually-hidden">{t('aiChatModel')}</span><select value={model} onChange={(event) => {
            const selectedModel = event.target.value;
            modelVerificationRequest.current += 1;
            setVerifyingModel(false);
            setVerifiedModel('');
            setCheckedModel('');
            setModel(selectedModel);
            setError('');
          }}>{config.models.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          {config.configured && <button className="ai-model-verify" type="button" disabled={verifyingModel} onClick={() => void verifyModel()}>
            {verifyingModel ? t('aiChatModelChecking') : verifiedModel === model ? t('aiChatModelVerified') : t('aiChatModelVerify')}
          </button>}
        </div>}
      </header>
      <div className={`ai-chat-content ${messages.length ? 'has-messages' : ''}`}>
        {messages.length === 0 ? <div className="ai-welcome">
          <div className="ai-welcome-mark"><Sparkles size={25}/></div>
          <h1>{t('aiChatWelcome')}</h1>
          <p>{t('aiChatWelcomeDescription')}</p>
          <div className="ai-prompt-suggestions">
            {[t('aiChatSuggestionWedding'), t('aiChatSuggestionChecklist'), t('aiChatSuggestionBudget')].map((prompt) =>
              <button type="button" key={prompt} onClick={() => { setDraft(prompt); inputRef.current?.focus(); }}>{prompt}<ArrowUp size={15}/></button>)}
          </div>
        </div> : <div className="ai-message-thread" aria-live="polite">
          {messages.map((message, index) => <article className={`ai-message ${message.role}`} key={message.id}>
            <div className="ai-message-avatar">{message.role === 'assistant' ? <Sparkles size={16}/> : (user?.name || user?.full_name || 'U').charAt(0).toUpperCase()}</div>
            <div className="ai-message-body">
              <div className="ai-message-author">{message.role === 'assistant' ? 'EventHub AI' : t('aiChatYou')}</div>
              <div className="ai-message-text">{message.content
                ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
                  a: ({ children, href, ...props }) => <a href={href} target="_blank" rel="noreferrer noopener" {...props}>{children}</a>,
                }}>{redactAiChatSecrets(message.content)}</ReactMarkdown>
                : message.pending ? <span className="ai-typing"><i/><i/><i/></span> : ''}</div>
              <div className="ai-message-actions">
                {message.role === 'assistant' && message.content && <>
                  <button type="button" className="ai-copy-button" onClick={() => void copyMessage(message)}>{copiedMessageId === message.id ? <Check size={14}/> : <Copy size={14}/>} {t(copiedMessageId === message.id ? 'aiChatCopied' : 'aiChatCopy')}</button>
                  {index === messages.length - 1 && !sending && <button type="button" className="ai-copy-button" onClick={() => void sendMessage(undefined, messages[index - 1]?.content, { regenerate: true })}><Sparkles size={14}/>{t('aiChatRegenerate')}</button>}
                </>}
                {message.role === 'user' && String(message.id) === String(latestUserMessage?.id) && !sending && <button type="button" className="ai-copy-button" onClick={() => { setDraft(message.content); setEditingMessageId(message.id); setAttachment(null); inputRef.current?.focus(); }}><Pencil size={14}/>{t('aiChatEdit')}</button>}
              </div>
            </div>
          </article>)}
          <div ref={endOfMessages}/>
        </div>}
      </div>
      {error && <div className="ai-chat-alert" role="alert">{error}
        {retryContent && verifiedModel === model && <button type="button" onClick={() => void sendMessage(undefined, retryContent, { regenerate: retryIsRegeneration.current })} disabled={sending}>{t('aiChatRetry')}</button>}
        <button type="button" aria-label={t('aiChatDismissError')} onClick={() => setError('')}><X size={15}/></button>
      </div>}
      {config?.configured === false && !loading && <div className="ai-config-notice" role="status">{t('aiChatConfigureNotice')}</div>}
      <form className="ai-composer-wrap" onSubmit={(event) => void sendMessage(event)}>
        {attachment && <div className="ai-attachment-chip"><FileText size={15}/><span>{attachment.name}</span><button type="button" aria-label={t('aiChatRemoveAttachment')} onClick={() => setAttachment(null)}><X size={14}/></button></div>}
        {editingMessageId && <div className="ai-editing-note"><Pencil size={14}/>{t('aiChatEditing')}<button type="button" onClick={() => { setEditingMessageId(null); setDraft(''); }}>{t('aiChatCancelEdit')}</button></div>}
        <div className="ai-composer">
          <textarea ref={inputRef} aria-label={t('aiChatInput')} placeholder={config?.configured ? t('aiChatPlaceholder') : config ? t('aiChatNeedsKey') : t('aiChatSettingsUnavailable')} value={draft} onChange={(event) => {
            setDraft(event.target.value);
            event.target.style.height = 'auto';
            event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
          }} onKeyDown={onComposerKeyDown} maxLength={12000} rows={1} disabled={!config?.configured || loading || verifyingModel || verifiedModel !== model}/>
          <div className="ai-composer-tools">
            <input ref={fileInput} className="ai-file-input" type="file" accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json" aria-label={t('aiChatAttachFile')} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void attachTextFile(file);
              event.target.value = '';
            }}/>
            <button type="button" className="ai-tool-button" aria-label={t('aiChatAttachFile')} title={t('aiChatAttachFile')} disabled={sending} onClick={() => fileInput.current?.click()}><FileText size={16}/><span>{t('aiChatAttach')}</span></button>
            {supportsVoiceInput && <button type="button" className={`ai-tool-button ${voiceListening ? 'listening' : ''}`} aria-label={t(voiceListening ? 'aiChatStopVoice' : 'aiChatVoiceInput')} title={t(voiceListening ? 'aiChatStopVoice' : 'aiChatVoiceInput')} onClick={toggleVoiceInput}><Mic size={16}/><span>{t('aiChatVoice')}</span></button>}
          </div>
          {sending ? <button className="ai-send-button stop" type="button" aria-label={t('aiChatStop')} onClick={stopGenerating}><Square size={14} fill="currentColor"/></button>
            : <button className="ai-send-button" type="submit" aria-label={t('aiChatSend')} disabled={!draft.trim() || !config?.configured || loading || verifyingModel || verifiedModel !== model}><ArrowUp size={19}/></button>}
        </div>
        <p>{t('aiChatDisclaimer')}</p>
      </form>
    </section>
  </main>;
}
