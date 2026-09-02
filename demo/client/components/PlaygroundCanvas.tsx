import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  CornerDownLeft,
  Hash,
  Loader2,
  Sparkles,
  User,
  Wrench,
} from 'lucide-react';

import type { PrefixMutationEvent, TurnTokenSnapshot } from '../../../src/index.js';
import { EXPERIMENT_SCENARIOS } from '../scenarios.js';
import type { DemoMessageView, DemoModelOption, DemoSessionState } from '../../shared/protocol.js';
import { PrefixCacheRibbon } from './PrefixCacheRibbon.js';

interface PlaygroundCanvasProps {
  canRun: boolean;
  messages: DemoMessageView[];
  model: DemoModelOption | undefined;
  onPromptChange: (value: string) => void;
  onRunTurn: () => void;
  onSelectScenario: (prompt: string) => void;
  pendingText: string;
  prefixEvent: PrefixMutationEvent | undefined;
  prompt: string;
  session: DemoSessionState | undefined;
  snapshot: TurnTokenSnapshot | undefined;
  streaming: boolean;
}

export const PlaygroundCanvas = ({
  canRun,
  messages,
  model,
  onPromptChange,
  onRunTurn,
  onSelectScenario,
  pendingText,
  prefixEvent,
  prompt,
  session,
  snapshot,
  streaming,
}: PlaygroundCanvasProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedCacheId, setCopiedCacheId] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pendingText]);

  const copyText = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const copyCacheId = () => {
    if (!session) return;
    void navigator.clipboard.writeText(session.cacheIdentity);
    setCopiedCacheId(true);
    setTimeout(() => setCopiedCacheId(false), 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canRun && !streaming && prompt.trim()) {
        onRunTurn();
      }
    }
  };

  return (
    <div className="linear-playground-canvas">
      <div className="canvas-scroll-stage">
        <header className="canvas-minimal-header">
          <div className="header-meta-lead">
            <span className="lead-tag">
              <Sparkles size={11} />
              <span>Prompt Cache Studio</span>
            </span>
            <span className="lead-byline">Deterministic prefix guard & telemetry</span>
          </div>
        </header>

        <PrefixCacheRibbon model={model} session={session} snapshot={snapshot} />

        {messages.length === 0 && !streaming ? (
          <section className="compact-scenarios-deck">
            <div className="scenarios-deck-heading">
              <span>Verification Scenarios</span>
            </div>

            <div className="compact-scenarios-grid">
              {EXPERIMENT_SCENARIOS.map((scenario) => (
                <button
                  className="compact-scenario-pill"
                  key={scenario.id}
                  onClick={() => onSelectScenario(scenario.prompt)}
                  type="button"
                >
                  <div className="scenario-pill-top">
                    <span className="scenario-pill-code">{scenario.badge}</span>
                    <span className="scenario-pill-tag">{scenario.tag}</span>
                  </div>
                  <strong className="scenario-pill-name">{scenario.title}</strong>
                  <span className="scenario-pill-desc">{scenario.description}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="conversation-thread-section">
          <div className="thread-header-bar">
            <div className="thread-title-group">
              <span className="thread-section-title">Transcript</span>
              <span className="thread-count-badge">
                {messages.length} {messages.length === 1 ? 'turn' : 'turns'}
              </span>
            </div>

            <div className="thread-cache-group">
              <span className="cache-hash-label">Hash:</span>
              <button
                className="cache-hash-trigger"
                disabled={!session}
                onClick={copyCacheId}
                title={session ? session.cacheIdentity : 'No active session'}
                type="button"
              >
                <Hash size={11} />
                <code className="cache-hash-code">
                  {session ? session.cacheIdentity.slice(0, 20) : 'standby'}
                </code>
                {copiedCacheId ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </div>
          </div>

          <div className="thread-stream-container">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isTool = msg.role === 'tool';
              const isCopied = copiedId === msg.id;
              let turnClass = 'is-assistant-turn';
              if (isUser) turnClass = 'is-user-turn';
              if (isTool) turnClass = 'is-tool-turn';
              let glyph = <Bot size={12} />;
              if (isUser) glyph = <User size={12} />;
              if (isTool) glyph = <Wrench size={12} />;
              let handle = 'Assistant';
              if (isUser) handle = 'User';
              if (isTool) handle = 'Tool result';

              return (
                <article className={`thread-message-card ${turnClass}`} key={msg.id}>
                  <div className="message-author-bar">
                    <div className="author-identity">
                      <div className="author-glyph">{glyph}</div>
                      <span className="author-handle">{handle}</span>
                      {isTool && msg.toolName ? (
                        <span className="author-model-tag">{msg.toolName}</span>
                      ) : null}
                      {!isUser && !isTool && model ? (
                        <span className="author-model-tag">{model.name}</span>
                      ) : null}
                    </div>

                    <div className="message-utility-group">
                      {msg.stopReason ? (
                        <span className="stop-reason-pill">stop: {msg.stopReason}</span>
                      ) : null}
                      <button
                        className="message-copy-action"
                        onClick={() => copyText(msg.id, msg.text)}
                        title="Copy text"
                        type="button"
                      >
                        {isCopied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>

                  <div className={`message-prose-body ${isTool ? 'is-tool-payload' : ''}`}>
                    {msg.text}
                  </div>
                </article>
              );
            })}

            {streaming ? (
              <article className="thread-message-card is-assistant-turn is-streaming-turn">
                <div className="message-author-bar">
                  <div className="author-identity">
                    <div className="author-glyph">
                      <Bot size={12} />
                    </div>
                    <span className="author-handle">Assistant</span>
                    <span className="streaming-state-label">Streaming…</span>
                  </div>
                </div>

                <div className="message-prose-body">
                  {pendingText}
                  <span className="linear-stream-cursor" aria-hidden="true" />
                </div>
              </article>
            ) : null}

            <div ref={bottomRef} />
          </div>
        </section>
      </div>

      <div className="composer-dock-container">
        <div className="linear-composer-dock">
          <div className="composer-header-strip">
            <div className="composer-meta-tags">
              <span className="composer-meta-pill">
                Model: <strong>{model?.name ?? 'Select model'}</strong>
              </span>
              <span className="composer-meta-pill">
                State: <strong>{session ? 'Active' : 'Standby'}</strong>
              </span>
            </div>
            <div className="composer-shortcut-hint">
              <kbd className="mini-kbd">⌘</kbd>
              <span>+</span>
              <kbd className="mini-kbd">↵</kbd>
              <span>to run</span>
            </div>
          </div>

          <textarea
            aria-label="Agent turn prompt"
            className="composer-input-area"
            disabled={!session || streaming}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              session
                ? 'Send a turn to measure prefix cache hit rate and token attribution…'
                : 'Initialize an engine session from the sidebar to begin…'
            }
            rows={2}
            value={prompt}
          />

          <div className="composer-bottom-strip">
            <span className="composer-hint-text">
              Append-only invariant protects provider KV prefix
            </span>

            <button
              className="composer-send-button"
              disabled={!canRun || streaming || !prompt.trim()}
              onClick={onRunTurn}
              type="button"
            >
              {streaming ? (
                <>
                  <Loader2 size={12} className="spin-indicator" />
                  <span>Computing…</span>
                </>
              ) : (
                <>
                  <span>Run Turn</span>
                  <CornerDownLeft size={12} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
