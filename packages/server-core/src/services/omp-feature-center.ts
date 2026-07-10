import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { dump as dumpYaml, load as loadYaml } from 'js-yaml'
import type {
  OmpDiagnosticsSummary,
  OmpFeatureAdvisorRosterDto,
  OmpFeatureAdvisorRosterEditableDto,
  OmpFeatureCapabilityDto,
  OmpFeatureCapabilityItemDto,
  OmpFeatureCenterStateDto,
  OmpFeatureConfigPathDto,
  OmpFeatureUnavailableCommandDto,
  OmpFeatureModelRoleDto,
  OmpFeaturePathLevel,
  OmpFeatureValueSource,
  OmpRuntimeStatus,
  SaveOmpFeatureCenterConfigInput,
  SaveOmpFeatureCenterConfigResult,
} from '@craft-agent/shared/protocol'

type RawConfig = Record<string, unknown>

export interface OmpFeatureCenterOptions {
  diagnostics: OmpDiagnosticsSummary
  workspaceRootPath?: string
  projectRootPath?: string
  homeDir?: string
  agentDir?: string
  now?: () => number
}

const COMMON_MODEL_ROLES = ['default', 'smol', 'slow', 'plan', 'task', 'advisor'] as const

const BUILT_IN_MODEL_ROLES: Array<{ role: string; label: string }> = [
  { role: 'default', label: 'Default' },
  { role: 'smol', label: 'Fast' },
  { role: 'slow', label: 'Thinking' },
  { role: 'vision', label: 'Vision' },
  { role: 'plan', label: 'Architect' },
  { role: 'designer', label: 'Designer' },
  { role: 'commit', label: 'Commit' },
  { role: 'tiny', label: 'Tiny' },
  { role: 'task', label: 'Subtask' },
  { role: 'advisor', label: 'Advisor' },
]

const UNAVAILABLE_TUI_COMMANDS: OmpFeatureUnavailableCommandDto[] = [
  {
    command: '/plan',
    label: 'Native Plan Mode',
    status: 'needs-upstream-rpc',
    reason: 'Current OMP RPC exposes no plan-mode toggle, state, or review command.',
    alternative: 'Configure modelRoles.plan here; use Craft plan approval if OMP emits an extension UI request.',
  },
  {
    command: '/plan-review',
    label: 'Reopen Plan Review',
    status: 'needs-upstream-rpc',
    reason: 'Plan review reopening is currently TUI/ACP-only in upstream OMP.',
  },
  {
    command: '/goal',
    label: 'Goal Mode',
    status: 'needs-upstream-rpc',
    reason: 'Goal runtime state and set/pause/resume/drop commands are not present in OMP RPC.',
  },
  {
    command: '/guided-goal',
    label: 'Guided Goal',
    status: 'needs-upstream-rpc',
    reason: 'Guided goal interview state is not exposed through OMP RPC.',
  },
  {
    command: '/loop',
    label: 'Loop Mode',
    status: 'needs-upstream-rpc',
    reason: 'Loop repeat controls and stop state are not exposed through OMP RPC.',
  },
  {
    command: '/advisor configure',
    label: 'Advisor Configure',
    status: 'desktop-equivalent',
    reason: 'Interactive TUI configuration is replaced by this Feature Center WATCHDOG.yml editor.',
    alternative: 'Edit the global WATCHDOG.yml roster in Settings > OMP.',
  },
]

interface ReadConfigResult {
  path: string
  exists: boolean
  parseError?: string
  data: RawConfig
}

function isRecord(value: unknown): value is RawConfig {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readYamlConfig(filePath: string): Promise<ReadConfigResult> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path: filePath, exists: false, data: {} }
    }
    return {
      path: filePath,
      exists: false,
      parseError: error instanceof Error ? error.message : String(error),
      data: {},
    }
  }

  try {
    const parsed = loadYaml(content)
    if (parsed === null || parsed === undefined) {
      return { path: filePath, exists: true, data: {} }
    }
    if (!isRecord(parsed)) {
      return { path: filePath, exists: true, parseError: 'YAML document must be a mapping.', data: {} }
    }
    return { path: filePath, exists: true, data: parsed }
  } catch (error) {
    return {
      path: filePath,
      exists: true,
      parseError: error instanceof Error ? error.message : String(error),
      data: {},
    }
  }
}

function toPathDto(config: ReadConfigResult): OmpFeatureConfigPathDto {
  return {
    path: config.path,
    exists: config.exists,
    parseError: config.parseError,
  }
}

function getRecordValue(root: RawConfig, key: string): RawConfig {
  const value = root[key]
  return isRecord(value) ? value : {}
}

function getStringValue(root: RawConfig, path: string[]): string | undefined {
  let current: unknown = root
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return typeof current === 'string' ? current : undefined
}

function getBooleanValue(root: RawConfig, path: string[]): boolean | undefined {
  let current: unknown = root
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return typeof current === 'boolean' ? current : undefined
}

function setNestedValue(root: RawConfig, path: string[], value: unknown): void {
  let current: RawConfig = root
  for (const segment of path.slice(0, -1)) {
    const next = current[segment]
    if (!isRecord(next)) {
      current[segment] = {}
    }
    current = current[segment] as RawConfig
  }
  const finalKey = path[path.length - 1]
  if (value === undefined) {
    delete current[finalKey]
  } else {
    current[finalKey] = value
  }
}

function resolveAgentDir(options: OmpFeatureCenterOptions): string {
  return options.agentDir ?? options.diagnostics.agentDir ?? join(options.homeDir ?? homedir(), '.omp', 'agent')
}

function resolveGlobalConfigPath(options: OmpFeatureCenterOptions): string {
  return join(resolveAgentDir(options), 'config.yml')
}

function resolveProjectRoot(options: OmpFeatureCenterOptions): string | undefined {
  return options.projectRootPath ?? options.workspaceRootPath
}

function resolveProjectConfigPath(options: OmpFeatureCenterOptions): string | undefined {
  const projectRoot = resolveProjectRoot(options)
  return projectRoot ? join(projectRoot, '.omp', 'config.yml') : undefined
}

function roleLabel(role: string): string {
  return BUILT_IN_MODEL_ROLES.find(item => item.role === role)?.label ?? role
}

function modelRoleSource(globalValue: string | undefined, projectValue: string | undefined): OmpFeatureValueSource {
  if (projectValue !== undefined) return 'project'
  if (globalValue !== undefined) return 'global'
  return 'default'
}

function buildModelRoles(globalConfig: RawConfig, projectConfig: RawConfig): OmpFeatureCenterStateDto['modelRoles'] {
  const globalRoles = getRecordValue(globalConfig, 'modelRoles')
  const projectRoles = getRecordValue(projectConfig, 'modelRoles')
  const roleNames = new Set<string>(BUILT_IN_MODEL_ROLES.map(item => item.role))
  for (const role of Object.keys(globalRoles)) roleNames.add(role)
  for (const role of Object.keys(projectRoles)) roleNames.add(role)

  const buildRole = (role: string): OmpFeatureModelRoleDto => {
    const globalValue = typeof globalRoles[role] === 'string' ? globalRoles[role] as string : undefined
    const projectValue = typeof projectRoles[role] === 'string' ? projectRoles[role] as string : undefined
    const source = modelRoleSource(globalValue, projectValue)
    return {
      role,
      label: roleLabel(role),
      common: COMMON_MODEL_ROLES.includes(role as (typeof COMMON_MODEL_ROLES)[number]),
      source,
      effectiveValue: projectValue ?? globalValue,
      globalValue,
      projectValue,
      projectOverridden: projectValue !== undefined,
    }
  }

  const common = COMMON_MODEL_ROLES.map(role => buildRole(role))
  const advanced = [...roleNames]
    .filter(role => !COMMON_MODEL_ROLES.includes(role as (typeof COMMON_MODEL_ROLES)[number]))
    .sort((a, b) => {
      const ai = BUILT_IN_MODEL_ROLES.findIndex(item => item.role === a)
      const bi = BUILT_IN_MODEL_ROLES.findIndex(item => item.role === b)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      return a.localeCompare(b)
    })
    .map(role => buildRole(role))

  return { common, advanced }
}

function booleanSetting(globalConfig: RawConfig, projectConfig: RawConfig, path: string[], defaultValue: boolean) {
  const globalValue = getBooleanValue(globalConfig, path)
  const projectValue = getBooleanValue(projectConfig, path)
  const source: OmpFeatureValueSource = projectValue !== undefined ? 'project' : globalValue !== undefined ? 'global' : 'default'
  return {
    source,
    effectiveValue: projectValue ?? globalValue ?? defaultValue,
    globalValue,
    projectValue,
    projectOverridden: projectValue !== undefined,
  }
}

function stringSetting(globalConfig: RawConfig, projectConfig: RawConfig, path: string[], defaultValue = '') {
  const globalValue = getStringValue(globalConfig, path)
  const projectValue = getStringValue(projectConfig, path)
  const source: OmpFeatureValueSource = projectValue !== undefined ? 'project' : globalValue !== undefined ? 'global' : 'default'
  return {
    source,
    effectiveValue: projectValue ?? globalValue ?? defaultValue,
    globalValue,
    projectValue,
    projectOverridden: projectValue !== undefined,
  }
}

async function readDirectoryNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function ancestorDirs(start: string | undefined, stopAt: string | undefined): string[] {
  if (!start) return []
  const result: string[] = []
  let current = resolve(start)
  const stop = stopAt ? resolve(stopAt) : undefined
  while (true) {
    result.push(current)
    if (stop && current === stop) break
    const parent = dirname(current)
    if (parent === current) break
    if (stop && relative(stop, parent).startsWith('..')) break
    current = parent
  }
  return result
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map(path => resolve(path)))]
}

function addAllowedPath(paths: Set<string>, path: string | undefined): void {
  if (path?.trim()) paths.add(resolve(path))
}

function addAllowedPathDtos(paths: Set<string>, dtos: OmpFeatureConfigPathDto[] | undefined): void {
  for (const dto of dtos ?? []) addAllowedPath(paths, dto.path)
}

function addAllowedCapabilityPaths(paths: Set<string>, capability: OmpFeatureCapabilityDto | undefined): void {
  if (!capability) return
  addAllowedPathDtos(paths, capability.sourcePaths)
  for (const item of capability.items) addAllowedPath(paths, item.path)
}

export function getOmpFeatureCenterAllowedPaths(state: OmpFeatureCenterStateDto): string[] {
  const paths = new Set<string>()
  addAllowedPath(paths, state.runtime.globalConfigPath)
  addAllowedPath(paths, state.runtime.projectConfigPath)
  addAllowedPath(paths, state.config.global.path)
  addAllowedPath(paths, state.config.project?.path)
  addAllowedCapabilityPaths(paths, state.skills)
  addAllowedCapabilityPaths(paths, state.mcp)
  addAllowedCapabilityPaths(paths, state.agents)
  addAllowedPathDtos(paths, state.advisor.roster.paths)
  addAllowedPath(paths, state.advisor.roster.editable.path)
  return [...paths]
}

export function resolveOmpFeatureCenterAllowedPath(
  state: OmpFeatureCenterStateDto,
  targetPath: string,
): string | null {
  const normalized = resolve(targetPath)
  return getOmpFeatureCenterAllowedPaths(state).includes(normalized) ? normalized : null
}

async function scanSkillDescription(skillPath: string): Promise<string | undefined> {
  try {
    const content = await readFile(skillPath, 'utf-8')
    const frontMatter = content.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/)
    const descLine = frontMatter?.[1].split(/\r?\n/).find(line => line.trim().startsWith('description:'))
    if (descLine) return descLine.replace(/^description:\s*/, '').replace(/^["']|["']$/g, '').trim() || undefined
    const heading = content.match(/^#\s+(.+)$/m)
    return heading?.[1]?.trim()
  } catch {
    return undefined
  }
}

async function scanSkills(options: OmpFeatureCenterOptions, agentDir: string): Promise<OmpFeatureCapabilityDto> {
  const projectRoot = resolveProjectRoot(options)
  const globalAgentsSkillsDir = resolve(join(options.homeDir ?? homedir(), '.agents', 'skills'))
  const dirs = uniquePaths([
    ...ancestorDirs(projectRoot, options.workspaceRootPath).map(dir => join(dir, '.omp', 'skills')),
    ...ancestorDirs(projectRoot, options.workspaceRootPath).map(dir => join(dir, '.agents', 'skills')),
    join(agentDir, 'skills'),
    join(agentDir, 'managed-skills'),
    globalAgentsSkillsDir,
  ])
  const sourcePaths: OmpFeatureConfigPathDto[] = []
  const items: OmpFeatureCapabilityItemDto[] = []

  for (const dir of dirs) {
    const exists = await pathExists(dir)
    sourcePaths.push({ path: dir, exists })
    if (!exists) continue
    for (const name of await readDirectoryNames(dir)) {
      const skillDir = join(dir, name)
      const skillPath = join(skillDir, 'SKILL.md')
      if (!(await pathExists(skillPath))) continue
      items.push({
        name,
        path: skillPath,
        level: dir === globalAgentsSkillsDir || dir.startsWith(agentDir) ? 'user' : 'project',
        description: await scanSkillDescription(skillPath),
      })
    }
  }

  return {
    count: items.length,
    sourcePaths,
    items,
    usageHint: '/skill:<name>',
  }
}

function parseJsonObject(content: string): RawConfig | undefined {
  const parsed = JSON.parse(content) as unknown
  return isRecord(parsed) ? parsed : undefined
}

async function scanMcp(options: OmpFeatureCenterOptions, agentDir: string): Promise<OmpFeatureCapabilityDto> {
  const projectRoot = resolveProjectRoot(options)
  const paths = uniquePaths([
    ...(projectRoot ? [join(projectRoot, '.omp', 'mcp.json'), join(projectRoot, '.omp', '.mcp.json')] : []),
    join(agentDir, 'mcp.json'),
    join(agentDir, '.mcp.json'),
  ])
  const sourcePaths: OmpFeatureConfigPathDto[] = []
  const items: OmpFeatureCapabilityItemDto[] = []

  for (const filePath of paths) {
    const exists = await pathExists(filePath)
    const pathDto: OmpFeatureConfigPathDto = { path: filePath, exists }
    sourcePaths.push(pathDto)
    if (!exists) continue
    try {
      const parsed = parseJsonObject(await readFile(filePath, 'utf-8'))
      const servers = isRecord(parsed?.mcpServers) ? parsed.mcpServers : {}
      for (const name of Object.keys(servers).sort((a, b) => a.localeCompare(b))) {
        items.push({
          name,
          path: filePath,
          level: filePath.startsWith(agentDir) ? 'user' : 'project',
        })
      }
    } catch (error) {
      pathDto.parseError = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    count: items.length,
    sourcePaths,
    items,
    usageHint: '/mcp list, /mcp test, /mcp resources, /mcp prompts, /mcp reload',
  }
}

async function scanAgents(options: OmpFeatureCenterOptions, agentDir: string): Promise<OmpFeatureCapabilityDto> {
  const projectRoot = resolveProjectRoot(options)
  const dirs = uniquePaths([
    ...(projectRoot ? [join(projectRoot, '.omp', 'agents')] : []),
    join(agentDir, 'agents'),
  ])
  const sourcePaths: OmpFeatureConfigPathDto[] = []
  const items: OmpFeatureCapabilityItemDto[] = []

  for (const dir of dirs) {
    const exists = await pathExists(dir)
    sourcePaths.push({ path: dir, exists })
    if (!exists) continue
    for (const name of await readDirectoryNames(dir)) {
      if (!name.endsWith('.md')) continue
      items.push({
        name: basename(name, '.md'),
        path: join(dir, name),
        level: dir.startsWith(agentDir) ? 'user' : 'project',
      })
    }
  }

  return {
    count: items.length,
    sourcePaths,
    items,
    usageHint: 'Define Markdown agents in .omp/agents or ~/.omp/agent/agents.',
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'advisor'
}

function parseAdvisorTools(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tools = value
    .filter((tool): tool is string => typeof tool === 'string')
    .map(tool => tool.trim())
    .filter(Boolean)
  return tools.length > 0 ? tools : undefined
}

function parseAdvisorEntries(
  parsed: RawConfig,
  source?: { level: OmpFeaturePathLevel; path: string },
): Array<{ name: string; model?: string; tools?: string[]; instructions?: string; level?: OmpFeaturePathLevel; path?: string }> {
  const entries = Array.isArray(parsed.advisors) ? parsed.advisors : []
  const advisors: Array<{ name: string; model?: string; tools?: string[]; instructions?: string; level?: OmpFeaturePathLevel; path?: string }> = []
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) continue
    advisors.push({
      name: entry.name.trim(),
      model: typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : undefined,
      tools: parseAdvisorTools(entry.tools),
      instructions: typeof entry.instructions === 'string' && entry.instructions.trim() ? entry.instructions.trim() : undefined,
      level: source?.level,
      path: source?.path,
    })
  }
  return advisors
}

function parseAdvisorInstructions(parsed: RawConfig): string | undefined {
  return typeof parsed.instructions === 'string' ? parsed.instructions : undefined
}

async function resolveEditableAdvisorRosterPath(agentDir: string): Promise<string> {
  const yml = join(agentDir, 'WATCHDOG.yml')
  const yaml = join(agentDir, 'WATCHDOG.yaml')
  if (await pathExists(yml)) return yml
  if (await pathExists(yaml)) return yaml
  return yml
}

function advisorCandidatePaths(options: OmpFeatureCenterOptions, agentDir: string): Array<{ path: string; level: OmpFeaturePathLevel; depth: number }> {
  const projectRoot = resolveProjectRoot(options)
  const projectPaths = ancestorDirs(projectRoot, options.workspaceRootPath).flatMap((dir, index) => [
    { path: join(dir, 'WATCHDOG.yml'), level: 'project' as const, depth: index },
    { path: join(dir, 'WATCHDOG.yaml'), level: 'project' as const, depth: index },
    { path: join(dir, '.omp', 'WATCHDOG.yml'), level: 'project' as const, depth: index },
    { path: join(dir, '.omp', 'WATCHDOG.yaml'), level: 'project' as const, depth: index },
  ])
  return [
    { path: join(agentDir, 'WATCHDOG.yml'), level: 'user', depth: 0 },
    { path: join(agentDir, 'WATCHDOG.yaml'), level: 'user', depth: 0 },
    ...projectPaths.reverse(),
  ]
}

async function scanAdvisorRoster(options: OmpFeatureCenterOptions, agentDir: string): Promise<OmpFeatureAdvisorRosterDto> {
  const paths = advisorCandidatePaths(options, agentDir)
  const sourcePaths: OmpFeatureConfigPathDto[] = []
  const advisors = new Map<string, { name: string; model?: string; tools?: string[]; instructions?: string; level?: OmpFeaturePathLevel; path?: string }>()
  const parseErrors: string[] = []
  let sharedInstructions = false
  const editablePath = await resolveEditableAdvisorRosterPath(agentDir)
  const editableConfig = await readYamlConfig(editablePath)
  const editableData = editableConfig.parseError ? {} : editableConfig.data
  const editable: OmpFeatureAdvisorRosterEditableDto = {
    ...toPathDto(editableConfig),
    instructions: parseAdvisorInstructions(editableData) ?? '',
    advisors: parseAdvisorEntries(editableData, { level: 'user', path: editablePath }),
  }

  for (const item of paths) {
    const exists = await pathExists(item.path)
    const pathDto: OmpFeatureConfigPathDto = { path: item.path, exists }
    sourcePaths.push(pathDto)
    if (!exists) continue
    try {
      const parsed = loadYaml(await readFile(item.path, 'utf-8'))
      if (!isRecord(parsed)) continue
      if (parseAdvisorInstructions(parsed)?.trim()) {
        sharedInstructions = true
      }
      for (const advisor of parseAdvisorEntries(parsed, { level: item.level, path: item.path })) {
        advisors.set(slugify(advisor.name), advisor)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pathDto.parseError = message
      parseErrors.push(`${item.path}: ${message}`)
    }
  }

  return {
    paths: sourcePaths,
    advisors: [...advisors.values()],
    editable,
    sharedInstructions,
    parseErrors,
  }
}

function runtimeDto(
  runtime: OmpRuntimeStatus,
  globalConfigPath: string,
  projectConfigPath: string | undefined,
  projectConfigExists: boolean | undefined,
  options: OmpFeatureCenterOptions,
) {
  const projectRoot = resolveProjectRoot(options)
  return {
    available: runtime.ok,
    version: runtime.version,
    executablePath: runtime.command,
    rawCommand: runtime.rawCommand,
    commandSource: runtime.source,
    globalConfigPath,
    projectRootPath: projectRoot,
    projectConfigPath,
    projectConfigExists,
    checkedAt: runtime.checkedAt,
    error: runtime.error,
  }
}

export async function getOmpFeatureCenterState(options: OmpFeatureCenterOptions): Promise<OmpFeatureCenterStateDto> {
  const now = options.now ?? Date.now
  const agentDir = resolveAgentDir(options)
  const globalPath = resolveGlobalConfigPath(options)
  const projectPath = resolveProjectConfigPath(options)
  const [globalConfig, projectConfig] = await Promise.all([
    readYamlConfig(globalPath),
    projectPath ? readYamlConfig(projectPath) : Promise.resolve(undefined),
  ])
  const projectData = projectConfig?.parseError ? {} : projectConfig?.data ?? {}
  const runtime = options.diagnostics.runtime
  const modelRoles = buildModelRoles(globalConfig.parseError ? {} : globalConfig.data, projectData)
  const commonPlan = modelRoles.common.find(role => role.role === 'plan')

  const [skills, mcp, agents, roster] = await Promise.all([
    scanSkills(options, agentDir),
    scanMcp(options, agentDir),
    scanAgents(options, agentDir),
    scanAdvisorRoster(options, agentDir),
  ])

  return {
    runtime: runtimeDto(runtime, globalPath, projectPath, projectConfig?.exists, options),
    config: {
      global: toPathDto(globalConfig),
      project: projectConfig ? toPathDto(projectConfig) : undefined,
    },
    modelRoles,
    advisor: {
      enabled: booleanSetting(globalConfig.data, projectData, ['advisor', 'enabled'], false),
      subagents: booleanSetting(globalConfig.data, projectData, ['advisor', 'subagents'], false),
      modelRole: stringSetting(globalConfig.data, projectData, ['modelRoles', 'advisor']),
      roster,
    },
    skills,
    mcp,
    agents,
    nativePlan: {
      modelRole: commonPlan?.effectiveValue,
      supportStatus: 'rpc-unavailable',
      toggleAvailable: false,
      approvalUi: 'extension-ui-if-emitted',
      rpcCommands: [],
      unavailableReason: 'Upstream OMP RPC currently exposes no plan-mode toggle, state, or plan-review command.',
      message: 'OMP native /plan controls are hidden until upstream exposes stable RPC state. This page configures modelRoles.plan and is ready to surface approval UI if OMP emits an extension request.',
    },
    unavailableCommands: UNAVAILABLE_TUI_COMMANDS.map(command => ({ ...command })),
    lastRefreshedAt: now(),
  }
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, filePath)
}

function normalizeAdvisorRosterInput(input: SaveOmpFeatureCenterConfigInput['advisorRoster']): {
  instructions?: string
  advisors: Array<{ name: string; model?: string; tools?: string[]; instructions?: string }>
} | undefined {
  if (!input) return undefined
  const instructions = typeof input.instructions === 'string' && input.instructions.trim()
    ? input.instructions.trim()
    : undefined
  const advisors = (input.advisors ?? [])
    .map(advisor => {
      const name = typeof advisor.name === 'string' ? advisor.name.trim() : ''
      if (!name) return null
      const model = typeof advisor.model === 'string' && advisor.model.trim() ? advisor.model.trim() : undefined
      const instructions = typeof advisor.instructions === 'string' && advisor.instructions.trim() ? advisor.instructions.trim() : undefined
      const tools = (advisor.tools ?? [])
        .filter((tool): tool is string => typeof tool === 'string')
        .map(tool => tool.trim())
        .filter(Boolean)
      return {
        name,
        ...(model ? { model } : {}),
        ...(tools.length > 0 ? { tools } : {}),
        ...(instructions ? { instructions } : {}),
      }
    })
    .filter((advisor): advisor is { name: string; model?: string; tools?: string[]; instructions?: string } => advisor !== null)
  return { instructions, advisors }
}

function applyAdvisorRoster(next: RawConfig, roster: ReturnType<typeof normalizeAdvisorRosterInput>): void {
  if (!roster) return
  if (roster.instructions) {
    next.instructions = roster.instructions
  } else {
    delete next.instructions
  }
  next.advisors = roster.advisors.map(advisor => ({
    name: advisor.name,
    ...(advisor.model ? { model: advisor.model } : {}),
    ...(advisor.tools && advisor.tools.length > 0 ? { tools: advisor.tools } : {}),
    ...(advisor.instructions ? { instructions: advisor.instructions } : {}),
  }))
}

export async function saveOmpFeatureCenterConfig(
  input: SaveOmpFeatureCenterConfigInput,
  options: OmpFeatureCenterOptions,
): Promise<SaveOmpFeatureCenterConfigResult> {
  const agentDir = resolveAgentDir(options)
  const globalPath = resolveGlobalConfigPath(options)
  const existing = await readYamlConfig(globalPath)
  if (existing.parseError) {
    return {
      success: false,
      error: `Cannot save OMP config because ${globalPath} could not be parsed: ${existing.parseError}`,
    }
  }
  const rosterInput = normalizeAdvisorRosterInput(input.advisorRoster)
  const rosterPath = rosterInput ? await resolveEditableAdvisorRosterPath(agentDir) : undefined
  const rosterExisting = rosterPath ? await readYamlConfig(rosterPath) : undefined
  if (rosterExisting?.parseError) {
    return {
      success: false,
      error: `Cannot save OMP advisor roster because ${rosterPath} could not be parsed: ${rosterExisting.parseError}`,
    }
  }

  const next: RawConfig = structuredClone(existing.data)
  for (const [role, value] of Object.entries(input.modelRoles ?? {})) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    setNestedValue(next, ['modelRoles', role], trimmed || undefined)
  }

  if (input.advisor?.enabled !== undefined) {
    setNestedValue(next, ['advisor', 'enabled'], input.advisor.enabled)
  }
  if (input.advisor?.subagents !== undefined) {
    setNestedValue(next, ['advisor', 'subagents'], input.advisor.subagents)
  }

  const content = dumpYaml(next, { lineWidth: 120, noRefs: true })
  await atomicWriteText(globalPath, content.endsWith('\n') ? content : `${content}\n`)

  if (rosterInput && rosterExisting && rosterPath) {
    const nextRoster: RawConfig = structuredClone(rosterExisting.data)
    applyAdvisorRoster(nextRoster, rosterInput)
    const rosterContent = dumpYaml(nextRoster, { lineWidth: 120, noRefs: true })
    await atomicWriteText(rosterPath, rosterContent.endsWith('\n') ? rosterContent : `${rosterContent}\n`)
  }

  return {
    success: true,
    state: await getOmpFeatureCenterState(options),
  }
}
