const TEST_MODULES = [
  'apps.electron.resources.scripts.tests.test_pdf_tool_smoke',
  'apps.electron.resources.scripts.tests.test_xlsx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_docx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_pptx_tool_smoke',
  'apps.electron.resources.scripts.tests.test_img_tool_smoke',
  'apps.electron.resources.scripts.tests.test_ical_tool_smoke',
  'apps.electron.resources.scripts.tests.test_doc_diff_smoke',
  'apps.electron.resources.scripts.tests.test_markitdown_smoke',
]

function resolvePythonCommand(): string[] {
  if (process.platform === 'win32') {
    const pyLauncher = Bun.which('py')
    if (pyLauncher) return [pyLauncher, '-3']
  }

  const python3 = Bun.which('python3')
  if (python3) return [python3]

  const python = Bun.which('python')
  if (python) return [python]

  throw new Error('Python not found. Install Python 3.12+ or ensure py/python3/python is on PATH.')
}

const python = resolvePythonCommand()
const cmd = [...python, '-m', 'unittest', ...TEST_MODULES]

console.log(`> ${cmd.join(' ')}`)

const proc = Bun.spawn({
  cmd,
  stdout: 'inherit',
  stderr: 'inherit',
})

const exitCode = await proc.exited
process.exit(exitCode)
