import type { ElectronApplication } from '@playwright/test'
import { _electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'

const IMAGES = path.resolve('src/main/ocr/__tests__/fixtures/images')
const PORK = path.join(IMAGES, 'pork-two-column.png')
const SOUP = path.join(IMAGES, 'mexican-soup-boxed.png')

// Native OS dialogs cannot be driven by Playwright, so the picker answers for the user.
const answerNextDialogs = (app: ElectronApplication, filePaths: string[]): Promise<void> =>
  app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: picked })
  }, filePaths)

let root: string
let app: ElectronApplication

test.beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'meal-planner-e2e-'))
  // A private userData keeps the app away from the real config, and so the real vault.
  app = await _electron.launch({ args: ['.', `--user-data-dir=${path.join(root, 'userData')}`] })
})

test.afterEach(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('creates a vault, adds recipes and finds one by tag', async () => {
  test.setTimeout(180_000)
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(path.join(root, 'userData'))
  const page = await app.firstWindow()
  const cards = page.getByRole('link')

  await test.step('choose a vault folder on first run', async () => {
    await answerNextDialogs(app, [path.join(root, 'vault')])
    await page.getByRole('button', { name: 'Choose folder' }).click()
    await expect(page.getByText('Drop photos here')).toBeVisible()
  })

  await test.step('add recipe photos', async () => {
    await answerNextDialogs(app, [PORK, SOUP])
    await page.getByRole('button', { name: '+ Add Recipes' }).click()
    await expect(page.getByText('2 added', { exact: true })).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('2 recipes', { exact: true })).toBeVisible()
    await expect(cards).toHaveCount(2)
    for (const thumb of await cards.locator('img').all()) {
      await expect(thumb).not.toHaveJSProperty('naturalWidth', 0)
    }
  })

  await test.step('find a recipe by tag', async () => {
    await page.getByPlaceholder('Поиск тегов…').fill('свин')
    await page.getByRole('listitem').filter({ hasText: 'Свинина' }).click()
    await expect(page.getByText('1 recipe', { exact: true })).toBeVisible()
    await expect(cards).toHaveCount(1)
  })

  await test.step('open the recipe', async () => {
    await cards.click()
    await expect(page.locator('pre')).toContainText('свинины')
    await expect(page.getByTitle('Auto-extracted').filter({ hasText: 'Свинина' })).toBeVisible()
    await expect(page.locator('img')).not.toHaveJSProperty('naturalWidth', 0)
  })
})
