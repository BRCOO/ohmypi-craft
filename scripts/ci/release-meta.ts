#!/usr/bin/env bun
/**
 * Compute release workflow metadata for GitHub Actions prepare job.
 *
 * Writes key=value pairs to GITHUB_OUTPUT when present, and always prints JSON.
 *
 * Env (GitHub Actions):
 *   GITHUB_REF, GITHUB_SHA, GITHUB_EVENT_NAME
 *   INPUT_RELEASE_TAG — workflow_dispatch input
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readPinnedTag } from './fetch-omp-runtime'

const ROOT = resolve(import.meta.dir, '..', '..')
const APP_PACKAGE = join(ROOT, 'apps', 'electron', 'package.json')

export interface ReleaseMeta {
  version: string
  commit: string
  short_sha: string
  is_release: boolean
  tag_name: string
  trigger: string
  omp_tag: string
  ref: string
}

export function readAppVersion(packagePath = APP_PACKAGE): string {
  const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version?: string }
  if (!pkg.version) throw new Error(`Missing version in ${packagePath}`)
  return pkg.version
}

export function normalizeReleaseTag(tag: string): string {
  const trimmed = tag.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`
}

export function versionFromTag(tag: string): string {
  const normalized = normalizeReleaseTag(tag)
  if (!normalized.startsWith('v')) {
    throw new Error(`Invalid release tag "${tag}"; expected vX.Y.Z`)
  }
  return normalized.slice(1)
}

export function computeReleaseMeta(env: NodeJS.ProcessEnv = process.env): ReleaseMeta {
  const version = readAppVersion()
  const commit = (env.GITHUB_SHA || env.GIT_COMMIT || 'unknown').trim()
  const short_sha = commit === 'unknown' ? 'unknown' : commit.slice(0, 12)
  const ref = (env.GITHUB_REF || '').trim()
  const eventName = (env.GITHUB_EVENT_NAME || 'local').trim()
  const dispatchTag = normalizeReleaseTag(env.INPUT_RELEASE_TAG || env.RELEASE_TAG || '')

  let tag_name = ''
  let is_release = false

  if (ref.startsWith('refs/tags/')) {
    tag_name = normalizeReleaseTag(ref.slice('refs/tags/'.length))
    is_release = tag_name.startsWith('v')
  } else if (eventName === 'workflow_dispatch' && dispatchTag) {
    tag_name = dispatchTag
    is_release = true
  }

  if (is_release) {
    const tagVersion = versionFromTag(tag_name)
    if (tagVersion !== version) {
      throw new Error(
        `Release tag ${tag_name} does not match apps/electron version ${version}. ` +
          `Bump the package version or retag.`,
      )
    }
  }

  const omp_tag = readPinnedTag()

  return {
    version,
    commit,
    short_sha,
    is_release,
    tag_name,
    trigger: eventName,
    omp_tag,
    ref: ref || 'local',
  }
}

function writeGithubOutput(meta: ReleaseMeta): void {
  const outPath = process.env.GITHUB_OUTPUT
  if (!outPath) return
  const lines = [
    `version=${meta.version}`,
    `commit=${meta.commit}`,
    `short_sha=${meta.short_sha}`,
    `is_release=${meta.is_release}`,
    `tag_name=${meta.tag_name}`,
    `trigger=${meta.trigger}`,
    `omp_tag=${meta.omp_tag}`,
    `ref=${meta.ref}`,
  ]
  appendFileSync(outPath, `${lines.join('\n')}\n`, 'utf-8')
}

function writeSummary(meta: ReleaseMeta): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  const body = [
    '## Release prepare',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Trigger | \`${meta.trigger}\` |`,
    `| Ref | \`${meta.ref}\` |`,
    `| Commit | \`${meta.short_sha}\` |`,
    `| App version | \`${meta.version}\` |`,
    `| Release | ${meta.is_release ? `yes (${meta.tag_name})` : 'no (artifacts only)'} |`,
    `| OMP runtime pin | \`${meta.omp_tag}\` |`,
    '',
  ].join('\n')
  appendFileSync(summaryPath, body, 'utf-8')
}

function main(): void {
  if (!existsSync(APP_PACKAGE)) {
    throw new Error(`App package not found: ${APP_PACKAGE}`)
  }
  const meta = computeReleaseMeta()
  writeGithubOutput(meta)
  writeSummary(meta)
  console.log(JSON.stringify(meta, null, 2))
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
