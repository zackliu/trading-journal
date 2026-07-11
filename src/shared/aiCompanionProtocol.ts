import type { AiAccessActivity, AiPromptTemplate, JournalReadRequest, JournalReadResponse } from './aiAccess';

export interface AiCompanionBootConfig {
  port: number;
  accessKey: string;
  accessEpoch: string;
  journalInstanceId: string;
  appVersion: string;
  guide: string;
  prompts: AiPromptTemplate[];
}

export type AiCompanionToMainMessage =
  | { type: 'ready'; port: number }
  | { type: 'stopped' }
  | { type: 'fatal'; message: string }
  | { type: 'session-count'; count: number }
  | { type: 'session-closed'; sessionId: string }
  | { type: 'activity'; activity: AiAccessActivity }
  | {
      type: 'read-request';
      requestId: string;
      sessionId: string;
      client: string;
      request: JournalReadRequest;
    };

export type AiMainToCompanionMessage =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'read-result'; requestId: string; ok: true; response: JournalReadResponse }
  | { type: 'read-result'; requestId: string; ok: false; error: string };