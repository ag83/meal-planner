// PreToolUse hook: force a confirmation prompt before commands that destroy the vault database.
import fs from 'node:fs'

const DIRECT = [
  /\bdrop\s+(table|database|index|view|trigger)\b/i,
  /\bdelete\s+from\s+\w+/i,
  /\btruncate\s+(table\s+)?\w+/i,
  /\b(rm|del|erase|unlink|Remove-Item|rmdir)\b[^|;&\n]*meal-planner\.db/i,
  /\bfs\.(rm|rmSync|unlink|unlinkSync)\b[^\n]*\.db\b/i
]

const INDIRECT = [/\bclear-data\b/i, /scripts[\/]+clear-data/i]

const scriptsCallingClearData = (command) => {
  try {
    const { scripts = {} } = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
    const names = Object.entries(scripts)
      .filter(([, body]) => /clear-data/.test(body))
      .map(([name]) => name)
    return names.some((n) => new RegExp(`\b(npm|pnpm|yarn)\s+(run\s+)?${n}\b`).test(command))
  } catch {
    return false
  }
}

const input = JSON.parse(fs.readFileSync(0, 'utf-8'))
const command = input.tool_input?.command ?? ''

let reason = null
if (DIRECT.some((r) => r.test(command))) reason = 'direct database drop/delete command'
else if (INDIRECT.some((r) => r.test(command)) || scriptsCallingClearData(command))
  reason = 'npm/node command that wipes the vault database (clear-data)'

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
