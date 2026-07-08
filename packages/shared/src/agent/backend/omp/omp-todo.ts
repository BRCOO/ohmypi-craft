import type { OmpTodoMutationDto } from '../../../protocol/dto.ts';
import {
  parseOmpTodoPhases,
  type OmpTodoItem,
  type OmpTodoPhase,
} from './omp-rpc-protocol.ts';

export interface OmpTodoMarkdownParseIssue {
  line: number;
  message: string;
}

export interface OmpTodoMarkdownParseResult {
  phases: OmpTodoPhase[];
  errors: OmpTodoMarkdownParseIssue[];
}

export function cloneOmpTodoItem(item: OmpTodoItem): OmpTodoItem {
  return {
    content: item.content,
    status: item.status,
    details: item.details,
    notes: item.notes ? [...item.notes] : undefined,
  };
}

export function cloneOmpTodoPhases(phases: OmpTodoPhase[]): OmpTodoPhase[] {
  return phases.map((phase) => ({
    name: phase.name,
    tasks: phase.tasks.map(cloneOmpTodoItem),
  }));
}

export function normalizeOmpTodoPhases(phases: OmpTodoPhase[]): OmpTodoPhase[] {
  const parsed = parseOmpTodoPhases(phases);
  if (!parsed) throw new Error('Invalid OMP Todo snapshot');
  return cloneOmpTodoPhases(parsed);
}

function assertPhase(phases: OmpTodoPhase[], phaseIndex: number): OmpTodoPhase {
  const phase = phases[phaseIndex];
  if (!phase) throw new Error(`OMP Todo phase index ${phaseIndex} is out of range`);
  return phase;
}

function assertTask(phases: OmpTodoPhase[], phaseIndex: number, taskIndex: number): OmpTodoItem {
  const phase = assertPhase(phases, phaseIndex);
  const task = phase.tasks[taskIndex];
  if (!task) throw new Error(`OMP Todo task index ${phaseIndex}.${taskIndex} is out of range`);
  return task;
}

function cleanText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed || fallback;
}

function boundedInsertIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isInteger(index)) return length;
  return Math.max(0, Math.min(index, length));
}

function clearInProgress(phases: OmpTodoPhase[]): void {
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (task.status === 'in_progress') task.status = 'pending';
    }
  }
}

function promoteNextPending(
  phases: OmpTodoPhase[],
  preferredPhaseIndex: number,
  skippedTask?: OmpTodoItem,
): void {
  const phaseOrder = [
    preferredPhaseIndex,
    ...phases.map((_phase, index) => index).filter(index => index !== preferredPhaseIndex),
  ].filter(index => index >= 0 && index < phases.length);

  for (const phaseIndex of phaseOrder) {
    const phase = phases[phaseIndex];
    if (!phase) continue;
    const next = phase.tasks.find(task => task !== skippedTask && task.status === 'pending');
    if (next) {
      clearInProgress(phases);
      next.status = 'in_progress';
      return;
    }
  }
}

export function hasOmpTodoHiddenMetadata(phases: OmpTodoPhase[]): boolean {
  return phases.some(phase => phase.tasks.some(task =>
    (typeof task.details === 'string' && task.details.length > 0)
    || (Array.isArray(task.notes) && task.notes.length > 0),
  ));
}

export function applyOmpTodoMutation(
  currentPhases: OmpTodoPhase[],
  mutation: OmpTodoMutationDto,
): OmpTodoPhase[] {
  const phases = cloneOmpTodoPhases(currentPhases);

  switch (mutation.type) {
    case 'replace':
      return normalizeOmpTodoPhases(mutation.phases);

    case 'addPhase': {
      const index = boundedInsertIndex(mutation.index, phases.length);
      phases.splice(index, 0, { name: cleanText(mutation.name, `Phase ${phases.length + 1}`), tasks: [] });
      return phases;
    }

    case 'renamePhase': {
      assertPhase(phases, mutation.phaseIndex).name = cleanText(mutation.name, 'Untitled phase');
      return phases;
    }

    case 'removePhase': {
      const phase = assertPhase(phases, mutation.phaseIndex);
      const removedInProgress = phase.tasks.some(task => task.status === 'in_progress');
      phases.splice(mutation.phaseIndex, 1);
      if (removedInProgress) promoteNextPending(phases, mutation.phaseIndex);
      return phases;
    }

    case 'addTask': {
      const phase = assertPhase(phases, mutation.phaseIndex);
      const index = boundedInsertIndex(mutation.index, phase.tasks.length);
      phase.tasks.splice(index, 0, {
        content: cleanText(mutation.content, 'Untitled task'),
        status: 'pending',
      });
      return phases;
    }

    case 'editTask': {
      assertTask(phases, mutation.phaseIndex, mutation.taskIndex).content = cleanText(mutation.content, 'Untitled task');
      return phases;
    }

    case 'startTask': {
      const task = assertTask(phases, mutation.phaseIndex, mutation.taskIndex);
      clearInProgress(phases);
      task.status = 'in_progress';
      return phases;
    }

    case 'completeTask': {
      const task = assertTask(phases, mutation.phaseIndex, mutation.taskIndex);
      const wasInProgress = task.status === 'in_progress';
      task.status = 'completed';
      if (wasInProgress) promoteNextPending(phases, mutation.phaseIndex, task);
      return phases;
    }

    case 'abandonTask': {
      const task = assertTask(phases, mutation.phaseIndex, mutation.taskIndex);
      const wasInProgress = task.status === 'in_progress';
      task.status = 'abandoned';
      if (wasInProgress) promoteNextPending(phases, mutation.phaseIndex, task);
      return phases;
    }

    case 'reopenTask': {
      assertTask(phases, mutation.phaseIndex, mutation.taskIndex).status = 'pending';
      return phases;
    }

    case 'removeTask': {
      const phase = assertPhase(phases, mutation.phaseIndex);
      const task = assertTask(phases, mutation.phaseIndex, mutation.taskIndex);
      const wasInProgress = task.status === 'in_progress';
      phase.tasks.splice(mutation.taskIndex, 1);
      if (wasInProgress) promoteNextPending(phases, mutation.phaseIndex);
      return phases;
    }

    default: {
      const exhaustive: never = mutation;
      throw new Error(`Unsupported OMP Todo mutation: ${JSON.stringify(exhaustive)}`);
    }
  }
}

const MARKDOWN_STATUS: Record<OmpTodoItem['status'], string> = {
  pending: ' ',
  in_progress: '~',
  completed: 'x',
  abandoned: '-',
};

function statusFromMarkdownMarker(marker: string): OmpTodoItem['status'] | null {
  switch (marker.toLowerCase()) {
    case ' ':
      return 'pending';
    case '~':
      return 'in_progress';
    case 'x':
      return 'completed';
    case '-':
      return 'abandoned';
    default:
      return null;
  }
}

export function serializeOmpTodoMarkdown(phases: OmpTodoPhase[]): string {
  return cloneOmpTodoPhases(phases)
    .map((phase) => [
      `# ${phase.name}`,
      ...phase.tasks.map(task => `- [${MARKDOWN_STATUS[task.status]}] ${task.content}`),
    ].join('\n'))
    .join('\n\n');
}

export function parseOmpTodoMarkdown(markdown: string): OmpTodoMarkdownParseResult {
  const phases: OmpTodoPhase[] = [];
  const errors: OmpTodoMarkdownParseIssue[] = [];
  let current: OmpTodoPhase | null = null;

  markdown.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      current = { name: heading[2]?.trim() || `Phase ${phases.length + 1}`, tasks: [] };
      phases.push(current);
      return;
    }

    const task = /^[-*]\s+\[([ xX~-])\]\s+(.+)$/.exec(trimmed);
    if (!task) {
      errors.push({ line: lineNumber, message: 'Expected a phase heading or Todo item' });
      return;
    }

    if (!current) {
      errors.push({ line: lineNumber, message: 'Todo item must appear under a phase heading' });
      return;
    }

    const status = statusFromMarkdownMarker(task[1] ?? '');
    const content = task[2]?.trim() ?? '';
    if (!status) {
      errors.push({ line: lineNumber, message: 'Unsupported Todo marker' });
      return;
    }
    if (!content) {
      errors.push({ line: lineNumber, message: 'Todo item content cannot be empty' });
      return;
    }

    current.tasks.push({ content, status });
  });

  if (phases.length === 0 && errors.length === 0 && markdown.trim().length > 0) {
    errors.push({ line: 1, message: 'Markdown must contain at least one phase heading' });
  }

  return { phases, errors };
}
