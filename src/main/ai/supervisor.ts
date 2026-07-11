import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { AiAccessActivity, AiPromptTemplate } from '../../shared/aiAccess';
import type {
  AiCompanionBootConfig,
  AiCompanionToMainMessage,
  AiMainToCompanionMessage,
} from '../../shared/aiCompanionProtocol';
import { JournalReadService } from './journalReadService';
import { toAiReadError } from './readErrors';

export interface AiSupervisorStartOptions {
  sqlitePath: string;
  imagesDir: string;
  port: number;
  accessKey: string;
  appVersion: string;
  guide: string;
  prompts: AiPromptTemplate[];
}

export interface AiSupervisorCallbacks {
  onReady(port: number, accessEpoch: string): void;
  onStopped(): void;
  onFatal(message: string): void;
  onSessionCount(count: number): void;
  onActivity(activity: AiAccessActivity): void;
}

export class AiAccessSupervisor {
  private child: UtilityProcess | null = null;
  private readService: JournalReadService | null = null;
  private stopping = false;
  private journalInstanceId: string | null = null;
  private accessEpoch: string | null = null;

  constructor(private readonly callbacks: AiSupervisorCallbacks) {}

  start(options: AiSupervisorStartOptions): Promise<{ port: number; accessEpoch: string; journalInstanceId: string }> {
    if (this.child || this.readService) throw new Error('AI Access is already running');
    this.stopping = false;
    const accessEpoch = randomUUID();
    const journalInstanceId = randomUUID();
    this.accessEpoch = accessEpoch;
    this.journalInstanceId = journalInstanceId;
    const service = new JournalReadService(
      options.sqlitePath,
      options.imagesDir,
      options.appVersion,
      journalInstanceId,
      accessEpoch,
    );
    service.assertQueryOnly();
    this.readService = service;
    const boot: AiCompanionBootConfig = {
      port: options.port,
      accessKey: options.accessKey,
      accessEpoch,
      journalInstanceId,
      appVersion: options.appVersion,
      guide: options.guide,
      prompts: options.prompts,
    };
    let resolveStartup!: (value: { port: number; accessEpoch: string; journalInstanceId: string }) => void;
    let rejectStartup!: (error: Error) => void;
    const startup = new Promise<{ port: number; accessEpoch: string; journalInstanceId: string }>((resolve, reject) => {
      resolveStartup = resolve;
      rejectStartup = reject;
    });
    const child = utilityProcess.fork(join(__dirname, '..', 'aiCompanion.js'), [], {
      env: companionEnvironment(JSON.stringify(boot)),
      serviceName: 'Trading Journal AI Access',
      stdio: 'pipe',
    });
    this.child = child;
    const timeout = setTimeout(() => {
      rejectStartup(new Error('AI companion did not start within 60 seconds'));
      void this.stop();
    }, 60_000);
    const onStartupExit = (code: number): void => {
      clearTimeout(timeout);
      child.off('message', onReady);
      rejectStartup(new Error(`AI companion exited before startup completed (code ${code})`));
    };
    const onReady = (message: AiCompanionToMainMessage): void => {
      if (message.type === 'ready') {
        clearTimeout(timeout);
        child.off('message', onReady);
        child.off('exit', onStartupExit);
        resolveStartup({ port: message.port, accessEpoch, journalInstanceId });
      } else if (message.type === 'fatal') {
        clearTimeout(timeout);
        child.off('message', onReady);
        child.off('exit', onStartupExit);
        rejectStartup(new Error(message.message));
      }
    };
    child.on('message', onReady);
    child.on('exit', onStartupExit);
    child.stdout?.on('data', (chunk: Buffer) => console.log(`[ai-companion] ${chunk.toString().trimEnd()}`));
    child.stderr?.on('data', (chunk: Buffer) => console.error(`[ai-companion] ${chunk.toString().trimEnd()}`));
    child.on('message', (message: AiCompanionToMainMessage) => void this.onMessage(message));
    child.on('exit', (code) => this.onExit(code));
    let startSent = false;
    const sendStart = (): void => {
      if (startSent) return;
      startSent = true;
      child.postMessage({ type: 'start' } satisfies AiMainToCompanionMessage);
    };
    child.once('spawn', sendStart);
    if (child.pid !== undefined) sendStart();
    return startup;
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const child = this.child;
    if (!child) {
      this.closeReadService();
      this.callbacks.onStopped();
      return;
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 5_000);
      const finish = (): void => {
        clearTimeout(timeout);
        resolve();
      };
      child.once('exit', finish);
      child.once('message', (message: AiCompanionToMainMessage) => {
        if (message.type === 'stopped') finish();
      });
      child.postMessage({ type: 'stop' } satisfies AiMainToCompanionMessage);
    });
    if (child.pid !== undefined) child.kill();
    this.child = null;
    this.closeReadService();
    this.callbacks.onStopped();
  }

  private async onMessage(message: AiCompanionToMainMessage): Promise<void> {
    if (message.type === 'ready') {
      if (this.accessEpoch) this.callbacks.onReady(message.port, this.accessEpoch);
      return;
    }
    if (message.type === 'fatal') {
      this.callbacks.onFatal(message.message);
      return;
    }
    if (message.type === 'session-count') {
      this.callbacks.onSessionCount(message.count);
      return;
    }
    if (message.type === 'session-closed') {
      this.readService?.closeSession(message.sessionId);
      return;
    }
    if (message.type === 'activity') {
      this.callbacks.onActivity(message.activity);
      return;
    }
    if (message.type !== 'read-request') return;
    const service = this.readService;
    const child = this.child;
    if (!service || !child || !this.accessEpoch || !this.journalInstanceId) return;
    try {
      const response = await service.execute(
        {
          journalInstanceId: this.journalInstanceId,
          accessEpoch: this.accessEpoch,
          sessionId: message.sessionId,
          snapshotAt: new Date().toISOString(),
        },
        message.request,
      );
      child.postMessage({ type: 'read-result', requestId: message.requestId, ok: true, response } satisfies AiMainToCompanionMessage);
      this.callbacks.onActivity({
        at: new Date().toISOString(),
        client: message.client,
        operation: message.request.op,
        outcome: 'ok',
      });
    } catch (error) {
      console.error('[ai-read]', error);
      child.postMessage({
        type: 'read-result',
        requestId: message.requestId,
        ok: false,
        error: toAiReadError(error),
      } satisfies AiMainToCompanionMessage);
      this.callbacks.onActivity({
        at: new Date().toISOString(),
        client: message.client,
        operation: message.request.op,
        outcome: 'error',
      });
    }
  }

  private onExit(code: number): void {
    const unexpected = !this.stopping;
    this.child = null;
    this.closeReadService();
    if (unexpected) this.callbacks.onFatal(`AI companion exited with code ${code}`);
  }

  private closeReadService(): void {
    this.readService?.close();
    this.readService = null;
    this.accessEpoch = null;
    this.journalInstanceId = null;
  }
}

function companionEnvironment(bootConfig: string): NodeJS.ProcessEnv {
  const allowed = [
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'PATH',
    'PATHEXT',
    'ComSpec',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'NODE_ENV',
  ];
  const environment: NodeJS.ProcessEnv = { TJ_AI_BOOT_CONFIG: bootConfig };
  for (const name of allowed) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}
