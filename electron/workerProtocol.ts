import type { IndexProgress, ReindexResult } from '../shared/ipc.js'

/** Messages between the main process (`indexService`) and the index worker. */
export type WatchEventKind = 'add' | 'change' | 'unlink'

export type WorkerInbound =
  | { type: 'scan'; id: number; reparse?: boolean }
  | { type: 'paths'; events: { path: string; kind: WatchEventKind }[] }
  | { type: 'close' }

export type WorkerOutbound =
  | { type: 'ready' }
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'updated' }
  | { type: 'done'; id: number; result: ReindexResult }
  | { type: 'error'; id?: number; message: string }
  | { type: 'log'; message: string }
