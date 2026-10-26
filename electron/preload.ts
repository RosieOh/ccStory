import { contextBridge, ipcRenderer } from 'electron'
import type { ModelPrice } from '../shared/pricing.js'
import { IPC } from '../shared/ipc.js'
import type {
  BackupInfo,
  BackupResult,
  ExportOptions,
  ExportSaveResult,
  FavoriteRow,
  FileRow,
  FileTouchRow,
  IndexProgress,
  PlanListRow,
  ProjectRow,
  PromptQuery,
  PromptRow,
  RecentSessionRow,
  ReindexResult,
  RestoreResult,
  SearchFilters,
  SessionInfo,
  SessionMessageRow,
  Settings,
  SettingsInfo,
  StatsPayload,
  TagRow,
  TemplateRow,
  UpdateStatus,
  UnifiedSearchHit,
} from '../shared/ipc.js'

contextBridge.exposeInMainWorld('vault', {
  projectsList: (): Promise<ProjectRow[]> => ipcRenderer.invoke(IPC.projectsList),
  search: (filters: SearchFilters): Promise<UnifiedSearchHit[] | null> => ipcRenderer.invoke(IPC.search, filters),
  plansList: (): Promise<PlanListRow[]> => ipcRenderer.invoke(IPC.plansList),
  planBody: (planId: number): Promise<string> => ipcRenderer.invoke(IPC.planBody, planId),
  reindex: (reparse?: boolean): Promise<ReindexResult> => ipcRenderer.invoke(IPC.reindex, reparse === true),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.copyText, text),
  messageBody: (messageId: number): Promise<string> => ipcRenderer.invoke(IPC.messageBody, messageId),
  favoritesList: (): Promise<FavoriteRow[]> => ipcRenderer.invoke(IPC.favoritesList),
  favoriteAdd: (messageId: number): Promise<void> => ipcRenderer.invoke(IPC.favoriteAdd, messageId),
  favoriteRemove: (msgKey: string): Promise<void> => ipcRenderer.invoke(IPC.favoriteRemove, msgKey),
  tagsList: (): Promise<TagRow[]> => ipcRenderer.invoke(IPC.tagsList),
  tagCreate: (name: string, color?: string | null): Promise<number> =>
    ipcRenderer.invoke(IPC.tagCreate, name, color ?? null),
  tagRename: (id: number, name: string): Promise<boolean> => ipcRenderer.invoke(IPC.tagRename, id, name),
  tagDelete: (id: number): Promise<void> => ipcRenderer.invoke(IPC.tagDelete, id),
  messageTagsSet: (msgKey: string, tagIds: number[]): Promise<void> =>
    ipcRenderer.invoke(IPC.messageTagsSet, msgKey, tagIds),
  stats: (): Promise<StatsPayload> => ipcRenderer.invoke(IPC.stats),
  exportMessages: (messageIds: number[], format: 'md' | 'csv', opts?: ExportOptions): Promise<string> =>
    ipcRenderer.invoke(IPC.exportMessages, messageIds, format, opts ?? {}),
  exportSave: (text: string, format: 'md' | 'csv'): Promise<ExportSaveResult> =>
    ipcRenderer.invoke(IPC.exportSave, text, format),
  sessionTranscript: (sessionId: number): Promise<SessionMessageRow[]> =>
    ipcRenderer.invoke(IPC.sessionTranscript, sessionId),
  sessionInfo: (sessionId: number): Promise<SessionInfo | null> => ipcRenderer.invoke(IPC.sessionInfo, sessionId),
  recentSessions: (projectId?: number | null): Promise<RecentSessionRow[]> =>
    ipcRenderer.invoke(IPC.recentSessions, projectId ?? null),
  promptsList: (q: PromptQuery): Promise<PromptRow[]> => ipcRenderer.invoke(IPC.promptsList, q),
  pricesList: (): Promise<ModelPrice[]> => ipcRenderer.invoke(IPC.pricesList),
  pricesSave: (prices: ModelPrice[]): Promise<ModelPrice[]> =>
    ipcRenderer.invoke(IPC.pricesSave, prices),
  pricesReset: (): Promise<ModelPrice[]> => ipcRenderer.invoke(IPC.pricesReset),
  templatesList: (): Promise<TemplateRow[]> => ipcRenderer.invoke(IPC.templatesList),
  templateCreate: (name: string, body: string): Promise<number> =>
    ipcRenderer.invoke(IPC.templateCreate, name, body),
  templateUpdate: (id: number, name: string, body: string): Promise<void> =>
    ipcRenderer.invoke(IPC.templateUpdate, id, name, body),
  templateDelete: (id: number): Promise<void> => ipcRenderer.invoke(IPC.templateDelete, id),
  filesList: (query: string): Promise<FileRow[]> => ipcRenderer.invoke(IPC.filesList, query),
  fileTimeline: (path: string): Promise<FileTouchRow[]> => ipcRenderer.invoke(IPC.fileTimeline, path),
  settingsGet: (): Promise<SettingsInfo> => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch),
  archivePurge: (): Promise<number> => ipcRenderer.invoke(IPC.archivePurge),
  backupsList: (): Promise<BackupInfo> => ipcRenderer.invoke(IPC.backupsList),
  backupCreate: (): Promise<BackupResult> => ipcRenderer.invoke(IPC.backupCreate),
  backupRestore: (name: string): Promise<RestoreResult> => ipcRenderer.invoke(IPC.backupRestore, name),
  backupsReveal: (): Promise<void> => ipcRenderer.invoke(IPC.backupsReveal),
  updateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateStatus),
  updateCheck: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateCheck),
  updateInstall: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
  onUpdateStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, s: UpdateStatus): void => cb(s)
    ipcRenderer.on(IPC.onUpdateStatus, listener)
    return () => ipcRenderer.removeListener(IPC.onUpdateStatus, listener)
  },
  onIndexUpdated: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.onIndexUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.onIndexUpdated, listener)
  },
  onIndexProgress: (cb: (p: IndexProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: IndexProgress): void => cb(p)
    ipcRenderer.on(IPC.onIndexProgress, listener)
    return () => ipcRenderer.removeListener(IPC.onIndexProgress, listener)
  },
})
