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
  const cancellation = page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Cancel generation')
    if (!(button instanceof HTMLButtonElement)) return false
    button.click()
    return true
  }, undefined, { polling: 10 })
  await page.getByRole('button', { name: 'Generate .GOO' }).click()
  await cancellation
  await expect(page.getByRole('region', { name: 'Generation outcome' }).getByText('Mask generation cancelled. No file was generated.').first()).toBeVisible()
  await expect(page.getByText('Machine file generated')).toHaveCount(0)
})

test('has no serious accessibility violations or horizontal overflow', async ({ page }, testInfo) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Printer orientation check' }).click()
  const violations = await new AxeBuilder({ page }).exclude('canvas').analyze()
  expect(violations.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${testInfo.project.name} horizontal overflow`).toBeLessThanOrEqual(1)
})
