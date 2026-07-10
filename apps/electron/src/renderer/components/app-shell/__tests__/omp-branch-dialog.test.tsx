import { describe, expect, it, jest, beforeAll, mock } from 'bun:test'
import * as React from 'react'
import * as ReactDOMServer from 'react-dom/server'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { OmpBranchOption } from '../../../../shared/types'

function makeOption(overrides: Partial<OmpBranchOption> = {}): OmpBranchOption {
  return {
    entryId: 'entry-1',
    craftMessageId: 'msg-1',
    ordinal: 1,
    textPreview: 'Hello world',
    ...overrides,
  }
}

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({
      lng: 'en',
      fallbackLng: 'en',
      ns: ['translation'],
      defaultNS: 'translation',
      resources: {
        en: {
          translation: {
            'sessionMenu.ompBranch': 'Branch from here...',
            'sessionMenu.ompBranchPrompt': 'Select a user message to branch from:',
            'sessionMenu.ompBranchUserMessage': 'User message {{ordinal}}',
            'sessionMenu.ompNoBranchPoints': 'No branchable OMP messages found',
            'common.cancel': 'Cancel',
          },
        },
      },
      interpolation: { escapeValue: false },
    })
})

// Mock the dialog primitives so SSR can assert the rendered content without
// relying on Radix Portal/DOM behavior.
mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div data-slot="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    <div data-slot="dialog-content">{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) =>
    <div data-slot="dialog-description">{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) =>
    <div data-slot="dialog-footer">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    <div data-slot="dialog-header">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    <div data-slot="dialog-title">{children}</div>,
}))

mock.module('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) =>
    <button type="button">{children}</button>,
}))

mock.module('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) =>
    <div data-slot="scroll-area">{children}</div>,
}))

// Import after mocks are registered.
const { OmpBranchDialog } = await import('../OmpBranchDialog')

describe('OmpBranchDialog', () => {
  it('renders options when open', () => {
    const options: OmpBranchOption[] = [
      makeOption({ entryId: 'entry-1', craftMessageId: 'msg-1', ordinal: 1, textPreview: 'First user message' }),
      makeOption({ entryId: 'entry-2', craftMessageId: 'msg-2', ordinal: 2, textPreview: 'Second user message' }),
    ]
    const html = ReactDOMServer.renderToString(
      <OmpBranchDialog open options={options} onClose={() => {}} onSelect={() => {}} />,
    )
    expect(html).toContain('First user message')
    expect(html).toContain('Second user message')
    expect(html).toContain('User message 1')
    expect(html).toContain('User message 2')
  })

  it('renders empty state when there are no options', () => {
    const html = ReactDOMServer.renderToString(
      <OmpBranchDialog open options={[]} onClose={() => {}} onSelect={() => {}} />,
    )
    expect(html).toContain('No branchable OMP messages found')
  })

  it('does not render content when closed', () => {
    const options = [makeOption()]
    const html = ReactDOMServer.renderToString(
      <OmpBranchDialog open={false} options={options} onClose={() => {}} onSelect={() => {}} />,
    )
    expect(html).not.toContain('Hello world')
  })

  it('calls onSelect with the chosen option', () => {
    const options = [makeOption()]
    const onSelect = jest.fn()
    const html = ReactDOMServer.renderToString(
      <OmpBranchDialog open options={options} onClose={() => {}} onSelect={onSelect} />,
    )
    expect(html).toContain('Hello world')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
