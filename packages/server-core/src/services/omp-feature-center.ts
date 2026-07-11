import { access, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
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
  OmpResourceCategory,
  OmpResourceCreateInput,
  OmpResourceDiagnostic,
  OmpResourceEntry,
  OmpResourceMcpTestResult,
  OmpResourceOperationResult,
  OmpResourceRemoveInput,
  OmpResourceScope,
  OmpResourceSetEnabledInput,
  OmpResourceSnapshot,
  OmpResourceSnapshotInput,
  OmpResourceSource,
  OmpResourceTestMcpInput,
  OmpResourceType,
  OmpResourceUpdateInput,
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
      supportStatus: 'rpc-command-available',
      toggleAvailable: true,
      approvalUi: 'extension-ui-if-emitted',
      rpcCommands: ['get_plan_mode_state', 'set_plan_mode', 'plan_review_result'],
      message: 'OMP native Plan Mode is controlled from the session command menu. Each session negotiates support with its active OMP runtime before enabling the toggle.',
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

// ---------------------------------------------------------------------------
// OMP resource lifecycle (MCP, Skills, Agents)
// ---------------------------------------------------------------------------

const RESOURCE_DISABLED_LIST_KEYS: Record<OmpResourceType, string> = {
  mcp: 'disabledMcp',
  skill: 'disabledSkills',
  agent: 'disabledAgents',
}

function resourceId(type: OmpResourceType, name: string): string {
  return `${type}/${name}`
}

function resourceNameFromId(id: string): string {
  const slash = id.indexOf('/')
  return slash === -1 ? id : id.slice(slash + 1)
}

function resourceCategoryKey(type: OmpResourceType): 'mcp' | 'skills' | 'agents' {
  if (type === 'skill') return 'skills'
  if (type === 'agent') return 'agents'
  return 'mcp'
}

function resolveScopeDir(options: OmpFeatureCenterOptions, scope: OmpResourceScope): string | undefined {
  const agentDir = resolveAgentDir(options)
  if (scope === 'user') return agentDir
  const projectRoot = resolveProjectRoot(options)
  return projectRoot ? join(projectRoot, '.omp') : undefined
}

function resolveMcpPath(options: OmpFeatureCenterOptions, scope: OmpResourceScope): string | undefined {
  const scopeDir = resolveScopeDir(options, scope)
  return scopeDir ? join(scopeDir, 'mcp.json') : undefined
}

function resolveSkillPath(options: OmpFeatureCenterOptions, scope: OmpResourceScope, name: string): string | undefined {
  const scopeDir = resolveScopeDir(options, scope)
  return scopeDir ? join(scopeDir, 'skills', name, 'SKILL.md') : undefined
}

function resolveAgentPath(options: OmpFeatureCenterOptions, scope: OmpResourceScope, name: string): string | undefined {
  const scopeDir = resolveScopeDir(options, scope)
  return scopeDir ? join(scopeDir, 'agents', `${name}.md`) : undefined
}

function resolveConfigPath(options: OmpFeatureCenterOptions, scope: OmpResourceScope): string | undefined {
  const scopeDir = resolveScopeDir(options, scope)
  return scopeDir ? join(scopeDir, 'config.yml') : undefined
}

function levelToScope(level: OmpFeaturePathLevel): OmpResourceScope {
  return level === 'user' ? 'user' : 'project'
}

function levelToSource(level: OmpFeaturePathLevel): OmpResourceSource {
  return level === 'user' ? 'user' : 'project'
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const content = `${JSON.stringify(data, null, 2)}\n`
  await atomicWriteText(filePath, content)
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

async function computeFileRevision(filePath: string): Promise<string | undefined> {
  try {
    const stats = await stat(filePath)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return undefined
  }
}

function computeObjectRevision(value: unknown): string {
  return hashString(JSON.stringify(value))
}

function getDisabledList(config: RawConfig, type: OmpResourceType): string[] {
  const key = RESOURCE_DISABLED_LIST_KEYS[type]
  const value = config[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function isResourceEnabled(id: string, disabledList: string[]): boolean {
  return !disabledList.includes(id)
}

async function readJsonConfig(filePath: string): Promise<{ exists: boolean; parseError?: string; data: RawConfig }> {
  const result = await readYamlConfig(filePath)
  return result
}

async function readMcpJson(filePath: string): Promise<{ exists: boolean; parseError?: string; data: RawConfig }> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, data: {} }
    }
    return { exists: false, parseError: error instanceof Error ? error.message : String(error), data: {} }
  }
  try {
    const parsed = JSON.parse(content) as unknown
    if (!isRecord(parsed)) {
      return { exists: true, parseError: 'mcp.json must contain an object.', data: {} }
    }
    return { exists: true, data: parsed }
  } catch (error) {
    return { exists: true, parseError: error instanceof Error ? error.message : String(error), data: {} }
  }
}

interface McpServerDefinition {
  command?: string
  args?: string[]
  env?: Record<string, string>
}

function filterStringRecord(value: RawConfig): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') result[k] = v
  }
  return result
}

function getMcpServers(data: RawConfig): Record<string, McpServerDefinition> {
  const servers = data.mcpServers
  if (!isRecord(servers)) return {}
  const result: Record<string, McpServerDefinition> = {}
  for (const [name, value] of Object.entries(servers)) {
    if (isRecord(value)) {
      result[name] = {
        command: typeof value.command === 'string' ? value.command : undefined,
        args: Array.isArray(value.args) ? value.args.filter((a): a is string => typeof a === 'string') : undefined,
        env: isRecord(value.env) ? filterStringRecord(value.env) : undefined,
      }
    }
  }
  return result
}

async function readResourceDescription(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, 'utf-8')
    const frontMatter = content.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/)
    const descLine = frontMatter?.[1].split(/\r?\n/).find(line => line.trim().startsWith('description:'))
    if (descLine) return descLine.replace(/^description:\s*/, '').replace(/^["']|["']$/g, '').trim() || undefined
    return undefined
  } catch {
    return undefined
  }
}

async function buildResourceCategory(
  type: OmpResourceType,
  capability: OmpFeatureCapabilityDto,
  options: OmpFeatureCenterOptions,
  disabledLists: Map<OmpResourceScope, string[]>,
  now: number,
): Promise<OmpResourceCategory> {
  const entries: OmpResourceEntry[] = []
  const diagnostics: OmpResourceDiagnostic[] = []

  for (const pathDto of capability.sourcePaths) {
    if (pathDto.parseError) {
      diagnostics.push({
        code: 'CONFIG_INVALID',
        message: pathDto.parseError,
        path: pathDto.path,
      })
    }
  }

  const mcpDefinitionsByPath = new Map<string, Record<string, McpServerDefinition>>()

  for (const item of capability.items) {
    const scope = levelToScope(item.level)
    const source = levelToSource(item.level)
    const id = resourceId(type, item.name)
    const disabledList = disabledLists.get(scope) ?? []
    const enabled = isResourceEnabled(id, disabledList)

    let revision: string
    let description = item.description
    let toolCount: number | undefined

    if (type === 'mcp') {
      let definitions = mcpDefinitionsByPath.get(item.path)
      if (!definitions) {
        const parsed = await readMcpJson(item.path)
        definitions = getMcpServers(parsed.data)
        mcpDefinitionsByPath.set(item.path, definitions)
      }
      const definition = definitions[item.name]
      revision = definition ? computeObjectRevision(definition) : (await computeFileRevision(item.path) ?? `${now}`)
    } else {
      if (type === 'agent') {
        description = (await readResourceDescription(item.path)) ?? item.description
      }
      revision = await computeFileRevision(item.path) ?? `${now}`
    }

    entries.push({
      id,
      type,
      name: item.name,
      source,
      scope,
      enabled,
      effectiveEnabled: enabled,
      path: item.path,
      description,
      toolCount,
      diagnostics: [],
      revision,
      lastRefreshedAt: now,
    })
  }

  return {
    entries,
    sourcePaths: capability.sourcePaths,
    error: capability.error,
  }
}

export async function getOmpResourceSnapshot(
  input: OmpResourceSnapshotInput,
  options: OmpFeatureCenterOptions,
): Promise<OmpResourceSnapshot> {
  const now = options.now?.() ?? Date.now()
  const agentDir = resolveAgentDir(options)
  const projectRoot = resolveProjectRoot(options)

  const [skillsCapability, mcpCapability, agentsCapability] = await Promise.all([
    scanSkills(options, agentDir),
    scanMcp(options, agentDir),
    scanAgents(options, agentDir),
  ])

  const globalConfig = await readYamlConfig(resolveGlobalConfigPath(options))
  const projectConfigPath = resolveProjectConfigPath(options)
  const projectConfig = projectConfigPath ? await readYamlConfig(projectConfigPath) : undefined

  const disabledLists = new Map<OmpResourceScope, string[]>()
  disabledLists.set('user', getDisabledList(globalConfig.parseError ? {} : globalConfig.data, 'mcp'))
  disabledLists.get('user')!.push(...getDisabledList(globalConfig.parseError ? {} : globalConfig.data, 'skill'))
  disabledLists.get('user')!.push(...getDisabledList(globalConfig.parseError ? {} : globalConfig.data, 'agent'))

  if (projectConfig && !projectConfig.parseError && projectRoot) {
    disabledLists.set('project', [
      ...getDisabledList(projectConfig.data, 'mcp'),
      ...getDisabledList(projectConfig.data, 'skill'),
      ...getDisabledList(projectConfig.data, 'agent'),
    ])
  }

  const [skills, mcp, agents] = await Promise.all([
    buildResourceCategory('skill', skillsCapability, options, disabledLists, now),
    buildResourceCategory('mcp', mcpCapability, options, disabledLists, now),
    buildResourceCategory('agent', agentsCapability, options, disabledLists, now),
  ])

  const diagnostics: OmpResourceDiagnostic[] = []
  if (globalConfig.parseError) {
    diagnostics.push({ code: 'CONFIG_INVALID', message: globalConfig.parseError, path: globalConfig.path })
  }
  if (projectConfig?.parseError) {
    diagnostics.push({ code: 'CONFIG_INVALID', message: projectConfig.parseError, path: projectConfig.path })
  }

  return {
    mcp,
    skills,
    agents,
    diagnostics,
    refreshedAt: now,
  }
}

export async function refreshResources(
  input: OmpResourceSnapshotInput,
  options: OmpFeatureCenterOptions,
): Promise<OmpResourceSnapshot> {
  return getOmpResourceSnapshot(input, options)
}

function normalizeMcpDraft(draft: Record<string, unknown>): { name: string; definition: McpServerDefinition } | null {
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) return null
  const command = typeof draft.command === 'string' ? draft.command.trim() : undefined
  const args = Array.isArray(draft.args)
    ? draft.args.filter((a): a is string => typeof a === 'string').map(a => a.trim()).filter(Boolean)
    : undefined
  const env = isRecord(draft.env) ? normalizeStringEnv(draft.env) : undefined
  return { name, definition: { command, args, env } }
}

function normalizeStringEnv(value: RawConfig): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') result[k.trim()] = v.trim()
  }
  return result
}

function normalizeSkillDraft(draft: Record<string, unknown>): { name: string; description?: string } | null {
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (!name) return null
  const description = typeof draft.description === 'string' ? draft.description.trim() : undefined
  return { name, description }
}

function normalizeAgentDraft(draft: Record<string, unknown>): { name: string; description?: string } | null {
  return normalizeSkillDraft(draft)
}

async function readScopeConfig(options: OmpFeatureCenterOptions, scope: OmpResourceScope): Promise<ReadConfigResult | undefined> {
  const path = resolveConfigPath(options, scope)
  if (!path) return undefined
  return readYamlConfig(path)
}

async function writeScopeConfig(path: string, data: RawConfig): Promise<void> {
  const content = dumpYaml(data, { lineWidth: 120, noRefs: true })
  await atomicWriteText(path, content.endsWith('\n') ? content : `${content}\n`)
}

async function toggleDisabledInConfig(
  configResult: ReadConfigResult,
  type: OmpResourceType,
  id: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (configResult.parseError) {
    return {
      success: false,
      error: `Cannot update ${basename(configResult.path)} because it could not be parsed: ${configResult.parseError}`,
    }
  }
  const key = RESOURCE_DISABLED_LIST_KEYS[type]
  const next: RawConfig = structuredClone(configResult.data)
  const existing = Array.isArray(next[key]) ? next[key] as unknown[] : []
  const list = existing.filter((item): item is string => typeof item === 'string')
  const index = list.indexOf(id)
  if (enabled) {
    if (index !== -1) {
      list.splice(index, 1)
      next[key] = list.length > 0 ? list : undefined
    }
  } else {
    if (index === -1) {
      list.push(id)
      next[key] = list
    }
  }
  await writeScopeConfig(configResult.path, next)
  return { success: true }
}

export async function createResource(
  input: OmpResourceCreateInput,
  options: OmpFeatureCenterOptions,
): Promise<OmpResourceOperationResult> {
  try {
    const { type, scope, draft } = input
    const now = options.now?.() ?? Date.now()

    if (type === 'mcp') {
      const normalized = normalizeMcpDraft(draft)
      if (!normalized) {
        return { success: false, error: 'MCP server requires a non-empty name.', code: 'INVALID_INPUT' }
      }
      const { name, definition } = normalized
      const filePath = resolveMcpPath(options, scope)
      if (!filePath) {
        return { success: false, error: `Cannot create ${scope} MCP server: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      const parsed = await readMcpJson(filePath)
      if (parsed.parseError) {
        return { success: false, error: `Cannot modify ${filePath}: ${parsed.parseError}`, code: 'CONFIG_INVALID' }
      }
      const next: RawConfig = { ...parsed.data }
      const servers = isRecord(next.mcpServers) ? { ...next.mcpServers } : {}
      if (servers[name] !== undefined) {
        return { success: false, error: `MCP server "${name}" already exists in this scope.`, code: 'ALREADY_EXISTS' }
      }
      servers[name] = definition
      next.mcpServers = servers
      await atomicWriteJson(filePath, next)
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    if (type === 'skill') {
      const normalized = normalizeSkillDraft(draft)
      if (!normalized) {
        return { success: false, error: 'Skill requires a non-empty name.', code: 'INVALID_INPUT' }
      }
      const { name, description } = normalized
      const filePath = resolveSkillPath(options, scope, name)
      if (!filePath) {
        return { success: false, error: `Cannot create ${scope} skill: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      if (await pathExists(filePath)) {
        return { success: false, error: `Skill "${name}" already exists in this scope.`, code: 'ALREADY_EXISTS' }
      }
      const frontMatter = description ? `---\nname: ${name}\ndescription: ${description}\n---\n\n` : `---\nname: ${name}\n---\n\n`
      const body = `# ${name}\n\n`
      await atomicWriteText(filePath, `${frontMatter}${body}`)
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    if (type === 'agent') {
      const normalized = normalizeAgentDraft(draft)
      if (!normalized) {
        return { success: false, error: 'Agent requires a non-empty name.', code: 'INVALID_INPUT' }
      }
      const { name, description } = normalized
      const filePath = resolveAgentPath(options, scope, name)
      if (!filePath) {
        return { success: false, error: `Cannot create ${scope} agent: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      if (await pathExists(filePath)) {
        return { success: false, error: `Agent "${name}" already exists in this scope.`, code: 'ALREADY_EXISTS' }
      }
      const frontMatter = description ? `---\nname: ${name}\ndescription: ${description}\n---\n\n` : `---\nname: ${name}\n---\n\n`
      const body = `# ${name}\n\n`
      await atomicWriteText(filePath, `${frontMatter}${body}`)
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    return { success: false, error: `Unsupported resource type: ${type}`, code: 'INVALID_TYPE' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), code: 'UNKNOWN' }
  }
}

export async function updateResource(
  input: OmpResourceUpdateInput,
  options: OmpFeatureCenterOptions,
): Promise<OmpResourceOperationResult> {
  try {
    const { type, id, scope, expectedRevision, patch } = input
    const name = resourceNameFromId(id)

    const snapshot = await getOmpResourceSnapshot({ scope }, options)
    const category = snapshot[resourceCategoryKey(type)]
    const entry = category.entries.find(e => e.id === id && e.scope === scope)
    if (!entry) {
      return { success: false, error: `${type} "${name}" not found in ${scope} scope.`, code: 'NOT_FOUND' }
    }
    if (entry.revision !== expectedRevision) {
      return { success: false, error: 'Resource was modified elsewhere. Refresh and try again.', code: 'REVISION_CONFLICT' }
    }

    if (type === 'mcp') {
      const filePath = resolveMcpPath(options, scope)
      if (!filePath) {
        return { success: false, error: `Cannot update ${scope} MCP server: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      const parsed = await readMcpJson(filePath)
      if (parsed.parseError) {
        return { success: false, error: `Cannot modify ${filePath}: ${parsed.parseError}`, code: 'CONFIG_INVALID' }
      }
      const servers = getMcpServers(parsed.data)
      const existing = servers[name]
      if (!existing) {
        return { success: false, error: `MCP server "${name}" not found.`, code: 'NOT_FOUND' }
      }
      const newName = typeof patch.name === 'string' ? patch.name.trim() : name
      const nextDefinition: McpServerDefinition = {
        command: typeof patch.command === 'string' ? patch.command.trim() : existing.command,
        args: Array.isArray(patch.args)
          ? patch.args.filter((a): a is string => typeof a === 'string').map(a => a.trim()).filter(Boolean)
          : existing.args,
        env: isRecord(patch.env) ? normalizeStringEnv(patch.env) : existing.env,
      }
      const nextServers: Record<string, McpServerDefinition> = {}
      for (const [key, value] of Object.entries(servers)) {
        if (key === name) continue
        nextServers[key] = value
      }
      nextServers[newName] = nextDefinition
      await atomicWriteJson(filePath, { ...parsed.data, mcpServers: nextServers })
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    if (type === 'skill') {
      const oldPath = resolveSkillPath(options, scope, name)
      if (!oldPath) {
        return { success: false, error: `Cannot update ${scope} skill: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      const newName = typeof patch.name === 'string' ? patch.name.trim() : name
      const newDescription = typeof patch.description === 'string' ? patch.description.trim() : entry.description
      const newPath = newName !== name ? resolveSkillPath(options, scope, newName) : oldPath
      if (!newPath) {
        return { success: false, error: `Cannot update ${scope} skill: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      if (newName !== name && (await pathExists(newPath))) {
        return { success: false, error: `Skill "${newName}" already exists in this scope.`, code: 'ALREADY_EXISTS' }
      }
      let content: string
      try {
        content = await readFile(oldPath, 'utf-8')
      } catch (error) {
        return { success: false, error: `Cannot read skill file: ${error instanceof Error ? error.message : String(error)}`, code: 'READ_FAILED' }
      }
      const body = content.replace(/^---[\s\S]*?---\s*/, '').trimStart() || `# ${newName}\n\n`
      const frontMatter = newDescription
        ? `---\nname: ${newName}\ndescription: ${newDescription}\n---\n\n`
        : `---\nname: ${newName}\n---\n\n`
      await mkdir(dirname(newPath), { recursive: true })
      await atomicWriteText(newPath, `${frontMatter}${body}`)
      if (newName !== name && oldPath !== newPath) {
        await rm(oldPath).catch(() => {})
        await rmdir(dirname(oldPath)).catch(() => {})
      }
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    if (type === 'agent') {
      const oldPath = resolveAgentPath(options, scope, name)
      if (!oldPath) {
        return { success: false, error: `Cannot update ${scope} agent: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      const newName = typeof patch.name === 'string' ? patch.name.trim() : name
      const newDescription = typeof patch.description === 'string' ? patch.description.trim() : entry.description
      const newPath = newName !== name ? resolveAgentPath(options, scope, newName) : oldPath
      if (!newPath) {
        return { success: false, error: `Cannot update ${scope} agent: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      if (newName !== name && (await pathExists(newPath))) {
        return { success: false, error: `Agent "${newName}" already exists in this scope.`, code: 'ALREADY_EXISTS' }
      }
      let content: string
      try {
        content = await readFile(oldPath, 'utf-8')
      } catch (error) {
        return { success: false, error: `Cannot read agent file: ${error instanceof Error ? error.message : String(error)}`, code: 'READ_FAILED' }
      }
      const body = content.replace(/^---[\s\S]*?---\s*/, '').trimStart() || `# ${newName}\n\n`
      const frontMatter = newDescription
        ? `---\nname: ${newName}\ndescription: ${newDescription}\n---\n\n`
        : `---\nname: ${newName}\n---\n\n`
      await mkdir(dirname(newPath), { recursive: true })
      await atomicWriteText(newPath, `${frontMatter}${body}`)
      if (newName !== name && oldPath !== newPath) {
        await rm(oldPath).catch(() => {})
      }
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    return { success: false, error: `Unsupported resource type: ${type}`, code: 'INVALID_TYPE' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), code: 'UNKNOWN' }
  }
}

export async function setResourceEnabled(
  input: OmpResourceSetEnabledInput,
  options: OmpFeatureCenterOptions,
): Promise<OmpResourceOperationResult> {
  try {
    const { type, id, scope, expectedRevision, enabled } = input
    const name = resourceNameFromId(id)

    const snapshot = await getOmpResourceSnapshot({ scope }, options)
    const category = snapshot[resourceCategoryKey(type)]
    const entry = category.entries.find(e => e.id === id && e.scope === scope)
    if (!entry) {
      return { success: false, error: `${type} "${name}" not found in ${scope} scope.`, code: 'NOT_FOUND' }
    }
    if (entry.revision !== expectedRevision) {
      return { success: false, error: 'Resource was modified elsewhere. Refresh and try again.', code: 'REVISION_CONFLICT' }
    }

    const config = await readScopeConfig(options, scope)
    if (!config) {
      return { success: false, error: `Cannot update ${scope} config: scope directory is not available.`, code: 'SCOPE_MISSING' }
    }
    const result = await toggleDisabledInConfig(config, type, id, enabled)
    if (!result.success) {
      return { success: false, error: result.error, code: 'CONFIG_WRITE_FAILED' }
    }
    return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), code: 'UNKNOWN' }
  }
}

export async function removeResource(
  input: OmpResourceRemoveInput,
  options: OmpFeatureCenterOptions,
): Promise<OmpResourceOperationResult> {
  try {
    const { type, id, scope, expectedRevision } = input
    const name = resourceNameFromId(id)

    const snapshot = await getOmpResourceSnapshot({ scope }, options)
    const category = snapshot[resourceCategoryKey(type)]
    const entry = category.entries.find(e => e.id === id && e.scope === scope)
    if (!entry) {
      return { success: false, error: `${type} "${name}" not found in ${scope} scope.`, code: 'NOT_FOUND' }
    }
    if (entry.revision !== expectedRevision) {
      return { success: false, error: 'Resource was modified elsewhere. Refresh and try again.', code: 'REVISION_CONFLICT' }
    }

    if (type === 'mcp') {
      const filePath = resolveMcpPath(options, scope)
      if (!filePath) {
        return { success: false, error: `Cannot remove ${scope} MCP server: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      const parsed = await readMcpJson(filePath)
      if (parsed.parseError) {
        return { success: false, error: `Cannot modify ${filePath}: ${parsed.parseError}`, code: 'CONFIG_INVALID' }
      }
      const servers = getMcpServers(parsed.data)
      if (servers[name] === undefined) {
        return { success: false, error: `MCP server "${name}" not found.`, code: 'NOT_FOUND' }
      }
      const nextServers: Record<string, McpServerDefinition> = {}
      for (const [key, value] of Object.entries(servers)) {
        if (key !== name) nextServers[key] = value
      }
      await atomicWriteJson(filePath, { ...parsed.data, mcpServers: nextServers })
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    if (type === 'skill') {
      const filePath = resolveSkillPath(options, scope, name)
      if (!filePath) {
        return { success: false, error: `Cannot remove ${scope} skill: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      await rm(filePath).catch(() => {})
      await rmdir(dirname(filePath)).catch(() => {})
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    if (type === 'agent') {
      const filePath = resolveAgentPath(options, scope, name)
      if (!filePath) {
        return { success: false, error: `Cannot remove ${scope} agent: scope directory is not available.`, code: 'SCOPE_MISSING' }
      }
      await rm(filePath).catch(() => {})
      return { success: true, snapshot: await getOmpResourceSnapshot({ scope }, options) }
    }

    return { success: false, error: `Unsupported resource type: ${type}`, code: 'INVALID_TYPE' }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), code: 'UNKNOWN' }
  }
}

async function findMcpDefinition(
  options: OmpFeatureCenterOptions,
  scope: OmpResourceScope,
  name: string,
): Promise<{ filePath: string; definition: McpServerDefinition } | null> {
  const filePath = resolveMcpPath(options, scope)
  if (!filePath) return null
  const parsed = await readMcpJson(filePath)
  if (parsed.parseError) return null
  const servers = getMcpServers(parsed.data)
  const definition = servers[name]
  if (!definition) return null
  return { filePath, definition }
}

export async function testMcpResource(
  input: OmpResourceTestMcpInput,
  options: OmpFeatureCenterOptions,
): Promise<OmpResourceMcpTestResult> {
  const { id, scope } = input
  const name = resourceNameFromId(id)

  const found = await findMcpDefinition(options, scope, name)
  if (!found) {
    return { success: false, error: `MCP server "${name}" not found in ${scope} scope.`, code: 'NOT_FOUND' }
  }
  const { definition } = found
  if (!definition.command) {
    return { success: false, error: `MCP server "${name}" has no command.`, code: 'INVALID_CONFIG' }
  }

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

  const client = new Client({ name: 'craft-agent-omp-mcp-test', version: '0.1.0' }, { capabilities: {} })
  const transport = new StdioClientTransport({
    command: definition.command,
    args: definition.args,
    env: definition.env,
    stderr: 'pipe',
  })

  const timeoutMs = 15_000
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('MCP connection timed out')), timeoutMs)),
    ])
    const result = await Promise.race([
      client.listTools(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('MCP listTools timed out')), timeoutMs)),
    ])
    await client.close().catch(() => {})
    const tools = (result.tools ?? []).map(tool => ({ name: tool.name, description: tool.description }))
    return {
      success: true,
      connected: true,
      tools,
      snapshot: await getOmpResourceSnapshot({ scope }, options),
    }
  } catch (error) {
    await client.close().catch(() => {})
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      connected: false,
      testError: message,
      error: `MCP test failed: ${message}`,
      code: 'MCP_CONNECT_FAILED',
    }
  }
}
