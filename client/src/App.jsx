import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  Send, 
  Scale, 
  TrendingUp, 
  Lightbulb, 
  CheckSquare, 
  Loader2, 
  LogOut, 
  LogIn, 
  X, 
  CheckCircle2,
  Lock
} from 'lucide-react';

export default function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [currentChat, setCurrentChat] = useState(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Real-time Live Debate Flow State
  const [isDebating, setIsDebating] = useState(false);
  const [activeAgentStatus, setActiveAgentStatus] = useState(null);

  // User Auth State - defaults to null so no hardcoded user or chats
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('secondopinion_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem('secondopinion_token') || '');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);

  const chatBottomRef = useRef(null);
  const chatIdRef = useRef(null);
  const chatLoadRequestRef = useRef(0);
  const debatingRef = useRef(false);

  // Fetch chats for the current user whenever user or token changes
  useEffect(() => {
    if (currentUser && token) {
      fetchChats();
    } else {
      setChats([]);
      setActiveChatId(null);
    }
  }, [currentUser, token]);

  // When the user opens a different past chat, load it.
  // Skip while a debate is streaming so a refresh cannot wipe live model replies.
  useEffect(() => {
    if (activeChatId && token && !debatingRef.current) {
      fetchChatDetails(activeChatId);
    }
  }, [activeChatId, token]);

  // Auto-scroll when messages update or status changes
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [currentChat, isDebating, activeAgentStatus]);

  async function fetchChats() {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/chats', { headers });
      const data = await res.json();
      if (data.success) {
        setChats(data.chats || []);
        // If an active chat is not selected and chats exist, keep current selection
      }
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
  }

  async function fetchChatDetails(id) {
    const requestId = ++chatLoadRequestRef.current;
    try {
      setLoading(true);
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/chats/${id}`, { headers });
      const data = await res.json();
      if (data.success && requestId === chatLoadRequestRef.current && activeChatId === id && !debatingRef.current) {
        chatIdRef.current = data.chat.id;
        setCurrentChat(data.chat);
      }
    } catch (err) {
      console.error('Failed to fetch chat details:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleNewChat() {
    if (isDebating) return;
    chatLoadRequestRef.current += 1;
    chatIdRef.current = null;
    setActiveChatId(null);
    setCurrentChat(null);
    setInputText('');
  }

  function handleSelectChat(id) {
    if (isDebating) return;
    chatLoadRequestRef.current += 1;
    chatIdRef.current = id;
    setCurrentChat(null);
    setActiveChatId(id);
  }

  /* ==========================================================================
     Real-Time Live Debate Execution Flow
     One request per send. Follow-ups reuse the chat id from chat_started.
     ========================================================================== */
  async function handleSendMessage(e) {
    if (e) e.preventDefault();
    const query = inputText.trim();
    if (!query || isDebating) return;

    // If user is not logged in, prompt authentication to save private chats
    if (!currentUser || !token) {
      setAuthError('Please sign in or create an account to start and save your private debates.');
      setShowAuthModal(true);
      return;
    }

    setInputText('');
    debatingRef.current = true;
    setIsDebating(true);
    setActiveAgentStatus({
      agent: 'system',
      label: 'Debate Engine',
      message: 'Asking Llama 3...'
    });

    const userInitial = currentUser?.avatarInitial || 'M';
    const tempUserMsg = {
      id: `user-${Date.now()}`,
      sender: 'user',
      senderLabel: currentUser?.name || 'You',
      avatarText: userInitial,
      color: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
    };

    const knownChatId = (currentChat?.id && currentChat.id !== 'active-debate')
      ? currentChat.id
      : (chatIdRef.current && chatIdRef.current !== 'active-debate' ? chatIdRef.current : null);

    if (knownChatId) {
      const nextRoundNum = (currentChat.rounds?.length || 0) + 1;
      const newRound = {
        id: `temp-round-${nextRoundNum}`,
        roundNumber: nextRoundNum,
        title: `Round ${nextRoundNum}: evaluating follow-up`,
        messages: [tempUserMsg]
      };
      setCurrentChat(prev => ({
        ...prev,
        id: knownChatId,
        rounds: [...(prev?.rounds || []), newRound]
      }));
    } else {
      chatIdRef.current = null;
      const initialRounds = [
        {
          id: 'round-1',
          roundNumber: 1,
          title: 'Round 1: both sides are arguing',
          messages: [tempUserMsg]
        }
      ];
      setCurrentChat({
        id: 'active-debate',
        title: query.length > 25 ? query.substring(0, 24) + '...?' : query + '?',
        question: query,
        rounds: initialRounds
      });
    }

    const params = new URLSearchParams({ question: query, token });
    if (knownChatId) params.set('chatId', knownChatId);

    const applyEvent = (event, data) => {
      if (event === 'chat_started' && data.chatId) {
        chatIdRef.current = data.chatId;
        setActiveChatId(data.chatId);
        setCurrentChat(prev => prev ? {
          ...prev,
          id: data.chatId,
          title: data.title || prev.title,
          question: data.question || prev.question
        } : prev);
        return;
      }

      if (event === 'status') {
        setActiveAgentStatus({
          agent: 'system',
          label: 'Llama 3',
          message: data.message
        });
        return;
      }

      if (event === 'round_start') {
        setCurrentChat(prev => {
          if (!prev) return prev;
          const rounds = [...(prev.rounds || [])];
          const existingIdx = rounds.findIndex(r => r.roundNumber === data.roundNumber);
          if (existingIdx >= 0) {
            rounds[existingIdx] = { ...rounds[existingIdx], title: data.title };
          } else {
            rounds.push({
              id: `round-${data.roundNumber}`,
              roundNumber: data.roundNumber,
              title: data.title,
              messages: []
            });
          }
          return { ...prev, rounds };
        });
        return;
      }

      if (event === 'agent_thinking') {
        setActiveAgentStatus({
          agent: data.agent,
          label: data.label,
          message: data.message
        });
        return;
      }

      if (event === 'agent_message') {
        setCurrentChat(prev => {
          if (!prev) return prev;
          const rounds = (prev.rounds || []).map(round => ({ ...round, messages: [...(round.messages || [])] }));
          let targetRound = rounds.find(r => r.roundNumber === data.roundNumber);
          if (!targetRound) {
            targetRound = {
              id: `round-${data.roundNumber}`,
              roundNumber: data.roundNumber,
              title: `Round ${data.roundNumber}`,
              messages: []
            };
            rounds.push(targetRound);
          }
          if (!targetRound.messages.some(m => m.id === data.message.id)) {
            targetRound.messages.push(data.message);
          }
          return { ...prev, rounds };
        });
        return;
      }

      if (event === 'complete') {
        if (data.chat) {
          chatIdRef.current = data.chat.id;
          setCurrentChat(data.chat);
          setActiveChatId(data.chat.id);
        }
        debatingRef.current = false;
        setIsDebating(false);
        setActiveAgentStatus(null);
        fetchChats();
        return;
      }

      if (event === 'error') {
        const message = data.message || 'The model did not return a response.';
        setCurrentChat(prev => {
          if (!prev) return prev;
          const rounds = (prev.rounds || []).map(round => ({ ...round, messages: [...(round.messages || [])] }));
          const target = rounds[rounds.length - 1];
          if (target && !target.messages.some(m => m.id === 'model-error')) {
            target.messages.push({
              id: 'model-error',
              sender: 'judge',
              senderLabel: 'Debate Engine',
              avatarText: '!',
              color: 'purple',
              text: message,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
            });
          }
          return { ...prev, rounds };
        });
        debatingRef.current = false;
        setIsDebating(false);
        setActiveAgentStatus(null);
      }
    };

    try {
      const res = await fetch(`/api/debate/stream?${params.toString()}`, {
        headers: { Accept: 'text/event-stream' }
      });
      if (!res.ok || !res.body) {
        const detail = await res.text();
        throw new Error(detail || `Debate request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          if (!block.trim()) continue;
          let eventName = 'message';
          const dataLines = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          applyEvent(eventName, JSON.parse(dataLines.join('\n')));
        }
      }
    } catch (err) {
      console.error('Debate stream failed:', err);
      applyEvent('error', { message: err.message || 'Could not reach the model.' });
    } finally {
      debatingRef.current = false;
      setIsDebating(false);
    }
  }

  /* ==========================================================================
     Auth Handlers
     ========================================================================== */
  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError('');
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await res.json();
      if (!data.success) {
        setAuthError(data.message || 'Authentication failed');
        return;
      }

      setToken(data.token);
      setCurrentUser(data.user);
      localStorage.setItem('secondopinion_token', data.token);
      localStorage.setItem('secondopinion_user', JSON.stringify(data.user));
      setShowAuthModal(false);
      setAuthForm({ name: '', email: '', password: '' });
      // Reset current chat view for new account
      chatIdRef.current = null;
      setCurrentChat(null);
      setActiveChatId(null);
    } catch (err) {
      setAuthError('Network error. Please try again.');
    }
  }

  function handleDemoLogin() {
    setAuthError('');
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@secondopinion.ai', password: 'password123' })
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setToken(data.token);
          setCurrentUser(data.user);
          localStorage.setItem('secondopinion_token', data.token);
          localStorage.setItem('secondopinion_user', JSON.stringify(data.user));
          setShowAuthModal(false);
          chatIdRef.current = null;
          setCurrentChat(null);
          setActiveChatId(null);
        }
      });
  }

  function handleLogout() {
    chatLoadRequestRef.current += 1;
    chatIdRef.current = null;
    setCurrentUser(null);
    setToken('');
    setChats([]);
    setCurrentChat(null);
    setActiveChatId(null);
    localStorage.removeItem('secondopinion_token');
    localStorage.removeItem('secondopinion_user');
    setShowUserMenu(false);
  }

  function renderMessageAvatar(sender, avatarText) {
    if (sender === 'user') {
      return <div className="avatar user-avatar">{currentUser?.avatarInitial || 'M'}</div>;
    }
    if (sender === 'for') {
      return <div className="avatar for-avatar">FOR</div>;
    }
    if (sender === 'against') {
      return <div className="avatar against-avatar">AGAINST</div>;
    }
    if (sender === 'questioner') {
      return <div className="avatar questioner-avatar">Q</div>;
    }
    if (sender === 'judge') {
      return <div className="avatar judge-avatar">Judge</div>;
    }
    return <div className="avatar">{avatarText}</div>;
  }

  function renderJudgeContent(message) {
    const vd = message.verdictData;
    if (!vd) {
      return <div className="message-text">{message.text}</div>;
    }

    return (
      <div className="judge-card-content">
        <div className="judge-item verdict-line">
          <span className="judge-icon"><Scale size={18} /></span>
          <span className="judge-field-label">Verdict:</span>
          <span className={`verdict-badge verdict-${vd.verdict ? vd.verdict.toLowerCase().replace(/[^a-z]/g, '') : 'conditional'}`}>
            {vd.verdict || 'CONDITIONAL GO'}
          </span>
        </div>

        <div className="judge-item">
          <span className="judge-icon"><TrendingUp size={18} /></span>
          <span className="judge-field-label">Confidence:</span>
          <span className="judge-confidence-val">{vd.confidence}%</span>
        </div>

        <div className="judge-item">
          <span className="judge-icon"><Lightbulb size={18} /></span>
          <span className="judge-field-label">Reasoning:</span>
          <span className="judge-reasoning-val">{vd.reasoning}</span>
        </div>

        <div className="judge-item">
          <span className="judge-icon"><CheckSquare size={18} /></span>
          <span className="judge-field-label">Next action:</span>
          <span className="judge-action-val">{vd.nextAction}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Top Bar / Global Header */}
      <header className="global-header">
        <div className="header-left">
          <div className="brand-logo" onClick={handleNewChat} style={{ cursor: 'pointer' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="logo-icon">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span className="brand-title">SecondOpinion</span>
          </div>
        </div>

        <div className="header-right">
          {currentUser ? (
            <div className="user-profile-wrapper">
              <div 
                className="user-profile-circle" 
                onClick={() => setShowUserMenu(!showUserMenu)}
                title={currentUser.name}
              >
                <span>{currentUser.avatarInitial || 'M'}</span>
              </div>

              {showUserMenu && (
                <div className="user-dropdown-menu">
                  <div className="user-menu-header">
                    <div className="user-menu-name">{currentUser.name}</div>
                    <div className="user-menu-email">{currentUser.email}</div>
                  </div>
                  <div className="user-menu-divider" />
                  <button className="user-menu-item" onClick={handleLogout}>
                    <LogOut size={16} />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="header-signin-btn" onClick={() => setShowAuthModal(true)}>
              <LogIn size={16} />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="main-layout">
        {/* Left Sidebar */}
        <aside className="sidebar">
          <button className="new-chat-btn" onClick={handleNewChat} disabled={isDebating}>
            <Plus size={18} strokeWidth={2.5} />
            <span>New Chat</span>
          </button>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Past Chats</div>
            <div className="past-chats-list">
              {!currentUser ? (
                <div className="past-chats-empty-state">
                  <Lock size={18} className="empty-icon" />
                  <p>Sign in to view your private past chats.</p>
                  <button className="sidebar-auth-link" onClick={() => setShowAuthModal(true)}>
                    Sign In
                  </button>
                </div>
              ) : chats.length === 0 ? (
                <div className="past-chats-empty-state">
                  <p>No past chats yet.</p>
                  <p className="subtext">Your debate history will update here as you chat.</p>
                </div>
              ) : (
                chats.map(chat => {
                  const isActive = activeChatId === chat.id;
                  return (
                    <div
                      key={chat.id}
                      className={`past-chat-item ${isActive ? 'active' : ''}`}
                      onClick={() => handleSelectChat(chat.id)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="chat-item-icon">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                      </svg>
                      <span className="chat-item-title">{chat.title}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* Center / Main Chat Stage */}
        <main className="chat-stage">
          <div className="chat-messages-container">
            {(!currentChat || !currentChat.rounds || currentChat.rounds.length === 0) ? (
              <div className="empty-state">
                <div className="empty-logo">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <h2>Make high-stakes decisions with adversarial AI debate</h2>
                <p>Enter any entrepreneurial or strategic dilemma below. Watch specialized FOR, AGAINST, Questioner, and Judge agents debate live to reach a grounded verdict.</p>
                <div className="suggestion-chips">
                  <button onClick={() => setInputText("Should I quit my job and open a chai cafe in Chandigarh?")}>
                    ☕ Should I quit my job and open a chai cafe in Chandigarh?
                  </button>
                  <button onClick={() => setInputText("Should I leave my stable job at an MNC to join an early-stage AI startup?")}>
                    🚀 Should I leave my stable job at an MNC to join an early-stage AI startup?
                  </button>
                  <button onClick={() => setInputText("Should I make a lump-sum investment in equity index funds while the market is near an all-time high?")}>
                    📈 Should I make a lump-sum investment in equity index funds now?
                  </button>
                </div>
              </div>
            ) : (
              <div className="conversation-thread">
                {currentChat.rounds.map((round) => (
                  <div key={round.id || round.roundNumber} className="round-block">
                    {/* Round Separator Pill */}
                    <div className="round-separator">
                      <div className="round-pill">
                        {round.title}
                      </div>
                    </div>

                    {/* Messages in this round */}
                    <div className="round-messages">
                      {round.messages.map((message) => {
                        const isUser = message.sender === 'user';
                        const isJudge = message.sender === 'judge';

                        if (isUser) {
                          return (
                            <div key={message.id} className="user-message-row">
                              <div className="user-message-wrapper">
                                <div className="user-bubble">
                                  {message.text}
                                </div>
                                <div className="user-avatar-circle">{currentUser?.avatarInitial || 'M'}</div>
                              </div>
                              <div className="user-timestamp">{message.timestamp}</div>
                            </div>
                          );
                        }

                        // Agent message card
                        return (
                          <div 
                            key={message.id} 
                            className={`agent-message-row agent-${message.sender} ${isJudge ? 'judge-message-row' : ''} pop-in`}
                          >
                            <div className="agent-avatar-col">
                              {renderMessageAvatar(message.sender, message.avatarText)}
                            </div>

                            <div className="agent-content-col">
                              <div className={`agent-sender-label label-${message.sender}`}>
                                {message.senderLabel}
                              </div>

                              <div className={`agent-bubble ${isJudge ? 'judge-card' : ''}`}>
                                {isJudge ? renderJudgeContent(message) : (
                                  <div className="message-text">
                                    {message.text.split('\n').map((line, idx) => (
                                      <p key={idx}>{line}</p>
                                    ))}
                                  </div>
                                )}
                                <div className="agent-timestamp">{message.timestamp}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Real-Time Live Agent Running Status Banner */}
                {isDebating && activeAgentStatus && (
                  <div className={`live-agent-banner banner-${activeAgentStatus.agent} pulse-glow`}>
                    <div className="agent-running-indicator">
                      <div className={`agent-status-badge badge-${activeAgentStatus.agent}`}>
                        {activeAgentStatus.label}
                      </div>
                      <Loader2 className="spinner" size={16} />
                    </div>
                    <div className="agent-running-text">
                      {activeAgentStatus.message}
                    </div>
                  </div>
                )}

                {/* Bottom Spacer so content is completely clear of input bar */}
                <div className="chat-bottom-spacer" />
                <div ref={chatBottomRef} />
              </div>
            )}
          </div>

          {/* Bottom Docked Input Bar - NO PIN, NO OVERLAPPING */}
          <div className="input-bar-container">
            <form className="input-bar-pill" onSubmit={handleSendMessage}>
              <input
                type="text"
                className="chat-input"
                placeholder="Type a message to SecondOpinion..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isDebating}
              />

              <button 
                type="submit" 
                className="input-action-btn send-btn" 
                disabled={!inputText.trim() || isDebating}
                title="Send query"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </main>
      </div>

      {/* Login / Signup Modal */}
      {showAuthModal && (
        <div className="modal-backdrop" onClick={() => setShowAuthModal(false)}>
          <div className="auth-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowAuthModal(false)}>
              <X size={20} />
            </button>

            <div className="auth-tabs">
              <button 
                className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => { setAuthMode('login'); setAuthError(''); }}
              >
                Sign In
              </button>
              <button 
                className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => { setAuthMode('signup'); setAuthError(''); }}
              >
                Create Account
              </button>
            </div>

            {authError && <div className="auth-error-banner">{authError}</div>}

            <form onSubmit={handleAuthSubmit} className="auth-form">
              {authMode === 'signup' && (
                <div className="form-group">
                  <label>Full Name</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. Mayank"
                    value={authForm.name}
                    onChange={e => setAuthForm({ ...authForm, name: e.target.value })}
                  />
                </div>
              )}

              <div className="form-group">
                <label>Email Address</label>
                <input 
                  type="email" 
                  required 
                  placeholder="name@example.com"
                  value={authForm.email}
                  onChange={e => setAuthForm({ ...authForm, email: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input 
                  type="password" 
                  required 
                  placeholder="••••••••"
                  value={authForm.password}
                  onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
                />
              </div>

              <button type="submit" className="auth-submit-btn">
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <div className="auth-divider">
              <span>OR</span>
            </div>

            <button type="button" className="demo-login-btn" onClick={handleDemoLogin}>
              <CheckCircle2 size={16} />
              <span>Instant Demo Login (Mayank - M)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
