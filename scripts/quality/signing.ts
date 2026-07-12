/**
 * Windows code-signing status for release reports.
 *
 * Production builds sign when CSC_LINK / WIN_CSC_LINK (or CSC_NAME) is present.
 * Local builds without credentials remain intentionally unsigned.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

export type CodeSigningStatus = 'signed' | 'unsigned' | 'unknown'

export interface CodeSigningInfo {
  status: CodeSigningStatus
  /** Human-readable reason / publisher subject when available. */
  detail?: string
  /** Whether signing credentials were detected in the environment for this build. */
  credentialsPresent: boolean
}

export function hasWindowsSigningCredentials(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const link = env.WIN_CSC_LINK || env.CSC_LINK
  const name = env.CSC_NAME
  if (name && name.trim()) return true
  if (!link || !link.trim()) return false
  // File path or base64 PFX blob both count as present credentials.
  if (link.includes('BEGIN') || link.length > 200) return true
  return existsSync(link)
}

/**
 * Probe Authenticode status of a Windows PE file.
 * Uses PowerShell Get-AuthenticodeSignature when available.
 */
export function probeWindowsSignature(exePath: string): CodeSigningInfo {
  const credentialsPresent = hasWindowsSigningCredentials()

  if (process.platform !== 'win32') {
    return {
      status: 'unknown',
      detail: 'Signature probe only runs on Windows',
      credentialsPresent,
    }
  }

  if (!existsSync(exePath)) {
    return {
      status: 'unknown',
      detail: 'Installer path missing for signature probe',
      credentialsPresent,
    }
  }

  const ps = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$s = Get-AuthenticodeSignature -FilePath ${JSON.stringify(exePath)}; ` +
        `Write-Output ($s.Status.ToString() + '|' + ($s.SignerCertificate.Subject ?? ''))`,
    ],
    { encoding: 'utf-8', windowsHide: true, timeout: 30_000 },
  )

  if (ps.status !== 0) {
    return {
      status: credentialsPresent ? 'unknown' : 'unsigned',
      detail: ps.stderr?.trim() || 'Get-AuthenticodeSignature failed',
      credentialsPresent,
    }
  }

  const line = (ps.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).at(-1) ?? ''
  const [statusRaw, subject = ''] = line.split('|')
  const statusText = (statusRaw ?? '').trim().toLowerCase()

  if (statusText === 'valid') {
    return {
      status: 'signed',
      detail: subject.trim() || 'Authenticode Valid',
      credentialsPresent,
    }
  }

  if (statusText === 'notsigned' || statusText === 'not signed') {
    return {
      status: 'unsigned',
      detail: credentialsPresent
        ? 'Credentials present but installer is not signed'
        : 'Local unsigned build (no CSC_LINK / WIN_CSC_LINK / CSC_NAME)',
      credentialsPresent,
    }
  }

  return {
    status: 'unknown',
    detail: `Authenticode status: ${statusRaw || 'unknown'}${subject ? ` (${subject.trim()})` : ''}`,
    credentialsPresent,
  }
}
