import { useEffect, useRef, useState } from 'react';
import type { AiAccessSettings, AiAccessStatus, AiPromptTemplate } from '../../../shared/aiAccess';
import { Icon } from './icons';

interface Props {
  dataDir: string | null;
  busy: boolean;
  error: string | null;
  onChange: () => void;
  onReveal: () => void;
  onClose: () => void;
}

/**
 * General settings (Home → Settings → General): shows where the journal data folder currently lives
 * and lets the user move it. Changing the folder points the app at the new location as-is (no copy of
 * existing data) and reloads; the app-config pointer that remembers this choice lives separately under
 * the OS user-data folder.
 */
export function GeneralSettingsDialog({ dataDir, busy, error, onChange, onReveal, onClose }: Props): JSX.Element {
  const closeRef = useRef(onClose);
  const [activePage, setActivePage] = useState<'general' | 'ai'>('general');
  const [aiStatus, setAiStatus] = useState<AiAccessStatus | null>(null);
  const [aiSettings, setAiSettings] = useState<AiAccessSettings | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmFullRead, setConfirmFullRead] = useState(false);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = async (): Promise<void> => {
      try {
        const status = await window.api.getAiAccessStatus();
        if (alive) setAiStatus(status);
      } catch (loadError) {
        if (alive) setAiError(messageOf(loadError));
      }
    };
    void Promise.all([refresh(), window.api.getAiAccessSettings().then((settings) => alive && setAiSettings(settings))]);
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const runAiAction = async (action: () => Promise<AiAccessStatus>): Promise<void> => {
    setAiBusy(true);
    setAiError(null);
    setCopied(false);
    try {
      setAiStatus(await action());
    } catch (actionError) {
      setAiError(messageOf(actionError));
      setAiStatus(await window.api.getAiAccessStatus());
    } finally {
      setAiBusy(false);
    }
  };

  const saveAiSettings = async (): Promise<void> => {
    if (!aiSettings) return;
    setAiBusy(true);
    setAiError(null);
    try {
      setAiSettings(await window.api.saveAiAccessSettings(aiSettings));
      setAiStatus(await window.api.getAiAccessStatus());
    } catch (saveError) {
      setAiError(messageOf(saveError));
    } finally {
      setAiBusy(false);
    }
  };

  const copyConfig = async (): Promise<void> => {
    setAiError(null);
    try {
      await window.api.copyAiHttpConfig();
      setCopied(true);
    } catch (copyError) {
      setAiError(messageOf(copyError));
    }
  };

  const updatePrompt = (id: string, patch: Partial<AiPromptTemplate>): void => {
    setAiSettings((current) =>
      current
        ? { ...current, prompts: current.prompts.map((prompt) => (prompt.id === id ? { ...prompt, ...patch } : prompt)) }
        : current,
    );
  };

  const duplicatePrompt = (source: AiPromptTemplate): void => {
    setAiSettings((current) => {
      if (!current) return current;
      const existing = new Set(current.prompts.map((prompt) => prompt.id));
      let index = 1;
      let id = `${source.id}_copy`;
      while (existing.has(id)) id = `${source.id}_copy_${++index}`;
      return {
        ...current,
        prompts: [
          ...current.prompts,
          { ...source, id, title: `${source.title} copy`, source: 'custom', arguments: source.arguments.map((arg) => ({ ...arg })) },
        ],
      };
    });
  };

  const addPrompt = (): void => {
    setAiSettings((current) => {
      if (!current) return current;
      const existing = new Set(current.prompts.map((prompt) => prompt.id));
      let index = 1;
      let id = 'custom_prompt';
      while (existing.has(id)) id = `custom_prompt_${++index}`;
      return {
        ...current,
        prompts: [
          ...current.prompts,
          {
            id,
            title: 'Custom prompt',
            description: 'A journal workflow I want my agent to follow.',
            enabled: true,
            body: 'Read the Agent Guide first, then use the available read-only tools and cite the Entry evidence you used.',
            arguments: [],
            source: 'custom',
          },
        ],
      };
    });
  };

  const aiOn = aiStatus?.state === 'on';
  const aiTransitioning = aiStatus?.state === 'starting' || aiStatus?.state === 'stopping' || aiBusy;

  return (
    <div className="modal" data-testid="general-settings" onMouseDown={() => onClose()}>
      <div className="modal__panel settings general-settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings__head">
          <h2>Settings</h2>
          <button type="button" className="settings__close" aria-label="Close" data-testid="general-close" onClick={onClose}>
            <Icon name="back" />
          </button>
        </header>

        <div className="settings__pages" role="tablist" aria-label="Settings pages">
          <button
            type="button"
            role="tab"
            aria-selected={activePage === 'general'}
            aria-controls="settings-page-general"
            className="settings__page-tab"
            data-testid="settings-tab-general"
            onClick={() => setActivePage('general')}
          >
            General
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePage === 'ai'}
            aria-controls="settings-page-ai"
            className="settings__page-tab"
            data-testid="settings-tab-ai"
            onClick={() => setActivePage('ai')}
          >
            AI
          </button>
        </div>

        <div className="general" data-active-page={activePage}>
          {activePage === 'general' ? (
          <section className="general__section" id="settings-page-general" role="tabpanel" data-testid="settings-page-general">
            <h3 className="general__section-title">Journal data</h3>
            <div className="general__label">复盘数据文件夹</div>
            <div className="general__path" data-testid="general-path">
              {dataDir ?? '（未设置）'}
            </div>

            <div className="general__actions">
              <button type="button" className="settings__btn" data-testid="general-change" disabled={busy} onClick={onChange}>
                {busy ? '切换中…' : '更换文件夹…'}
              </button>
              <button type="button" className="general__btn" data-testid="general-reveal" disabled={busy || !dataDir} onClick={onReveal}>
                在资源管理器中打开
              </button>
            </div>
            {error ? <p className="general__error">{error}</p> : null}

            <p className="general__note">
              更换后应用会直接使用新文件夹里的数据（不会复制旧数据），并重新加载。若把数据放在 OneDrive
              等同步目录，请避免在两台机器上同时打开，以免同步过程中损坏数据。
            </p>
          </section>
          ) : (
          <section
            className="general__section ai-access"
            id="settings-page-ai"
            role="tabpanel"
            data-state={aiStatus?.state ?? 'loading'}
            data-testid="ai-access"
          >
            <div className="ai-access__head">
              <div>
                <h3 className="general__section-title">AI Access</h3>
                <p className="ai-access__sub">Local, optional, permanently read-only MCP access</p>
              </div>
              <span className={`ai-access__status ai-access__status--${aiStatus?.state ?? 'off'}`} data-testid="ai-access-status">
                {aiStatus?.state === 'on'
                  ? `On · ${aiStatus.clientCount} client${aiStatus.clientCount === 1 ? '' : 's'}`
                  : aiStatus?.state ?? 'Loading'}
              </span>
            </div>

            {aiStatus?.endpoint ? <div className="general__path ai-access__endpoint">{aiStatus.endpoint}</div> : null}

            {!aiStatus?.disclosureAccepted ? (
              <label className="ai-access__disclosure">
                <input
                  type="checkbox"
                  checked={confirmFullRead}
                  onChange={(event) => setConfirmFullRead(event.target.checked)}
                  data-testid="ai-access-confirm"
                />
                <span>
                  While AI Access is on, any client using the copied local configuration can read this entire journal,
                  including text and chart images, and may send it to its model provider.
                </span>
              </label>
            ) : (
              <p className="ai-access__grant">AI Access On means full read of this journal, including text and images.</p>
            )}

            <div className="general__actions ai-access__actions">
              {aiOn ? (
                <button
                  type="button"
                  className="settings__btn"
                  data-testid="ai-access-stop"
                  disabled={aiTransitioning}
                  onClick={() => void runAiAction(() => window.api.stopAiAccess())}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="settings__btn"
                  data-testid="ai-access-start"
                  disabled={aiTransitioning || (!aiStatus?.disclosureAccepted && !confirmFullRead)}
                  onClick={() => void runAiAction(() => window.api.startAiAccess(confirmFullRead))}
                >
                  {aiStatus?.state === 'starting' ? 'Starting…' : 'Start'}
                </button>
              )}
              <button
                type="button"
                className="general__btn"
                data-testid="ai-access-copy-http"
                disabled={!aiOn || aiTransitioning}
                onClick={() => void copyConfig()}
              >
                {copied ? 'Copied Copilot config' : 'Copy Copilot config'}
              </button>
              <button
                type="button"
                className="general__btn general__btn--quiet"
                data-testid="ai-access-reset-key"
                disabled={aiTransitioning}
                onClick={() => void runAiAction(() => window.api.resetAiAccessKey())}
              >
                Reset access key
              </button>
            </div>

            <div className="ai-access__steps" data-testid="ai-access-steps">
              <h4>Connect GitHub Copilot in VS Code</h4>
              <ol>
                <li>Start AI Access, then click <strong>Copy Copilot config</strong>.</li>
                <li>In VS Code, open the Command Palette and run <strong>MCP: Open User Configuration</strong>.</li>
                <li>Merge the copied <code>trading-journal</code> server under <code>servers</code>, then save.</li>
                <li>Run <strong>MCP: List Servers</strong>, start <code>trading-journal</code>, and approve its tools.</li>
                <li>Open Copilot Chat in Agent mode and choose a Trading Journal prompt or ask it to inspect a review.</li>
              </ol>
              <p>Keep Trading Journal open and AI Access On. Stop immediately revokes the endpoint and all sessions.</p>
            </div>

            <div className="ai-access__editor">
              <div className="ai-access__editor-head">
                <div>
                  <h4>Agent Guide</h4>
                  <p>These are your trusted chart-reading conventions. The starter already records that labels below bars appear every three bars.</p>
                </div>
                <button type="button" className="general__btn" disabled={!aiSettings || aiTransitioning} onClick={() => void saveAiSettings()}>
                  Save AI settings
                </button>
              </div>
              <textarea
                data-testid="ai-agent-guide"
                value={aiSettings?.guide ?? ''}
                disabled={!aiSettings || aiTransitioning}
                onChange={(event) => setAiSettings((current) => (current ? { ...current, guide: event.target.value } : current))}
                spellCheck={false}
              />
            </div>

            <div className="ai-access__prompts">
              <div className="ai-access__editor-head">
                <div>
                  <h4>Prompt Library</h4>
                  <p>Enabled prompts are exposed through MCP <code>prompts/list</code> and <code>prompts/get</code>.</p>
                </div>
                <button type="button" className="general__btn" disabled={!aiSettings || aiTransitioning} onClick={addPrompt}>
                  Add prompt
                </button>
              </div>
              <div className="ai-access__prompt-list">
                {aiSettings?.prompts.map((prompt) => (
                  <details className="ai-prompt" key={prompt.id} data-testid={`ai-prompt-${prompt.id}`}>
                    <summary>
                      <input
                        type="checkbox"
                        checked={prompt.enabled}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updatePrompt(prompt.id, { enabled: event.target.checked })}
                        aria-label={`Enable ${prompt.title}`}
                      />
                      <span>{prompt.title}</span>
                      <code>{prompt.id}</code>
                    </summary>
                    <div className="ai-prompt__body">
                      <label>
                        Title
                        <input value={prompt.title} onChange={(event) => updatePrompt(prompt.id, { title: event.target.value })} />
                      </label>
                      <label>
                        Description
                        <input
                          value={prompt.description}
                          onChange={(event) => updatePrompt(prompt.id, { description: event.target.value })}
                        />
                      </label>
                      <label>
                        Markdown body
                        <textarea value={prompt.body} onChange={(event) => updatePrompt(prompt.id, { body: event.target.value })} />
                      </label>
                      <div className="general__actions">
                        <button type="button" className="general__btn" onClick={() => duplicatePrompt(prompt)}>
                          Duplicate
                        </button>
                        {prompt.source === 'custom' ? (
                          <button
                            type="button"
                            className="general__btn general__btn--danger"
                            onClick={() =>
                              setAiSettings((current) =>
                                current ? { ...current, prompts: current.prompts.filter((item) => item.id !== prompt.id) } : current,
                              )
                            }
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>

            {aiStatus && aiStatus.recentActivity.length > 0 ? (
              <div className="ai-access__activity">
                <h4>Recent activity</h4>
                {aiStatus.recentActivity.map((item, index) => (
                  <div key={`${item.at}-${index}`}>
                    <time>{new Date(item.at).toLocaleTimeString()}</time>
                    <span>{item.client}</span>
                    <code>{item.operation}</code>
                    <b data-outcome={item.outcome}>{item.outcome}</b>
                  </div>
                ))}
              </div>
            ) : null}
            {aiError || aiStatus?.error ? <p className="general__error">{aiError ?? aiStatus?.error}</p> : null}
          </section>
          )}
        </div>
      </div>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
