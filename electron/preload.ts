import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc.js'
import type {
  ExportOptions,
  FavoriteRow,
  FileRow,
  FileTouchRow,
  IndexProgress,
  PlanListRow,
  ProjectRow,
  RecentSessionRow,
  ReindexResult,
  SearchFilters,
  SessionMessageRow,
  StatsPayload,
  TagRow,
  TemplateRow,
  UpdateStatus,
  UnifiedSearchHit,
} from '../shared/ipc.js'

contextBridge.exposeInMainWorld('vault', {
  projectsList: (): Promise<ProjectRow[]> => ipcRenderer.invoke(IPC.projectsList),
  search: (filters: SearchFilters): Promise<UnifiedSearchHit[]> => ipcRenderer.invoke(IPC.search, filters),
  plansList: (): Promise<PlanListRow[]> => ipcRenderer.invoke(IPC.plansList),
  planBody: (planId: number): Promise<string> => ipcRenderer.invoke(IPC.planBody, planId),
  reindex: (): Promise<ReindexResult> => ipcRenderer.invoke(IPC.reindex),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.copyText, text),
  favoritesList: (): Promise<FavoriteRow[]> => ipcRenderer.invoke(IPC.favoritesList),
  favoriteAdd: (messageId: number): Promise<void> => ipcRenderer.invoke(IPC.favoriteAdd, messageId),
  favoriteRemove: (messageId: number): Promise<void> => ipcRenderer.invoke(IPC.favoriteRemove, messageId),
  tagsList: (): Promise<TagRow[]> => ipcRenderer.invoke(IPC.tagsList),
  tagCreate: (name: string, color?: string | null): Promise<number> =>
    ipcRenderer.invoke(IPC.tagCreate, name, color ?? null),
  messageTagsSet: (messageId: number, tagIds: number[]): Promise<void> =>
    ipcRenderer.invoke(IPC.messageTagsSet, messageId, tagIds),
  stats: (): Promise<StatsPayload> => ipcRenderer.invoke(IPC.stats),
  exportMessages: (messageIds: number[], format: 'md' | 'csv', opts?: ExportOptions): Promise<string> =>
    ipcRenderer.invoke(IPC.exportMessages, messageIds, format, opts ?? {}),
  messageTagsGet: (messageId: number): Promise<number[]> => ipcRenderer.invoke(IPC.messageTagsGet, messageId),
  sessionTranscript: (sessionId: number): Promise<SessionMessageRow[]> =>
    ipcRenderer.invoke(IPC.sessionTranscript, sessionId),
  recentSessions: (projectId?: number | null): Promise<RecentSessionRow[]> =>
    ipcRenderer.invoke(IPC.recentSessions, projectId ?? null),
  templatesList: (): Promise<TemplateRow[]> => ipcRenderer.invoke(IPC.templatesList),
  templateCreate: (name: string, body: string): Promise<number> =>
    ipcRenderer.invoke(IPC.templateCreate, name, body),
  templateUpdate: (id: number, name: string, body: string): Promise<void> =>
    ipcRenderer.invoke(IPC.templateUpdate, id, name, body),
  templateDelete: (id: number): Promise<void> => ipcRenderer.invoke(IPC.templateDelete, id),
  filesList: (query: string): Promise<FileRow[]> => ipcRenderer.invoke(IPC.filesList, query),
  fileTimeline: (path: string): Promise<FileTouchRow[]> => ipcRenderer.invoke(IPC.fileTimeline, path),
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
