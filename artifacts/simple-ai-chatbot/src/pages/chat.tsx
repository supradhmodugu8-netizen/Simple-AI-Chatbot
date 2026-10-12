import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Bot, CircleAlert, RotateCcw, Sparkles } from 'lucide-react';

type ChatTurn = { role: 'user' | 'assistant'; content: string };

const suggestions = [
  'Explain a tricky idea simply',
  'Help me plan a good weekend',
  'What can I cook with lentils?',
  'Give me a fresh perspective',
];

type StreamEvent = { content?: string; done?: true; error?: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/chat/history', { credentials: 'include' });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error || 'Saved chat history could not be loaded.');
        }
        if (active && Array.isArray(body?.messages)) {
          setMessages(body.messages as ChatTurn[]);
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Saved chat history could not be loaded.');
        }
      } finally {
        if (active) setLoadingHistory(false);
      }
    })();
    return () => { active = false; };
  }, []);

  function resizeTextarea() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  async function submitQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending) return;
    setDraft('');
    setError('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const nextMessages: ChatTurn[] = [...messages, { role: 'user', content: trimmed }];
    const contextMessages = nextMessages.slice(-30);
    if (contextMessages[0]?.role === 'assistant') contextMessages.shift();
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setSending(true);

    try {
      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages: contextMessages }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'We could not reach the chat right now. Please try again.');
      }
      if (!response.body) throw new Error('The response stream was unavailable. Please try again.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      const consumeEvent = (event: string) => {
        const payload = event.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!payload || payload === '[DONE]') return;
        let data: StreamEvent;
        try {
          data = JSON.parse(payload) as StreamEvent;
        } catch {
          return;
        }
        if (data.error) throw new Error(data.error);
        if (data.content) {
          setMessages((current) => {
            const updated = [...current];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: last.content + data.content };
            return updated;
          });
        }
        if (data.done) finished = true;
      };

      while (!finished) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const event of events) consumeEvent(event);
        if (done) {
          if (buffer.trim()) consumeEvent(buffer);
          break;
        }
      }
      if (!finished) throw new Error('The reply ended before it was complete. Please try again.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Something went wrong. Please try again.';
      setError(message);
      setMessages((current) => current.filter((turn, index) =>
        !(turn.role === 'assistant' && turn.content === '' && index === current.length - 1),
      ));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitQuestion(draft);
    }
  }

  async function startFresh() {
    if (sending || loadingHistory) return;
    setError('');
    try {
      const response = await fetch('/api/chat/history/new', {
        method: 'POST',
        credentials: 'include',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'A new chat could not be started.');
      setMessages([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A new chat could not be started.');
      return;
    }
    setDraft('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  }

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <div className="brand-mark" aria-label="Simple AI Chatbot">
          <span className="brand-orbit"><Sparkles size={17} strokeWidth={1.8} /></span>
          <span>goodquestion</span>
        </div>
        <span className="header-note">A little help with whatever’s on your mind</span>
        <button className="fresh-button" type="button" onClick={() => void startFresh()} disabled={sending || loadingHistory} data-testid="button-new-conversation" aria-label="Start a fresh conversation">
          <RotateCcw size={14} />
          <span>New chat</span>
        </button>
      </header>

      <main className="chat-main">
        <div className="thread" ref={threadRef} aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 ? (
            <section className="welcome" aria-labelledby="welcome-heading">
              <div className="welcome-sigil"><Sparkles size={25} strokeWidth={1.6} /></div>
              <div className="eyebrow">A space to wonder</div>
              <h1 id="welcome-heading">What’s on your mind today?</h1>
              <p>Ask about the big things, the small things, or anything in between. We’ll figure it out together.</p>
              <div className="suggestion-list" aria-label="Question ideas">
                {suggestions.map((suggestion) => (
                 <button key={suggestion} type="button" className="suggestion" onClick={() => void submitQuestion(suggestion)} disabled={sending || loadingHistory} data-testid={`suggestion-${suggestion.toLowerCase().replaceAll(' ', '-')}`}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="conversation">
              {messages.map((turn, index) => (
                <article className={`turn ${turn.role}`} key={`${index}-${turn.role}`} data-testid={`message-${turn.role}-${index}`}>
                  {turn.role === 'assistant' && <span className="turn-mark" aria-hidden="true"><Sparkles size={15} /></span>}
                  <div className="turn-copy">
                    <div className="turn-label">{turn.role === 'user' ? 'You' : 'Goodquestion'}</div>
                    {turn.content ? (
                      <div className="message-text">{turn.content}</div>
                    ) : sending ? (
                      <div className="typing-dots" aria-label="Writing a reply"><span /><span /><span /></div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="error-box" role="alert" data-testid="status-chat-error">
            <CircleAlert size={17} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="composer-wrap">
          <form className="composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="chat-message">Ask a question</label>
            <textarea
              id="chat-message"
              ref={textareaRef}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); resizeTextarea(); }}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              rows={1}
              maxLength={12000}
              disabled={sending || loadingHistory}
              data-testid="input-chat-message"
              aria-describedby="composer-hint"
            />
            <div className="composer-actions">
              <span className="composer-hint" id="composer-hint">Enter to send · Shift + Enter for a new line</span>
              <button className={`send-button${sending ? ' loading' : ''}`} type="submit" disabled={sending || loadingHistory || !draft.trim()} data-testid="button-send-message">
                {sending ? <><span>Thinking</span><span className="typing-dots" aria-hidden="true"><span /><span /><span /></span></> : <><span>Send</span><ArrowUp size={15} strokeWidth={2.5} /></>}
              </button>
            </div>
          </form>
          <div className="footnote"><Bot size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />Made for the questions that make a day</div>
        </div>
      </main>
    </div>
  );
}
