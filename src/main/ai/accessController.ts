import { createServer } from 'node:net';
import { clipboard } from 'electron';
import type { AiAccessActivity, AiAccessSettings, AiAccessState, AiAccessStatus, AiPromptTemplate } from '../../shared/aiAccess';
import { readConfig, writeConfig } from '../appConfig';
import { getOrCreateAccessKey, replaceAccessKey } from './credentialStore';
import { DEFAULT_AGENT_GUIDE, DEFAULT_AI_PROMPTS, RETIRED_TRACE_ANNOTATION_LINKS_PROMPT } from './defaults';
import type { AiAccessSupervisor, AiSupervisorCallbacks } from './supervisor';

interface ControllerOptions {
  getDataFolder(): { sqlitePath: string; imagesDir: string } | null;
  getAppVersion(): string;
}

export class AiAccessController {
  private state: AiAccessState = 'off';
  private endpoint: string | null = null;
  private accessEpoch: string | null = null;
  private clientCount = 0;
  private error: string | null = null;
  private activity: AiAccessActivity[] = [];
  private supervisor: AiAccessSupervisor | null = null;

  constructor(private readonly options: ControllerOptions) {}

  private callbacks(): AiSupervisorCallbacks {
    return {
      onReady: (port, accessEpoch) => {
        this.state = 'on';
        this.endpoint = `http://127.0.0.1:${port}/mcp`;
        this.accessEpoch = accessEpoch;
        this.error = null;
      },
      onStopped: () => {
        this.state = 'off';
        this.endpoint = null;
        this.accessEpoch = null;
        this.clientCount = 0;
      },
      onFatal: (message) => {
        this.state = 'error';
        this.error = message;
        this.endpoint = null;
        this.accessEpoch = null;
        this.clientCount = 0;
      },
      onSessionCount: (count) => {
        this.clientCount = count;
      },
      onActivity: (activity) => {
        this.activity = [activity, ...this.activity].slice(0, 20);
      },
    };
  }

  private async getSupervisor(): Promise<AiAccessSupervisor> {
    if (this.supervisor) return this.supervisor;
    const { AiAccessSupervisor } = await import('./supervisor');
    this.supervisor = new AiAccessSupervisor(this.callbacks());
    return this.supervisor;
  }

  status(): AiAccessStatus {
    const config = readConfig();
    return {
      state: this.state,
      disclosureAccepted: config.aiAccess?.disclosureAccepted === true,
      port: this.endpoint ? Number(new URL(this.endpoint).port) : (config.aiAccess?.port ?? null),
      endpoint: this.endpoint,
      clientCount: this.clientCount,
      accessEpoch: this.accessEpoch,
      error: this.error,
      guide: config.aiAccess?.guide ?? DEFAULT_AGENT_GUIDE,
      recentActivity: [...this.activity],
    };
  }

  settings(): AiAccessSettings {
    const config = readConfig();
    return {
      guide: config.aiAccess?.guide ?? DEFAULT_AGENT_GUIDE,
      prompts: withCurrentBuiltIns(config.aiAccess?.prompts),
    };
  }

  async start(confirmFullRead: boolean): Promise<AiAccessStatus> {
    if (this.state === 'on') return this.status();
    const config = readConfig();
    if (config.aiAccess?.disclosureAccepted !== true && !confirmFullRead) {
      throw new Error('Confirm the complete read-only journal disclosure before starting AI Access.');
    }
    const dataFolder = this.options.getDataFolder();
    if (!dataFolder) throw new Error('Open a journal workspace before starting AI Access.');
    this.state = 'starting';
    this.error = null;
    try {
      const port = config.aiAccess?.port ?? (await findAvailablePort());
      const accessKey = getOrCreateAccessKey();
      const settings = this.settings();
      const configWithCredential = readConfig();
      writeConfig({
        ...configWithCredential,
        aiAccess: {
          ...configWithCredential.aiAccess,
          port,
          disclosureAccepted: true,
          guide: settings.guide,
          prompts: settings.prompts,
        },
      });
      const supervisor = await this.getSupervisor();
      await supervisor.start({
        sqlitePath: dataFolder.sqlitePath,
        imagesDir: dataFolder.imagesDir,
        port,
        accessKey,
        appVersion: this.options.getAppVersion(),
        guide: settings.guide,
        prompts: settings.prompts,
      });
      return this.status();
    } catch (error) {
      this.state = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      await this.supervisor?.stop();
      throw error;
    }
  }

  async stop(): Promise<AiAccessStatus> {
    if (this.state === 'off') return this.status();
    this.state = 'stopping';
    await this.supervisor?.stop();
    if (!this.supervisor) this.state = 'off';
    this.activity = [];
    return this.status();
  }

  async saveSettings(settings: AiAccessSettings): Promise<AiAccessSettings> {
    const normalized = { ...settings, prompts: withCurrentBuiltIns(settings.prompts) };
    validateSettings(normalized);
    const wasOn = this.state === 'on';
    if (wasOn) await this.stop();
    const config = readConfig();
    writeConfig({
      ...config,
      aiAccess: {
        ...config.aiAccess,
        guide: normalized.guide,
        prompts: clonePrompts(normalized.prompts),
      },
    });
    if (wasOn) await this.start(true);
    return this.settings();
  }

  copyHttpConfig(): string {
    if (this.state !== 'on' || !this.endpoint) throw new Error('Start AI Access before copying its configuration.');
    const accessKey = getOrCreateAccessKey();
    const value = JSON.stringify(
      {
        servers: {
          'trading-journal': {
            type: 'http',
            url: this.endpoint,
            headers: { Authorization: `Bearer ${accessKey}` },
          },
        },
      },
      null,
      2,
    );
    clipboard.writeText(`${value}\n`);
    return value;
  }

  async resetAccessKey(): Promise<AiAccessStatus> {
    await this.stop();
    replaceAccessKey();
    return this.status();
  }
}

function clonePrompts(prompts: AiPromptTemplate[]): AiPromptTemplate[] {
  return prompts.map((prompt) => ({ ...prompt, arguments: prompt.arguments.map((argument) => ({ ...argument })) }));
}

function withCurrentBuiltIns(configured: AiPromptTemplate[] | undefined): AiPromptTemplate[] {
  if (!configured) return clonePrompts(DEFAULT_AI_PROMPTS);
  const retained = configured.flatMap((prompt): AiPromptTemplate[] => {
    if (prompt.id !== RETIRED_TRACE_ANNOTATION_LINKS_PROMPT.id) return [prompt];
    const content = (value: AiPromptTemplate) => ({
      id: value.id,
      title: value.title,
      description: value.description,
      arguments: value.arguments,
      body: value.body,
    });
    if (
      JSON.stringify(content(prompt)) === JSON.stringify(content(RETIRED_TRACE_ANNOTATION_LINKS_PROMPT))
    ) {
      return [];
    }
    return [
      {
        ...prompt,
        id: 'trace_annotation_links_retired',
        title: `${prompt.title} (retired)`,
        description: `${prompt.description} Retired link contract; kept only as user text.`,
        enabled: false,
        source: 'custom',
      },
    ];
  });
  const ids = new Set(retained.map((prompt) => prompt.id));
  return clonePrompts([...retained, ...DEFAULT_AI_PROMPTS.filter((prompt) => !ids.has(prompt.id))]);
}

function validateSettings(settings: AiAccessSettings): void {
  if (settings.guide.length > 64 * 1024) throw new Error('Agent Guide must be 64 KiB or smaller.');
  if (settings.prompts.length > 50) throw new Error('Prompt Library supports at most 50 prompts.');
  const ids = new Set<string>();
  for (const prompt of settings.prompts) {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(prompt.id)) throw new Error(`Invalid prompt id: ${prompt.id}`);
    if (ids.has(prompt.id)) throw new Error(`Duplicate prompt id: ${prompt.id}`);
    ids.add(prompt.id);
    if (!prompt.title.trim() || !prompt.description.trim()) throw new Error(`Prompt ${prompt.id} needs a title and description.`);
    if (prompt.body.length > 16 * 1024) throw new Error(`Prompt ${prompt.id} is larger than 16 KiB.`);
    if (prompt.arguments.length > 12) throw new Error(`Prompt ${prompt.id} supports at most 12 arguments.`);
    const argumentNames = new Set<string>();
    for (const argument of prompt.arguments) {
      if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(argument.name)) {
        throw new Error(`Prompt ${prompt.id} has invalid argument ${argument.name}.`);
      }
      if (argumentNames.has(argument.name)) throw new Error(`Prompt ${prompt.id} repeats argument ${argument.name}.`);
      if (!argument.description.trim()) throw new Error(`Prompt ${prompt.id} argument ${argument.name} needs a description.`);
      argumentNames.add(argument.name);
    }
    for (const placeholder of prompt.body.matchAll(/\{\{([a-z0-9_]+)\}\}/g)) {
      if (!argumentNames.has(placeholder[1])) throw new Error(`Prompt ${prompt.id} uses unknown placeholder ${placeholder[0]}.`);
    }
  }
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a loopback port.'));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}