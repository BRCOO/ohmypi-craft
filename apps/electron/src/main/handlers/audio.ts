/**
 * Audio handlers — speech-to-text transcription via OMP session command.
 *
 * The renderer captures microphone audio via Web APIs, then sends the
 * audio data to this handler which validates size limits, saves a temp
 * file, and sends the `transcribeAudio` session command through the
 * SessionManager.
 */

import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'

const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024 // 10 MiB
const MAX_AUDIO_DURATION_SECONDS = 120 // 2 minutes

export function registerAudioHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps

  server.handle(RPC_CHANNELS.audio.TRANSCRIBE, async (
    _ctx,
    sessionId: string,
    audioData: string,
    mimeType: string,
    maxDurationSeconds?: number,
  ): Promise<{ text: string }> => {
    // Validate params
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('sessionId is required')
    }
    if (!audioData || typeof audioData !== 'string') {
      throw new Error('audioData is required (base64-encoded)')
    }
    if (!mimeType || typeof mimeType !== 'string') {
      throw new Error('mimeType is required')
    }

    // Validate size
    const rawLength = Buffer.byteLength(audioData, 'base64')
    if (rawLength > MAX_AUDIO_SIZE_BYTES) {
      throw new Error(`Audio data exceeds maximum size of ${MAX_AUDIO_SIZE_BYTES / 1024 / 1024} MiB`)
    }

    // Validate duration
    const duration = maxDurationSeconds ?? MAX_AUDIO_DURATION_SECONDS
    if (duration > MAX_AUDIO_DURATION_SECONDS) {
      throw new Error(`Audio duration exceeds maximum of ${MAX_AUDIO_DURATION_SECONDS}s`)
    }

    // Write audio to a temp file
    const ext = mimeTypeToExtension(mimeType)
    const tmpFile = join(tmpdir(), `omp-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)

    try {
      const buffer = Buffer.from(audioData, 'base64')
      await writeFile(tmpFile, buffer)

      // Ensure session manager is ready
      await sessionManager.waitForInit()

      // Send the transcribe_audio command via session manager
      const result = await sessionManager.sendRawOmpCommand(sessionId, {
        type: 'transcribe_audio',
        audioData,
        mimeType,
        maxDurationSeconds: duration,
      })

      // The result should contain a transcription text field
      const transcription = extractTranscription(result)
      if (!transcription) {
        throw new Error('Transcription failed: no text in response')
      }

      return { text: transcription }
    } finally {
      // Clean up temp file — fire-and-forget
      unlink(tmpFile).catch(() => {
        // Temp file cleanup is best-effort
      })
    }
  })
}

/**
 * Extract transcription text from an OMP command result.
 */
function extractTranscription(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null

  const obj = result as Record<string, unknown>

  // The response might come in different shapes depending on the OMP backend
  if (typeof obj.text === 'string' && obj.text.length > 0) {
    return obj.text
  }
  if (typeof obj.transcription === 'string' && obj.transcription.length > 0) {
    return obj.transcription
  }
  if (typeof obj.result === 'string' && obj.result.length > 0) {
    return obj.result
  }

  return null
}

/**
 * Map MIME type to a file extension for the temp file.
 */
function mimeTypeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/webm;codecs=opus': 'webm',
    'audio/ogg': 'ogg',
    'audio/ogg;codecs=opus': 'ogg',
    'audio/wav': 'wav',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/flac': 'flac',
  }
  return map[mimeType] ?? 'webm'
}
