import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { load as loadYaml } from 'js-yaml'
import {
  getOmpFeatureCenterAllowedPaths,
  getOmpFeatureCenterState,
  resolveOmpFeatureCenterAllowedPath,
  saveOmpFeatureCenterConfig,
  type OmpFeatureCenterOptions,
} from './omp-feature-center'
import type { OmpDiagnosticsSummary } from '@craft-agent/shared/protocol'

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
    await write(join(projectRootPath, '.omp', 'skills', 'project-skill', 'SKILL.md'), '# Project Skill\n')
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
    expect(state.skills.items.map(item => item.name).sort()).toEqual(['global-skill', 'project-skill'])
    expect(state.mcp.items.map(item => item.name).sort()).toEqual(['projectMcp', 'userMcp'])
    expect(state.agents.items.map(item => item.name).sort()).toEqual(['planner', 'reviewer'])
    expect(state.advisor.roster.advisors.map(advisor => ({ name: advisor.name, model: advisor.model }))).toEqual([{ name: 'Security', model: 'openai/security' }])
    expect(state.advisor.roster.editable.instructions).toBe('watch carefully')
    expect(state.advisor.roster.editable.advisors.map(advisor => advisor.name)).toEqual(['Security'])
    expect(state.advisor.roster.editable.advisors[0]?.instructions).toBe('Focus on security risks.')
    expect(state.nativePlan.modelRole).toBe('project/architect')
    expect(state.nativePlan.supportStatus).toBe('rpc-unavailable')
    expect(state.unavailableCommands.map(command => command.command)).toContain('/plan')
    expect(state.lastRefreshedAt).toBe(2000)
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
