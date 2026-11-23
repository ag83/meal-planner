// PreToolUse hook: force a confirmation prompt before commands that destroy the vault database.
// Only the command being executed is inspected, never text inside other commands' arguments
// (a commit message or grep pattern mentioning "clear-data" must not trigger it).
import fs from 'node:fs'

const SQL_DESTRUCTIVE =
  /\b(drop\s+(table|database|index|view|trigger)|delete\s+from|truncate\s+table)\b/i

const clearDataScriptNames = () => {
  try {
    const { scripts = {} } = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
    return Object.entries(scripts)
      .filter(([, body]) => /clear-data/.test(body))
      .map(([name]) => name)
  } catch {
    return ['clear-data']
  }
}

const classify = (segment) => {
  const s = segment.trim()

  const runner = s.match(/^(?:npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?([\w:.-]+)/i)
  if (runner && clearDataScriptNames().includes(runner[1]))
    return 'npm script that wipes the vault database (clear-data)'
  if (/^(?:node|npx)\s+\S*clear-data(?:\.mjs)?\b/i.test(s))
    return 'script that wipes the vault database (clear-data)'

  if (/^(?:rm|del|erase|unlink|rmdir|Remove-Item)\b.*meal-planner\.db/i.test(s))
    return 'removal of the vault database file'
  if (/^(?:sqlite3?|litecli|duckdb)\b/i.test(s) && SQL_DESTRUCTIVE.test(s))
    return 'destructive SQL via a database CLI'
  if (
    /^node\s+(?:-e|--eval|-p)\b/i.test(s) &&
    (SQL_DESTRUCTIVE.test(s) || /\bfs\.(?:rm|unlink)\w*\([^)]*\.db/i.test(s))
  )
    return 'inline script that drops or deletes database data'
  return null
}

const input = JSON.parse(fs.readFileSync(0, 'utf-8'))
const command = input.tool_input?.command ?? ''

const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g
const withoutHeredocs = command.replace(HEREDOC, '')

const reason = withoutHeredocs
  .split(/&&|\|\||[;|\n]/)
  .map(classify)
  .find(Boolean)

if (reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `Destructive DB operation: ${reason}. Confirm before running.`
      }
    })
  )
}
