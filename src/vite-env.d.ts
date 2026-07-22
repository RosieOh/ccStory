/// <reference types="vite/client" />

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
} from '../shared/ipc'

export type VaultApi = {
  projectsList: () => Promise<ProjectRow[]>
  search: (filters: SearchFilters) => Promise<UnifiedSearchHit[]>
  plansList: () => Promise<PlanListRow[]>
  planBody: (planId: number) => Promise<string>
  reindex: () => Promise<ReindexResult>
  copyText: (text: string) => Promise<void>
  favoritesList: () => Promise<FavoriteRow[]>
  favoriteAdd: (messageId: number) => Promise<void>
  favoriteRemove: (messageId: number) => Promise<void>
  tagsList: () => Promise<TagRow[]>
  tagCreate: (name: string, color?: string | null) => Promise<number>
  messageTagsSet: (messageId: number, tagIds: number[]) => Promise<void>
  messageTagsGet: (messageId: number) => Promise<number[]>
  stats: () => Promise<StatsPayload>
  exportMessages: (messageIds: number[], format: 'md' | 'csv', opts?: ExportOptions) => Promise<string>
  sessionTranscript: (sessionId: number) => Promise<SessionMessageRow[]>
  recentSessions: (projectId?: number | null) => Promise<RecentSessionRow[]>
  pricesList: () => Promise<ModelPrice[]>
  pricesSave: (prices: ModelPrice[]) => Promise<ModelPrice[]>
  pricesReset: () => Promise<ModelPrice[]>
  templatesList: () => Promise<TemplateRow[]>
  templateCreate: (name: string, body: string) => Promise<number>
  templateUpdate: (id: number, name: string, body: string) => Promise<void>
  templateDelete: (id: number) => Promise<void>
  filesList: (query: string) => Promise<FileRow[]>
  fileTimeline: (path: string) => Promise<FileTouchRow[]>
  updateStatus: () => Promise<UpdateStatus>
  updateCheck: () => Promise<UpdateStatus>
  updateInstall: () => Promise<void>
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => () => void
  onIndexUpdated: (cb: () => void) => () => void
  onIndexProgress: (cb: (p: IndexProgress) => void) => () => void
}

declare global {
  interface Window {
    vault: VaultApi
  }
}
