import { describe, expect, it } from 'bun:test';

import {
  applyOmpTodoMutation,
  hasOmpTodoHiddenMetadata,
  parseOmpTodoMarkdown,
  serializeOmpTodoMarkdown,
} from '../omp-todo.ts';
import type { OmpTodoPhase } from '../omp-rpc-protocol.ts';

const phases: OmpTodoPhase[] = [
  {
    name: 'Phase A',
    tasks: [
      { content: 'current', status: 'in_progress', details: 'd', notes: ['n'] },
      { content: 'next', status: 'pending' },
      { content: 'done', status: 'completed' },
    ],
  },
  {
    name: 'Phase B',
    tasks: [
      { content: 'later', status: 'pending' },
    ],
  },
];

describe('OMP Todo reducer', () => {
  it('starts one task and demotes the previous in-progress task', () => {
    const next = applyOmpTodoMutation(phases, {
      type: 'startTask',
      phaseIndex: 1,
      taskIndex: 0,
    });
    expect(next[0]!.tasks[0]!.status).toBe('pending');
    expect(next[1]!.tasks[0]!.status).toBe('in_progress');
    expect(phases[0]!.tasks[0]!.status).toBe('in_progress');
  });

  it('completes or drops the current task and promotes the next pending task', () => {
    const completed = applyOmpTodoMutation(phases, {
      type: 'completeTask',
      phaseIndex: 0,
      taskIndex: 0,
    });
    expect(completed[0]!.tasks[0]!.status).toBe('completed');
    expect(completed[0]!.tasks[1]!.status).toBe('in_progress');

    const dropped = applyOmpTodoMutation([
      {
        name: 'Only',
        tasks: [
          { content: 'now', status: 'in_progress' },
        ],
      },
      {
        name: 'Later',
        tasks: [
          { content: 'next phase', status: 'pending' },
        ],
      },
    ], {
      type: 'abandonTask',
      phaseIndex: 0,
      taskIndex: 0,
    });
    expect(dropped[0]!.tasks[0]!.status).toBe('abandoned');
    expect(dropped[1]!.tasks[0]!.status).toBe('in_progress');
  });

  it('preserves hidden metadata through unrelated mutations', () => {
    const next = applyOmpTodoMutation(phases, {
      type: 'editTask',
      phaseIndex: 0,
      taskIndex: 1,
      content: 'renamed',
    });
    expect(next[0]!.tasks[0]).toEqual(phases[0]!.tasks[0]);
    expect(hasOmpTodoHiddenMetadata(next)).toBe(true);
  });

  it('adds, renames, removes, and reopens Todos', () => {
    let next = applyOmpTodoMutation([], { type: 'addPhase', name: 'Draft' });
    next = applyOmpTodoMutation(next, { type: 'addTask', phaseIndex: 0, content: 'one' });
    next = applyOmpTodoMutation(next, { type: 'completeTask', phaseIndex: 0, taskIndex: 0 });
    next = applyOmpTodoMutation(next, { type: 'reopenTask', phaseIndex: 0, taskIndex: 0 });
    next = applyOmpTodoMutation(next, { type: 'renamePhase', phaseIndex: 0, name: 'Final' });
    expect(next).toEqual([{ name: 'Final', tasks: [{ content: 'one', status: 'pending' }] }]);

    next = applyOmpTodoMutation(next, { type: 'removeTask', phaseIndex: 0, taskIndex: 0 });
    next = applyOmpTodoMutation(next, { type: 'removePhase', phaseIndex: 0 });
    expect(next).toEqual([]);
  });
});

describe('OMP Todo Markdown', () => {
  it('serializes and parses deterministic phased Markdown', () => {
    const markdown = serializeOmpTodoMarkdown(phases);
    expect(markdown).toBe([
      '# Phase A',
      '- [~] current',
      '- [ ] next',
      '- [x] done',
      '',
      '# Phase B',
      '- [ ] later',
    ].join('\n'));
    expect(parseOmpTodoMarkdown(markdown)).toEqual({
      phases: [
        {
          name: 'Phase A',
          tasks: [
            { content: 'current', status: 'in_progress' },
            { content: 'next', status: 'pending' },
            { content: 'done', status: 'completed' },
          ],
        },
        {
          name: 'Phase B',
          tasks: [{ content: 'later', status: 'pending' }],
        },
      ],
      errors: [],
    });
  });

  it('reports line-specific Markdown errors without mutating', () => {
    expect(parseOmpTodoMarkdown('- [ ] orphan')).toEqual({
      phases: [],
      errors: [{ line: 1, message: 'Todo item must appear under a phase heading' }],
    });
    expect(parseOmpTodoMarkdown('# Phase\nnot a task').errors).toEqual([
      { line: 2, message: 'Expected a phase heading or Todo item' },
    ]);
  });
});
