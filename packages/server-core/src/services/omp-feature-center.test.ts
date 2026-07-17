import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { load as loadYaml } from 'js-yaml'
import {
  createResource,
  getOmpFeatureCenterAllowedPaths,
  getOmpFeatureCenterState,
  getOmpResourceSnapshot,
  refreshResources,
  removeResource,
  resolveOmpFeatureCenterAllowedPath,
  saveOmpFeatureCenterConfig,
  setResourceEnabled,
  testMcpResource,
  updateResource,
  type OmpFeatureCenterOptions,
} from './omp-feature-center'
import type { OmpDiagnosticsSummary, OmpResourceSnapshot } from '@craft-agent/shared/protocol'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'omp-feature-center-'))
  tempRoots.push(root)
  return root
}

function diagnostics(): OmpDiagnosticsSummary {
  return {
    runtime: {
      ok: true,
      command: 'omp',
      args: [],
      rawCommand: 'omp',
      source: 'default',
      elapsedMs: 1,
      version: '16.3.0',
      protocolVersion: 'unversioned',
      checkedAt: 1000,
    },
    versionCompatibility: {
      ompVersion: '16.3.0',
      compatible: true,
    },
  }
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

describe('OMP Feature Center service', () => {
  it('reads effective model roles, advisor settings, and capability inventories', async () => {
    const root = await makeTempRoot()
    const homeDir = join(root, 'home')
    const agentDir = join(homeDir, '.omp', 'agent')
    const workspaceRootPath = join(root, 'workspace')
    const projectRootPath = join(workspaceRootPath, 'project')

    await write(join(agentDir, 'config.yml'), [
      'modelRoles:',
      '  default: openai/gpt-5',
      '  plan: opencode-go/glm-5.2:high',
      '  advisor: opencode-go/qwen3.7-plus:xhigh',
      'advisor:',
      '  enabled: true',
      '  subagents: false',
      '',
    ].join('\n'))
    await write(join(projectRootPath, '.omp', 'config.yml'), [
      'modelRoles:',
      '  plan: project/architect',
      'advisor:',
      '  subagents: true',
      '',
    ].join('\n'))
    await write(join(agentDir, 'skills', 'global-skill', 'SKILL.md'), [
      '---',
      'description: Global skill',
      '---',
      '# Global Skill',
      '',
    ].join('\n'))
    await write(join(homeDir, '.agents', 'skills', 'agents-skill', 'SKILL.md'), '# Agents Skill\n')
    await write(join(projectRootPath, '.omp', 'skills', 'project-skill', 'SKILL.md'), '# Project Skill\n')
    await write(join(projectRootPath, '.agents', 'skills', 'project-agents-skill', 'SKILL.md'), '# Project Agents Skill\n')
    await write(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { userMcp: { command: 'node' } } }))
    await write(join(projectRootPath, '.omp', 'mcp.json'), JSON.stringify({ mcpServers: { projectMcp: { command: 'bun' } } }))
    await write(join(agentDir, 'agents', 'reviewer.md'), '# Reviewer\n')
    await write(join(projectRootPath, '.omp', 'agents', 'planner.md'), '# Planner\n')
    await write(join(agentDir, 'WATCHDOG.yml'), [
      'instructions: watch carefully',
      'advisors:',
      '  - name: Security',
      '    model: openai/security',
      '    instructions: Focus on security risks.',
      '',
    ].join('\n'))

    const state = await getOmpFeatureCenterState({
      diagnostics: diagnostics(),
      homeDir,
      agentDir,
      workspaceRootPath,
      projectRootPath,
      now: () => 2000,
    })

    const planRole = state.modelRoles.common.find(role => role.role === 'plan')
    expect(state.modelRoles.common.map(role => role.role)).toEqual(['default', 'smol', 'slow', 'plan', 'task', 'advisor'])
    expect(planRole?.effectiveValue).toBe('project/architect')
    expect(planRole?.source).toBe('project')
    expect(planRole?.projectOverridden).toBe(true)
    expect(state.advisor.enabled.effectiveValue).toBe(true)
    expect(state.advisor.enabled.source).toBe('global')
    expect(state.advisor.subagents.effectiveValue).toBe(true)
    expect(state.advisor.subagents.source).toBe('project')
    expect(state.skills.items.map(item => item.name).sort()).toEqual(['agents-skill', 'global-skill', 'project-agents-skill', 'project-skill'])
    expect(state.skills.items.find(item => item.name === 'agents-skill')?.level).toBe('user')
    expect(state.skills.items.find(item => item.name === 'project-agents-skill')?.level).toBe('project')
    expect(state.mcp.items.map(item => item.name).sort()).toEqual(['projectMcp', 'userMcp'])
    expect(state.agents.items.map(item => item.name).sort()).toEqual(['planner', 'reviewer'])
    expect(state.advisor.roster.advisors.map(advisor => ({ name: advisor.name, model: advisor.model }))).toEqual([{ name: 'Security', model: 'openai/security' }])
    expect(state.advisor.roster.editable.instructions).toBe('watch carefully')
    expect(state.advisor.roster.editable.advisors.map(advisor => advisor.name)).toEqual(['Security'])
    expect(state.advisor.roster.editable.advisors[0]?.instructions).toBe('Focus on security risks.')
    expect(state.nativePlan.modelRole).toBe('project/architect')
    expect(state.nativePlan.supportStatus).toBe('rpc-command-available')
    expect(state.nativePlan.rpcCommands).toEqual([
      'get_plan_mode_state',
      'set_plan_mode',
      'reopen_plan_review',
      'plan_review_result',
      'get_goal_state',
      'set_goal',
      'replace_goal',
      'pause_goal',
      'resume_goal',
      'drop_goal',
      'set_goal_budget',
      'guided_goal_turn',
      'get_loop_state',
      'set_loop',
    ])
    expect(state.unavailableCommands.map(command => command.command)).not.toContain('/plan')
    expect(state.unavailableCommands.map(command => command.command)).toEqual(expect.arrayContaining([
      '/advisor configure',
      '/todo edit',
      '/mcp reauth',
      '/mcp notifications',
    ]))
    expect(state.lastRefreshedAt).toBe(2000)
  })

  it('merges resources discovered by the live OMP runtime without inventing editable paths', async () => {
    const root = await makeTempRoot()
    const homeDir = join(root, 'home')
    const agentDir = join(homeDir, '.omp', 'agent')
    const projectRootPath = join(root, 'workspace')
    const codexSkillPath = join(homeDir, '.codex', 'skills', 'review', 'SKILL.md')
    await write(codexSkillPath, '# Review\n')

    const runtimeDiagnostics: OmpDiagnosticsSummary = {
      ...diagnostics(),
      runtimeResources: {
        skills: [{ name: 'review', description: 'Review changes', path: codexSkillPath, source: 'user', provider: 'codex' }],
        mcp: [{ name: 'github', source: 'native', provider: 'codex', status: 'connected', toolCount: 4 }],
        agents: [{ name: 'explore', description: 'Explore the repository', source: 'bundled', provider: 'omp' }],
      },
    }

    const state = await getOmpFeatureCenterState({
      diagnostics: runtimeDiagnostics,
      homeDir,
      agentDir,
      workspaceRootPath: projectRootPath,
      projectRootPath,
    })

    const snapshot = await getOmpResourceSnapshot({}, {
      diagnostics: runtimeDiagnostics,
      homeDir,
      agentDir,
      workspaceRootPath: projectRootPath,
      projectRootPath,
    })

    expect(state.skills.items).toContainEqual(expect.objectContaining({
      name: 'review',
      path: resolve(codexSkillPath),
      provider: 'codex',
      runtimeLoaded: true,
    }))
    expect(state.mcp.items).toContainEqual(expect.objectContaining({
      name: 'github',
      level: 'bundled',
      status: 'connected',
      toolCount: 4,
      runtimeLoaded: true,
    }))
    expect(state.agents.items).toContainEqual(expect.objectContaining({
      name: 'explore',
      level: 'bundled',
      runtimeLoaded: true,
    }))
    expect(snapshot.runtimeCounts).toEqual({ skills: 1, mcp: 1, agents: 1 })
    expect(snapshot.skills.entries).toContainEqual(expect.objectContaining({
      name: 'review',
      readOnly: true,
    }))
    expect(snapshot.mcp.entries).toContainEqual(expect.objectContaining({
      name: 'github',
      source: 'bundled',
      status: 'connected',
      readOnly: true,
    }))
    expect(snapshot.agents.entries).toContainEqual(expect.objectContaining({
      name: 'explore',
      source: 'bundled',
      readOnly: true,
    }))
  })

  it('only allows opening paths surfaced by the current Feature Center state', async () => {
    const root = await makeTempRoot()
    const agentDir = join(root, '.omp', 'agent')
    const workspaceRootPath = join(root, 'workspace')
    const projectRootPath = join(workspaceRootPath, 'project')
    const globalConfigPath = join(agentDir, 'config.yml')
    const projectConfigPath = join(projectRootPath, '.omp', 'config.yml')
    const skillPath = join(agentDir, 'skills', 'commit-helper', 'SKILL.md')
    const mcpPath = join(agentDir, 'mcp.json')
    const agentPath = join(projectRootPath, '.omp', 'agents', 'planner.md')
    const rosterPath = join(agentDir, 'WATCHDOG.yml')

    await write(globalConfigPath, 'modelRoles:\n  default: openai/gpt-5\n')
    await write(projectConfigPath, 'modelRoles:\n  plan: project/architect\n')
    await write(skillPath, '# Commit Helper\n')
    await write(mcpPath, JSON.stringify({ mcpServers: { userMcp: { command: 'node' } } }))
    await write(agentPath, '# Planner\n')
    await write(rosterPath, 'advisors:\n  - name: Security\n')
    await write(join(agentDir, 'secret.txt'), 'not surfaced\n')

    const state = await getOmpFeatureCenterState({
      diagnostics: diagnostics(),
      agentDir,
      workspaceRootPath,
      projectRootPath,
    })

    const allowed = getOmpFeatureCenterAllowedPaths(state)
    expect(allowed).toContain(resolve(globalConfigPath))
    expect(allowed).toContain(resolve(projectConfigPath))
    expect(allowed).toContain(resolve(skillPath))
    expect(allowed).toContain(resolve(mcpPath))
    expect(allowed).toContain(resolve(agentPath))
    expect(allowed).toContain(resolve(rosterPath))
    expect(allowed).toContain(resolve(state.advisor.roster.editable.path))
    expect(resolveOmpFeatureCenterAllowedPath(state, skillPath)).toBe(resolve(skillPath))
    expect(resolveOmpFeatureCenterAllowedPath(state, join(agentDir, 'secret.txt'))).toBeNull()
  })

  it('saves allowed global settings while preserving unrelated config', async () => {
    const root = await makeTempRoot()
    const agentDir = join(root, '.omp', 'agent')
    const options: OmpFeatureCenterOptions = {
      diagnostics: diagnostics(),
      agentDir,
      now: () => 3000,
    }
    await write(join(agentDir, 'config.yml'), [
      'unrelated:',
      '  keep: true',
      'modelRoles:',
      '  plan: old/plan',
      '',
    ].join('\n'))

    const result = await saveOmpFeatureCenterConfig({
      modelRoles: {
        default: 'new/default',
        plan: '',
      },
      advisor: {
        enabled: true,
        subagents: true,
      },
    }, options)

    expect(result.success).toBe(true)
    const parsed = loadYaml(await readFile(join(agentDir, 'config.yml'), 'utf-8')) as Record<string, any>
    expect(parsed.unrelated).toEqual({ keep: true })
    expect(parsed.modelRoles.default).toBe('new/default')
    expect(parsed.modelRoles.plan).toBeUndefined()
    expect(parsed.advisor).toEqual({ enabled: true, subagents: true })
    expect(result.state?.advisor.enabled.effectiveValue).toBe(true)
  })

  it('does not rewrite advisor toggles when the save payload omits them', async () => {
    const root = await makeTempRoot()
    const agentDir = join(root, '.omp', 'agent')
    const options: OmpFeatureCenterOptions = {
      diagnostics: diagnostics(),
      agentDir,
      now: () => 3500,
    }
    await write(join(agentDir, 'config.yml'), [
      'modelRoles:',
      '  default: old/default',
      '',
    ].join('\n'))

    const result = await saveOmpFeatureCenterConfig({
      modelRoles: {
        default: 'new/default',
      },
    }, options)

    expect(result.success).toBe(true)
    const parsed = loadYaml(await readFile(join(agentDir, 'config.yml'), 'utf-8')) as Record<string, any>
    expect(parsed.modelRoles.default).toBe('new/default')
    expect(parsed.advisor).toBeUndefined()
  })

  it('saves global WATCHDOG advisor roster while preserving unrelated fields', async () => {
    const root = await makeTempRoot()
    const agentDir = join(root, '.omp', 'agent')
    const watchdogPath = join(agentDir, 'WATCHDOG.yml')
    const options: OmpFeatureCenterOptions = {
      diagnostics: diagnostics(),
      agentDir,
      now: () => 4000,
    }
    await write(join(agentDir, 'config.yml'), 'modelRoles:\n  default: old/default\n')
    await write(watchdogPath, [
      'unrelated:',
      '  keep: true',
      'instructions: old instructions',
      'advisors:',
      '  - name: Old',
      '    instructions: keep me only if rewritten',
      '',
    ].join('\n'))

    const result = await saveOmpFeatureCenterConfig({
      modelRoles: { default: 'new/default' },
      advisorRoster: {
        instructions: 'review carefully',
        advisors: [
          { name: 'Security', model: 'openai/security', tools: ['read', 'bash'] },
          { name: 'Docs', model: '', tools: [], instructions: 'Check documentation drift.' },
        ],
      },
    }, options)

    expect(result.success).toBe(true)
    const parsed = loadYaml(await readFile(watchdogPath, 'utf-8')) as Record<string, any>
    expect(parsed.unrelated).toEqual({ keep: true })
    expect(parsed.instructions).toBe('review carefully')
    expect(parsed.advisors).toEqual([
      { name: 'Security', model: 'openai/security', tools: ['read', 'bash'] },
      { name: 'Docs', instructions: 'Check documentation drift.' },
    ])
    expect(result.state?.advisor.roster.editable.advisors.map(advisor => advisor.name)).toEqual(['Security', 'Docs'])
    expect(result.state?.advisor.roster.editable.advisors.find(advisor => advisor.name === 'Docs')?.instructions).toBe('Check documentation drift.')
  })

  it('does not overwrite an unparseable WATCHDOG roster', async () => {
    const root = await makeTempRoot()
    const agentDir = join(root, '.omp', 'agent')
    const watchdogPath = join(agentDir, 'WATCHDOG.yml')
    await write(join(agentDir, 'config.yml'), 'modelRoles:\n  default: old/default\n')
    await write(watchdogPath, 'advisors: [')

    const result = await saveOmpFeatureCenterConfig({
      advisorRoster: {
        advisors: [{ name: 'Security' }],
      },
    }, {
      diagnostics: diagnostics(),
      agentDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('advisor roster')
    expect(await readFile(watchdogPath, 'utf-8')).toBe('advisors: [')
  })

  it('does not overwrite an unparseable global config', async () => {
    const root = await makeTempRoot()
    const agentDir = join(root, '.omp', 'agent')
    const brokenPath = join(agentDir, 'config.yml')
    await write(brokenPath, 'modelRoles: [')

    const result = await saveOmpFeatureCenterConfig({
      modelRoles: { default: 'new/default' },
    }, {
      diagnostics: diagnostics(),
      agentDir,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('could not be parsed')
    expect(await readFile(brokenPath, 'utf-8')).toBe('modelRoles: [')
  })
})

describe('OMP resource lifecycle', () => {
  async function makeResourceRoot(): Promise<{ root: string; agentDir: string; projectRootPath: string; options: OmpFeatureCenterOptions }> {
    const root = await makeTempRoot()
    const agentDir = join(root, 'home', '.omp', 'agent')
    const workspaceRootPath = join(root, 'workspace')
    const projectRootPath = join(workspaceRootPath, 'project')
    const options: OmpFeatureCenterOptions = {
      diagnostics: diagnostics(),
      homeDir: join(root, 'home'),
      agentDir,
      workspaceRootPath,
      projectRootPath,
      now: () => 5000,
    }
    return { root, agentDir, projectRootPath, options }
  }

  function category(type: 'mcp' | 'skill' | 'agent'): 'mcp' | 'skills' | 'agents' {
    if (type === 'skill') return 'skills'
    if (type === 'agent') return 'agents'
    return 'mcp'
  }

  function findEntry(snapshot: OmpResourceSnapshot, type: 'mcp' | 'skill' | 'agent', scope: 'user' | 'project', name: string) {
    return snapshot[category(type)].entries.find((e: OmpResourceSnapshot['mcp']['entries'][number]) => e.type === type && e.scope === scope && e.name === name)
  }

  it('maps scope and source for discovered resources', async () => {
    const { agentDir, projectRootPath, options } = await makeResourceRoot()
    await write(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { userMcp: { command: 'node' } } }))
    await write(join(projectRootPath, '.omp', 'mcp.json'), JSON.stringify({ mcpServers: { projectMcp: { command: 'bun' } } }))
    await write(join(agentDir, 'skills', 'user-skill', 'SKILL.md'), '# User Skill\n')
    await write(join(projectRootPath, '.omp', 'skills', 'project-skill', 'SKILL.md'), '# Project Skill\n')
    await write(join(agentDir, 'agents', 'user-agent.md'), '# User Agent\n')
    await write(join(projectRootPath, '.omp', 'agents', 'project-agent.md'), '# Project Agent\n')

    const snapshot = await getOmpResourceSnapshot({}, options)

    const userMcp = findEntry(snapshot, 'mcp', 'user', 'userMcp')
    expect(userMcp?.source).toBe('user')
    expect(userMcp?.scope).toBe('user')

    const projectMcp = findEntry(snapshot, 'mcp', 'project', 'projectMcp')
    expect(projectMcp?.source).toBe('project')
    expect(projectMcp?.scope).toBe('project')

    const userSkill = findEntry(snapshot, 'skill', 'user', 'user-skill')
    expect(userSkill?.source).toBe('user')

    const projectSkill = findEntry(snapshot, 'skill', 'project', 'project-skill')
    expect(projectSkill?.source).toBe('project')

    const userAgent = findEntry(snapshot, 'agent', 'user', 'user-agent')
    expect(userAgent?.source).toBe('user')

    const projectAgent = findEntry(snapshot, 'agent', 'project', 'project-agent')
    expect(projectAgent?.source).toBe('project')
  })

  it('reflects enabled state from disabled lists', async () => {
    const { agentDir, projectRootPath, options } = await makeResourceRoot()
    await write(join(agentDir, 'config.yml'), [
      'disabledMcp:',
      '  - mcp/userMcp',
      'disabledSkills:',
      '  - skill/user-skill',
      'disabledAgents:',
      '  - agent/user-agent',
      '',
    ].join('\n'))
    await write(join(projectRootPath, '.omp', 'config.yml'), [
      'disabledMcp:',
      '  - mcp/projectMcp',
      '',
    ].join('\n'))
    await write(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { userMcp: { command: 'node' } } }))
    await write(join(projectRootPath, '.omp', 'mcp.json'), JSON.stringify({ mcpServers: { projectMcp: { command: 'bun' } } }))
    await write(join(agentDir, 'skills', 'user-skill', 'SKILL.md'), '# User Skill\n')
    await write(join(projectRootPath, '.omp', 'skills', 'project-skill', 'SKILL.md'), '# Project Skill\n')
    await write(join(agentDir, 'agents', 'user-agent.md'), '# User Agent\n')
    await write(join(projectRootPath, '.omp', 'agents', 'project-agent.md'), '# Project Agent\n')

    const snapshot = await getOmpResourceSnapshot({}, options)

    expect(findEntry(snapshot, 'mcp', 'user', 'userMcp')?.enabled).toBe(false)
    expect(findEntry(snapshot, 'mcp', 'user', 'userMcp')?.effectiveEnabled).toBe(false)
    expect(findEntry(snapshot, 'mcp', 'project', 'projectMcp')?.enabled).toBe(false)
    expect(findEntry(snapshot, 'skill', 'user', 'user-skill')?.enabled).toBe(false)
    expect(findEntry(snapshot, 'agent', 'user', 'user-agent')?.enabled).toBe(false)
    expect(findEntry(snapshot, 'mcp', 'project', 'projectMcp')?.effectiveEnabled).toBe(false)
    expect(findEntry(snapshot, 'skill', 'project', 'project-skill')?.enabled).toBe(true)
    expect(findEntry(snapshot, 'agent', 'project', 'project-agent')?.enabled).toBe(true)
  })

  it('creates, updates, disables, and removes an MCP server', async () => {
    const { agentDir, options } = await makeResourceRoot()

    const createResult = await createResource({
      type: 'mcp',
      scope: 'user',
      draft: { name: 'test-server', command: 'node', args: ['server.js'], env: { KEY: 'value' } },
    }, options)
    expect(createResult.success).toBe(true)
    const afterCreate = createResult.snapshot!
    const entry = findEntry(afterCreate, 'mcp', 'user', 'test-server')
    expect(entry).toBeDefined()
    expect(entry?.enabled).toBe(true)

    const mcpJson = JSON.parse(await readFile(join(agentDir, 'mcp.json'), 'utf-8'))
    expect(mcpJson.mcpServers['test-server']).toEqual({ command: 'node', args: ['server.js'], env: { KEY: 'value' } })

    const updateResult = await updateResource({
      type: 'mcp',
      id: entry!.id,
      scope: 'user',
      expectedRevision: entry!.revision,
      patch: { name: 'renamed-server', command: 'bun', args: ['index.ts'] },
    }, options)
    expect(updateResult.success).toBe(true)
    const afterUpdate = updateResult.snapshot!
    expect(findEntry(afterUpdate, 'mcp', 'user', 'test-server')).toBeUndefined()
    expect(findEntry(afterUpdate, 'mcp', 'user', 'renamed-server')).toBeDefined()
    const updatedJson = JSON.parse(await readFile(join(agentDir, 'mcp.json'), 'utf-8'))
    expect(updatedJson.mcpServers['renamed-server']).toEqual({ command: 'bun', args: ['index.ts'], env: { KEY: 'value' } })

    const renamed = findEntry(afterUpdate, 'mcp', 'user', 'renamed-server')!
    const disableResult = await setResourceEnabled({
      type: 'mcp',
      id: renamed.id,
      scope: 'user',
      expectedRevision: renamed.revision,
      enabled: false,
    }, options)
    expect(disableResult.success).toBe(true)
    expect(findEntry(disableResult.snapshot!, 'mcp', 'user', 'renamed-server')?.enabled).toBe(false)

    const config = loadYaml(await readFile(join(agentDir, 'config.yml'), 'utf-8')) as Record<string, unknown>
    expect(config.disabledMcp).toContain(renamed.id)

    const removeResult = await removeResource({
      type: 'mcp',
      id: renamed.id,
      scope: 'user',
      expectedRevision: findEntry(disableResult.snapshot!, 'mcp', 'user', 'renamed-server')!.revision,
    }, options)
    expect(removeResult.success).toBe(true)
    expect(findEntry(removeResult.snapshot!, 'mcp', 'user', 'renamed-server')).toBeUndefined()
  })

  it('creates, updates, and removes a skill', async () => {
    const { agentDir, options } = await makeResourceRoot()

    const createResult = await createResource({
      type: 'skill',
      scope: 'user',
      draft: { name: 'my-skill', description: 'Does a thing' },
    }, options)
    expect(createResult.success).toBe(true)
    const entry = findEntry(createResult.snapshot!, 'skill', 'user', 'my-skill')!
    const content = await readFile(join(agentDir, 'skills', 'my-skill', 'SKILL.md'), 'utf-8')
    expect(content).toContain('name: my-skill')
    expect(content).toContain('description: Does a thing')

    const updateResult = await updateResource({
      type: 'skill',
      id: entry.id,
      scope: 'user',
      expectedRevision: entry.revision,
      patch: { name: 'renamed-skill', description: 'Updated' },
    }, options)
    expect(updateResult.success).toBe(true)
    expect(findEntry(updateResult.snapshot!, 'skill', 'user', 'my-skill')).toBeUndefined()
    expect(findEntry(updateResult.snapshot!, 'skill', 'user', 'renamed-skill')).toBeDefined()
    const updatedContent = await readFile(join(agentDir, 'skills', 'renamed-skill', 'SKILL.md'), 'utf-8')
    expect(updatedContent).toContain('name: renamed-skill')

    const renamed = findEntry(updateResult.snapshot!, 'skill', 'user', 'renamed-skill')!
    const removeResult = await removeResource({
      type: 'skill',
      id: renamed.id,
      scope: 'user',
      expectedRevision: renamed.revision,
    }, options)
    expect(removeResult.success).toBe(true)
    expect(findEntry(removeResult.snapshot!, 'skill', 'user', 'renamed-skill')).toBeUndefined()
  })

  it('creates, updates, and removes an agent', async () => {
    const { agentDir, options } = await makeResourceRoot()

    const createResult = await createResource({
      type: 'agent',
      scope: 'user',
      draft: { name: 'my-agent', description: 'Helpful agent' },
    }, options)
    expect(createResult.success).toBe(true)
    const entry = findEntry(createResult.snapshot!, 'agent', 'user', 'my-agent')!
    const content = await readFile(join(agentDir, 'agents', 'my-agent.md'), 'utf-8')
    expect(content).toContain('name: my-agent')

    const updateResult = await updateResource({
      type: 'agent',
      id: entry.id,
      scope: 'user',
      expectedRevision: entry.revision,
      patch: { name: 'renamed-agent' },
    }, options)
    expect(updateResult.success).toBe(true)
    expect(findEntry(updateResult.snapshot!, 'agent', 'user', 'my-agent')).toBeUndefined()
    expect(findEntry(updateResult.snapshot!, 'agent', 'user', 'renamed-agent')).toBeDefined()

    const renamed = findEntry(updateResult.snapshot!, 'agent', 'user', 'renamed-agent')!
    const removeResult = await removeResource({
      type: 'agent',
      id: renamed.id,
      scope: 'user',
      expectedRevision: renamed.revision,
    }, options)
    expect(removeResult.success).toBe(true)
    expect(findEntry(removeResult.snapshot!, 'agent', 'user', 'renamed-agent')).toBeUndefined()
  })

  it('detects revision conflicts', async () => {
    const { agentDir, options } = await makeResourceRoot()
    await write(join(agentDir, 'agents', 'my-agent.md'), '# My Agent\n')

    const snapshot = await getOmpResourceSnapshot({}, options)
    const entry = findEntry(snapshot, 'agent', 'user', 'my-agent')!

    await write(join(agentDir, 'agents', 'my-agent.md'), '# Updated externally\n')

    const updateResult = await updateResource({
      type: 'agent',
      id: entry.id,
      scope: 'user',
      expectedRevision: entry.revision,
      patch: { description: 'Should fail' },
    }, options)
    expect(updateResult.success).toBe(false)
    expect(updateResult.code).toBe('REVISION_CONFLICT')
  })

  it('tests a working MCP server', async () => {
    const { agentDir, options } = await makeResourceRoot()
    const serverScript = join(agentDir, 'mcp-server.js')
    await write(serverScript, [
      'process.stdin.on("data", (data) => {',
      '  const lines = data.toString().split("\\n").filter(Boolean);',
      '  for (const line of lines) {',
      '    const msg = JSON.parse(line);',
      '    if (msg.method === "initialize") {',
      '      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1" } } }));',
      '    } else if (msg.method === "tools/list") {',
      '      console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object" } }] } }));',
      '    }',
      '  }',
      '});',
    ].join('\n'))
    await write(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { testMcp: { command: 'node', args: [serverScript] } } }))

    const result = await testMcpResource({ id: 'mcp/testMcp', scope: 'user' }, options)
    expect(result.success).toBe(true)
    expect(result.connected).toBe(true)
    expect(result.tools).toEqual([{ name: 'echo', description: 'Echo input' }])
  })

  it('reports failure for a non-existent MCP command', async () => {
    const { agentDir, options } = await makeResourceRoot()
    await write(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { badMcp: { command: 'this-command-does-not-exist-12345' } } }))

    const result = await testMcpResource({ id: 'mcp/badMcp', scope: 'user' }, options)
    expect(result.success).toBe(false)
    expect(result.connected).toBe(false)
    expect(result.code).toBe('MCP_CONNECT_FAILED')
  })

  it('refreshResources returns a snapshot', async () => {
    const { agentDir, options } = await makeResourceRoot()
    await write(join(agentDir, 'agents', 'agent-one.md'), '# One\n')

    const snapshot = await refreshResources({}, options)
    expect(snapshot.agents.entries).toHaveLength(1)
    expect(snapshot.agents.entries[0].name).toBe('agent-one')
  })
})
