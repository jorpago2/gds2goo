import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
})

test('starts empty and does not fetch the large example until requested', async ({ page }) => {
  let exampleRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('universitat-valencia-logo.gds')) exampleRequests += 1
  })
  await page.goto('./')
  await expect(page.getByRole('banner')).toContainText('No file loaded')
  await expect(page.getByText('Load a GDSII file to begin.')).toHaveCount(1)
  await page.waitForTimeout(500)
  expect(exampleRequests).toBe(0)
})

test('generates the diagnostic source and exposes a cancellable worker export', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Printer orientation check' }).click()
  await expect(page.getByRole('banner')).toContainText('mars4-9k-orientation-check')
  await page.getByRole('button', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Generate .GOO' }).click()
  await page.getByRole('button', { name: 'Cancel generation' }).click({ force: true })
  await expect(page.getByRole('region', { name: 'Generation outcome' }).getByText('Mask generation cancelled. No file was generated.').first()).toBeVisible()
  await expect(page.getByText('Machine file generated')).toHaveCount(0)
})

test('keeps panel and inspector interaction keyboard-owned', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'UV logo GDS example' }).click()

  const inputTool = page.getByRole('button', { name: 'Input', exact: true })
  await page.keyboard.press('Escape')
  await expect(inputTool).toBeFocused()
  await expect(inputTool).not.toHaveAttribute('aria-current')
  await expect(inputTool).toHaveAttribute('aria-controls', 'configuration-panel')

  const preview = page.getByRole('button', { name: 'Inspect the current point at native pixel scale' })
  const zoom = page.getByRole('slider', { name: 'Zoom' })
  const zoomBeforeWheel = Number(await zoom.getAttribute('aria-valuenow'))
  await preview.hover()
  await page.mouse.wheel(0, -240)
  await expect.poll(async () => Number(await zoom.getAttribute('aria-valuenow'))).toBeGreaterThan(zoomBeforeWheel)
  await preview.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Native 1:1 inspector' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Native 1:1 inspector' })).toHaveCount(0)
  await expect(preview).toBeFocused()
})

test('renders the experimental run sheet in print media', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Printer orientation check' }).click()
  await page.emulateMedia({ media: 'print' })

  const sheet = page.locator('.print-sheet')
  await expect(sheet).toBeVisible()
  expect((await sheet.boundingBox())?.height ?? 0).toBeGreaterThan(0)
  await expect(page.getByText('LCD PREVIEW')).toBeHidden()
})

test('has no serious accessibility violations or horizontal overflow', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Printer orientation check' }).click()
  const violations = await new AxeBuilder({ page }).exclude('canvas').analyze()
  expect(violations.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${testInfo.project.name} horizontal overflow`).toBeLessThanOrEqual(1)
})
