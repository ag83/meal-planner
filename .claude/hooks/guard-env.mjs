// PreToolUse hook: block the agent from reading .env files. .env.example stays readable.
import fs from 'node:fs'

const ENV_FILE = /^\.env(\.[\w.*?-]+)?[*?]*$/i
const ALLOWED = '.env.example'

const isSecretEnvFile = (token) => {
  const name = token.split(/[\\/]/).pop()
  return ENV_FILE.test(name) && name.toLowerCase() !== ALLOWED
}

// Commit messages are prose; mentioning .env in one reads nothing.
const stripProse = (command) => {
  const withoutHeredocs = command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\b/g, '$3')
  if (!/\bgit\s+(commit|tag)\b/.test(withoutHeredocs)) return withoutHeredocs
  return withoutHeredocs.replace(/(\s(?:-\w*m|--message)[\s=]*)("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1')
}

const commandReadsEnv = (command) =>
  stripProse(command)
    .split(/[\s'"`=<>|;&(),:{}[\]@]+/)
    .some(isSecretEnvFile)

const { tool_name: tool, tool_input: input = {} } = JSON.parse(fs.readFileSync(0, 'utf-8'))

const blocked =
  tool === 'Bash' || tool === 'PowerShell'
    ? commandReadsEnv(input.command ?? '')
    : [input.file_path, input.path, tool === 'Grep' ? input.glob : undefined]
        .filter(Boolean)
        .some(isSecretEnvFile)

if (blocked) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Reading .env files is blocked because they hold secrets. Use ${ALLOWED} instead.`
      }
    })
  )
}
