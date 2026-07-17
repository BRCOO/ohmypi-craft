/**
 * SttButton — Speech-to-text microphone button for the input toolbar.
 *
 * Renderer-side flow:
 * 1. Requests microphone permission via `navigator.mediaDevices.getUserMedia`
 * 2. Records audio via `MediaRecorder` (WebM/opus)
 * 3. On stop, sends the recorded blob (base64) to the Electron main process
 *    via `window.electronAPI.transcribeAudio`
 * 4. On success, emits a `craft:insert-text` event so the caller-agnostic
 *    listener in FreeFormInput inserts the transcription into the composer
 *
 * All file lifecycle and size validation is handled by the main process handler.
 */
import * as React from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'
import { useOmpCapabilities } from '@/hooks/useOmpCapabilities'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { cn } from '@/lib/utils'

interface SttButtonProps {
  sessionId?: string
  disabled?: boolean
}

type SttState = 'idle' | 'requesting-permission' | 'recording' | 'transcribing' | 'error' | 'unsupported'

const RECORDING_CHUNK_INTERVAL_MS = 250

export function SttButton({ sessionId, disabled }: SttButtonProps): React.ReactElement {
  const { loading: capsLoading, isFeatureSupported } = useOmpCapabilities(sessionId)
  const [state, setState] = React.useState<SttState>('idle')
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<Blob[]>([])

  // Detect whether MediaRecorder is available at all
  const isApiSupported = typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof MediaRecorder !== 'undefined'

  const featureSupported = !capsLoading && isFeatureSupported('audio.stt')
  const canRecord = featureSupported && isApiSupported && !disabled

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      stopRecording()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function stopRecording(): void {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch {
        // Already stopping
      }
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop()
      }
      streamRef.current = null
    }
  }

  const handleClick = React.useCallback(async () => {
    if (state === 'recording') {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      return
    }

    if (state === 'transcribing') return // Already processing

    setState('requesting-permission')
    setErrorMessage(null)

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Determine supported MIME type
      const mimeType = getSupportedMimeType()
      chunksRef.current = []

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        setState('transcribing')

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const buffer = await blob.arrayBuffer()
        const base64 = arrayBufferToBase64(buffer)

        try {
          if (!sessionId) {
            throw new Error('No session selected')
          }

          const result = await window.electronAPI.transcribeAudio(
            sessionId,
            base64,
            recorder.mimeType || 'audio/webm',
            120, // max duration seconds
          )

          if (result && result.text) {
            // Dispatch insert-text event so FreeFormInput picks it up
            window.dispatchEvent(
              new CustomEvent('craft:insert-text', {
                detail: { text: result.text, sessionId },
              }),
            )
          }

          setState('idle')
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          setErrorMessage(message)
          setState('error')
        }

        // Clean up stream
        for (const track of stream.getTracks()) {
          track.stop()
        }
        streamRef.current = null
        mediaRecorderRef.current = null
      }

      recorder.onerror = () => {
        setErrorMessage('Recording error')
        setState('error')
        for (const track of stream.getTracks()) {
          track.stop()
        }
        streamRef.current = null
      }

      // Start recording with time slices for progress
      recorder.start(RECORDING_CHUNK_INTERVAL_MS)
      setState('recording')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Handle permission denied specifically
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setErrorMessage('Microphone access denied. Please allow microphone access in system settings.')
      } else {
        setErrorMessage(message)
      }
      setState('error')
    }
  }, [state, sessionId])

  const handleDismissError = React.useCallback(() => {
    setState('idle')
    setErrorMessage(null)
  }, [])

  // Not supported — render nothing
  if (!canRecord && state === 'idle' && !capsLoading) {
    return <></>
  }

  const isLoading = state === 'requesting-permission' || state === 'transcribing'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled || isLoading}
          aria-label={getAriaLabel(state, errorMessage)}
          className={cn(
            'inline-flex items-center h-7 w-7 justify-center rounded-[6px] transition-colors select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            state === 'recording'
              ? 'bg-destructive/15 text-destructive hover:bg-destructive/20'
              : state === 'error'
                ? 'bg-warning/10 text-warning hover:bg-warning/15'
                : 'hover:bg-foreground/5 text-muted-foreground hover:text-foreground',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
          onClick={handleClick}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : state === 'recording' ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {state === 'idle' && (capsLoading ? 'Checking capability...' : 'Speech-to-text')}
        {state === 'requesting-permission' && 'Requesting microphone...'}
        {state === 'recording' && 'Recording — click to stop'}
        {state === 'transcribing' && 'Transcribing...'}
        {state === 'error' && (errorMessage ?? 'Transcription failed')}
      </TooltipContent>
    </Tooltip>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getAriaLabel(state: SttState, errorMessage: string | null): string {
  switch (state) {
    case 'idle':
      return 'Start speech-to-text recording'
    case 'requesting-permission':
      return 'Requesting microphone permission'
    case 'recording':
      return 'Recording — click to stop'
    case 'transcribing':
      return 'Transcribing audio'
    case 'error':
      return `Transcription error: ${errorMessage ?? 'Unknown error'}`
    case 'unsupported':
      return 'Speech-to-text not supported'
  }
}

/**
 * Detect the best supported audio MIME type.
 */
function getSupportedMimeType(): string | undefined {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }
  return undefined
}

/**
 * Convert ArrayBuffer to base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
