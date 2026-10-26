import crypto from 'node:crypto'
import fs from 'node:fs'

/** One line of a file and the byte offset just past it (past the `\n`). */
export type FileLine = {
  text: string
  end: number
  /** True for trailing bytes with no `\n` yet — possibly a line still being written. */
  partial: boolean
}

const NL = 0x0a

/**
 * Reads a file line by line from a byte offset in fixed-size chunks, so a 400 MB
 * transcript never has to sit in memory as one string. Splitting on the `\n` byte is
 * safe for UTF-8: 0x0A never occurs inside a multi-byte sequence.
 */
export function* readLines(filePath: string, start = 0, chunkSize = 4 << 20): Generator<FileLine> {
  const fd = fs.openSync(filePath, 'r')
  try {
    const chunk = Buffer.allocUnsafe(chunkSize)
    let pending: Buffer[] = []
    let pendingLen = 0
    let pos = start
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunkSize, pos)
      if (n <= 0) break
      let from = 0
      for (;;) {
        const nl = chunk.indexOf(NL, from)
        if (nl < 0 || nl >= n) break
        const piece = chunk.subarray(from, nl)
        const buf = pendingLen ? Buffer.concat([...pending, piece], pendingLen + piece.length) : piece
        pending = []
        pendingLen = 0
        let text = buf.toString('utf8')
        if (text.endsWith('\r')) text = text.slice(0, -1)
        yield { text, end: pos + nl + 1, partial: false }
        from = nl + 1
      }
      if (from < n) {
        // Copy: `chunk` is reused by the next read.
        pending.push(Buffer.from(chunk.subarray(from, n)))
        pendingLen += n - from
      }
      pos += n
    }
    if (pendingLen) {
      yield { text: Buffer.concat(pending, pendingLen).toString('utf8'), end: pos, partial: true }
    }
  } finally {
    fs.closeSync(fd)
  }
}

const HEAD_BYTES = 4096
const TAIL_BYTES = 256

function hashRange(fd: number, from: number, len: number): string {
  const buf = Buffer.alloc(len)
  const n = len > 0 ? fs.readSync(fd, buf, 0, len, from) : 0
  return crypto.createHash('sha1').update(buf.subarray(0, n)).digest('hex')
}

/**
 * Fingerprints used to decide whether a file has only been appended to since it was
 * indexed up to `offset`: its first bytes and the bytes just before `offset` must be
 * unchanged.
 */
export function fingerprint(filePath: string, offset: number): { head: string; tail: string } {
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = hashRange(fd, 0, Math.min(HEAD_BYTES, offset))
    const tailFrom = Math.max(0, offset - TAIL_BYTES)
    const tail = hashRange(fd, tailFrom, offset - tailFrom)
    return { head, tail }
  } finally {
    fs.closeSync(fd)
  }
}

/** Reads the first line of a file (bounded), e.g. a Codex `session_meta` record. */
export function readFirstLine(filePath: string, maxBytes = 1 << 20): string | null {
  for (const line of readLines(filePath, 0, 64 << 10)) {
    if (line.end > maxBytes) return null
    return line.text
  }
  return null
}
