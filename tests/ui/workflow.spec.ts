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

test('ignores a structurally invalid autosave draft', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('gds2goo:session', JSON.stringify({
      format: 'scientific-ui/autosave@1',
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      data: { sourceInfo: { kind: 'gds', name: 'broken.gds' } },
    }))
  })
  await page.goto('./')
  await expect(page.getByRole('complementary', { name: 'Session recovery' })).toHaveCount(0)
  await expect(page.getByRole('banner')).toContainText('No file loaded')
})

test('keeps the active session when an invalid GDS replaces it', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Printer orientation check' }).click()
  await expect(page.getByRole('banner')).toContainText('mars4-9k-orientation-check')

  await page.locator('#gds-file').setInputFiles({
    name: 'invalid.gds',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0, 1, 2, 3]),
  })

  await expect(page.getByText(/The previous session was kept\./).first()).toHaveCount(1)
  await expect(page.getByRole('banner')).toContainText('mars4-9k-orientation-check')
})

test('marks the export state as modified after a current export is edited', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Printer orientation check' }).click()
  await page.getByRole('button', { name: 'Review' }).click()
  const outcome = page.getByRole('region', { name: 'Generation outcome' })
  await expect(outcome).toContainText('Ready to generate')
  await outcome.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Verification PNG' }).click()
  await expect(page.getByRole('banner')).toContainText('Export current')

  await page.getByRole('button', { name: 'Layout' }).click()
  await page.getByRole('button', { name: /Mirror X/ }).click()
  await expect(page.getByRole('banner')).toContainText('Modified')
})

test('does not partially apply an incompatible run manifest', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Printer orientation check' }).click()
  await page.locator('#run-file').setInputFiles({
    name: 'invalid.run.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      schema: 'gds2goo-run-manifest/v1',
      source: { kind: 'generated-diagnostic', name: 'should-not-replace-current', sizeBytes: null, sha256: null },
      printer: { model: 'Elegoo Mars 4 9K', lcdPixels: [8520, 4320] },
      mask: {
        topCell: null,
        selectedLayers: [999],
        placement: { anchor: 'center', anchorXMicrometers: 0, anchorYMicrometers: 0, rotationDegrees: 0, mirrorX: false, mirrorY: false },
        polarity: 'exposed-geometry',
      },
      exposuresSeconds: [9],
    })),
  })
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('None of the manifest layers exist in the selected source.')).toBeVisible()
  await expect(page.getByRole('banner')).toContainText('mars4-9k-orientation-check')
  await expect(page.getByRole('banner')).not.toContainText('should-not-replace-current')
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
  await expect(page.locator('.scientific-inspector .cds--modal-close-button .cds--popover')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Native 1:1 inspector' })).toHaveCount(0)
  await expect(preview).toBeFocused()
})

test('closes configuration completely and resets panel scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 })
  await page.goto('./')
  await page.getByRole('button', { name: 'UV logo GDS example' }).click()

  await page.getByRole('button', { name: 'Layout' }).click()
  await page.getByRole('button', { name: 'Step-and-repeat' }).click()
  const panelBody = page.locator('.scientific-task-panel__body')
  await panelBody.evaluate((element) => { element.scrollTop = element.scrollHeight })
  expect(await panelBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden')

  await page.getByRole('button', { name: 'Process', exact: true }).click()
  expect(await panelBody.evaluate((element) => element.scrollTop)).toBe(0)

  await page.setViewportSize({ width: 768, height: 1024 })
  await page.getByRole('button', { name: 'Process', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Configuration' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Configuration tools' })).toBeVisible()
})

test('keeps dynamic controls inside the fullscreen viewer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('./')
  await page.getByRole('button', { name: 'UV logo GDS example' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.locator('label[for="resist-response"]').click()
  await page.getByRole('button', { name: 'Full screen' }).click()

  const fullscreenViewer = page.locator('.preview-panel:fullscreen')
  await expect(fullscreenViewer).toBeVisible()
  expect(await fullscreenViewer.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const saveCalibration = page.getByRole('button', { name: 'Save calibration' })
  const rightEdge = await saveCalibration.evaluate((element) => element.getBoundingClientRect().right)
  expect(rightEdge).toBeLessThanOrEqual(1440)
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
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('./')
  await page.getByRole('button', { name: 'Printer orientation check' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  const violations = await new AxeBuilder({ page }).exclude('canvas').analyze()
  expect(violations.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${testInfo.project.name} horizontal overflow`).toBeLessThanOrEqual(1)
  const sliderTrackWidth = await page.locator('.zoom-control .cds--slider').evaluate((element) => element.getBoundingClientRect().width)
  expect(sliderTrackWidth, `${testInfo.project.name} zoom track width`).toBeGreaterThanOrEqual(48)
  await expect(page.getByRole('complementary', { name: 'Session recovery' })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
