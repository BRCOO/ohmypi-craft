/**
 * OMP v16 CLI surface mirrored from the upstream command registry.
 *
 * This is intentionally metadata only. Execution remains delegated to the
 * official OMP runtime so command behavior, flags, authentication, and future
 * upstream additions do not diverge from the source CLI.
 */

export interface OmpCliCommandSpec {
  name: string
  description: string
  category: 'session' | 'runtime' | 'config' | 'diagnostic' | 'integration'
  desktopEquivalent?: string
}

export const OMP_CLI_COMMANDS: readonly OmpCliCommandSpec[] = [
  { name: 'acp', description: 'Run OMP as an Agent Client Protocol server over stdio', category: 'integration' },
  { name: 'agents', description: 'Manage bundled task agents', category: 'runtime', desktopEquivalent: 'OMP Feature Center / Agents' },
  { name: 'auth-broker', description: 'Manage the OMP auth-broker credential vault', category: 'integration' },
  { name: 'auth-gateway', description: 'Run an auth-gateway forward proxy', category: 'integration' },
  { name: 'bench', description: 'Benchmark models with the same prompt', category: 'diagnostic' },
  { name: 'commit', description: 'Generate a commit message and update changelogs', category: 'session', desktopEquivalent: 'Slash command /commit' },
  { name: 'completions', description: 'Print shell completion scripts', category: 'config' },
  { name: 'config', description: 'Manage OMP configuration settings', category: 'config', desktopEquivalent: 'OMP Settings / Feature Center' },
  { name: 'dry-balance', description: 'Dry-run OAuth account balancing', category: 'diagnostic' },
  { name: 'gallery', description: 'Preview tool renderers', category: 'diagnostic' },
  { name: 'gc', description: 'Run storage garbage collection', category: 'runtime' },
  { name: 'grep', description: 'Test the grep tool', category: 'diagnostic' },
  { name: 'grievances', description: 'View, clean, or push reported tool issues', category: 'diagnostic' },
  { name: 'install', description: 'Install or link an extension package', category: 'integration', desktopEquivalent: 'OMP Feature Center / Skills and extensions' },
  { name: 'join', description: 'Join a shared collaboration session', category: 'session', desktopEquivalent: 'Collaboration session UI' },
  { name: 'models', description: 'List, search, and refresh available models', category: 'runtime', desktopEquivalent: 'Model picker / OMP Feature Center' },
  { name: 'plugin', description: 'Manage plugins', category: 'integration', desktopEquivalent: 'OMP Feature Center / extensions' },
  { name: 'read', description: 'Show what the read tool returns', category: 'runtime', desktopEquivalent: 'Built-in read tool' },
  { name: 'say', description: 'Synthesize text with the local TTS engine', category: 'integration' },
  { name: 'search', description: 'Test web search providers', category: 'diagnostic', desktopEquivalent: 'Built-in web_search tool' },
  { name: 'setup', description: 'Run onboarding or install optional dependencies', category: 'config', desktopEquivalent: 'Desktop onboarding / settings' },
  { name: 'shell', description: 'Open the interactive shell console', category: 'runtime' },
  { name: 'ssh', description: 'Manage SSH host configurations', category: 'integration', desktopEquivalent: 'Built-in ssh tool' },
  { name: 'stats', description: 'View usage statistics', category: 'diagnostic', desktopEquivalent: 'Session statistics RPC' },
  { name: 'tiny-models', description: 'Download tiny local models', category: 'runtime' },
  { name: 'token', description: 'Get an API key or OAuth token', category: 'integration', desktopEquivalent: 'Login and credential UI' },
  { name: 'ttsr', description: 'Inspect and test Time-Traveling Stream Rules', category: 'diagnostic' },
  { name: 'update', description: 'Check for and install OMP updates', category: 'config' },
  { name: 'usage', description: 'Show provider usage limits', category: 'diagnostic', desktopEquivalent: 'Provider usage UI' },
  { name: 'worktree', description: 'List or clear agent-managed git worktrees', category: 'runtime' },
] as const

export const OMP_CLI_GLOBAL_FLAGS = [
  '--model', '--smol', '--slow', '--plan', '--provider', '--api-key', '--system-prompt',
  '--append-system-prompt', '--allow-home', '--profile', '--alias', '--cwd', '--mode',
  '--config', '--print', '--continue', '--resume', '--session-dir', '--no-session',
  '--models', '--no-tools', '--no-lsp', '--no-pty', '--tools', '--thinking', '--hide-thinking',
  '--advisor', '--hook', '--extension', '--no-extensions', '--no-skills', '--skills',
  '--no-rules', '--export', '--no-title', '--print-thoughts', '--max-time', '--auto-approve',
  '--approval-mode',
] as const

export function findOmpCliCommand(name: string): OmpCliCommandSpec | undefined {
  return OMP_CLI_COMMANDS.find(command => command.name === name)
}

export function getOmpCliManifest(): {
  runtime: string
  commands: readonly OmpCliCommandSpec[]
  globalFlags: readonly string[]
} {
  return {
    runtime: 'upstream-omp',
    commands: OMP_CLI_COMMANDS,
    globalFlags: OMP_CLI_GLOBAL_FLAGS,
  }
}
