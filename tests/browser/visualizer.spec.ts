import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await expect(page.getByRole('button', { name: 'Record run', exact: true })).toBeEnabled();
}
async function record(page: Page) {
  await ready(page);
  await page.getByRole('button', { name: 'Record run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).not.toBeVisible();
  await expect(page.getByRole('status')).toBeVisible();
}
async function paste(page: Page, source: string) {
  const editor = page.getByRole('textbox', { name: 'Python code' });
  await editor.fill(source);
  await ready(page);
}

test('real browser runtime, precise stepping, editable pointer bindings, and keyboard playback', async ({ page }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/')) externalRequests.push(request.url()); });
  await page.goto('/');
  await record(page);
  await expect(page.getByTestId('array-cell')).toHaveText(['5', '6', '7', '1', '2', '3', '4']);
  await expect(page.locator('.event-label')).toHaveText('Before line 5');
  await expect(page.locator('.execution-line')).toHaveText('    if not array:');
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.locator('.pointer-tag')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.locator('.pointer-tag')).toHaveCount(3);
  await page.getByText('Index pointers', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'mid', exact: true }).uncheck();
  await expect(page.locator('.pointer-tag')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'mid', exact: true }).check();
  await page.getByText('Index pointers', { exact: true }).click();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Returned 2');
  await page.getByRole('button', { name: 'First step', exact: true }).click();
  await page.locator('h1').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.step-badge')).toContainText('Step 2 /');
  await page.getByLabel('Playback speed').selectOption('8');
  await page.getByRole('button', { name: 'Play recording' }).click();
  await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await page.getByLabel('Input array').fill('[1, 2, 3]');
  await expect(page.getByTestId('array-cell')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play recording' })).toBeDisabled();
  await record(page);
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Returned 2');
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('mutation replay restores the original array and editing source clears results', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByLabel('Load an example').selectOption('reverse');
  await record(page);
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.getByTestId('array-cell')).toHaveText(['9', '1', '6', '2', '8']);
  await page.getByRole('button', { name: 'First step', exact: true }).click();
  await expect(page.getByTestId('array-cell')).toHaveText(['8', '2', '6', '1', '9']);
  await paste(page, 'def example(array):\n    return len(array)\n');
  await expect(page.getByTestId('array-cell')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next step', exact: true })).toBeDisabled();
});

test('helper dropdown, recursive frames, array switching, and return values', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByLabel('Load an example').selectOption('merge');
  await record(page);
  await expect(page.getByLabel('Entry function').locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Returned [1, 2, 3, 5, 6, 7]');
  await page.getByRole('button', { name: 'First step', exact: true }).click();
  // Enter the first recursive call, then inspect its caller without changing the execution line.
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.locator('.stack-frame')).toHaveCount(2);
  await expect(page.getByTestId('array-cell')).toHaveText(['7', '2', '5']);
  const line = await page.locator('.event-label').textContent();
  await page.locator('.stack-frame').first().click();
  await expect(page.getByTestId('array-cell')).toHaveText(['7', '2', '5', '1', '6', '3']);
  await expect(page.locator('.event-label')).toHaveText(line!);
});

test('runtime errors retain a replayable prefix', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByLabel('Input array').fill('[]');
  await record(page);
  await expect(page.getByRole('status')).toContainText('Incomplete recording');
  await expect(page.getByRole('status')).toContainText('array must not be empty');
  await expect(page.getByRole('button', { name: 'Play recording' })).toBeEnabled();
  await page.getByRole('button', { name: 'Last captured step' }).click();
  await expect(page.getByTestId('array-cell')).toHaveCount(0);
});

test('Python step limit and hard watchdog preserve recordings', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await paste(page, 'def endless(array):\n    i = 0\n    while True:\n        i += 1\n');
  await record(page);
  await expect(page.getByRole('status')).toContainText('limit reached');
  await expect(page.getByRole('button', { name: 'Play recording' })).toBeEnabled();
  // sum(range(...)) blocks inside native code, where Python line tracing cannot interrupt it.
  await paste(page, 'def blocked(array):\n    return sum(range(10**12))\n');
  await record(page);
  await expect(page.getByRole('status')).toContainText('5 seconds');
  await expect(page.getByRole('button', { name: 'Play recording' })).toBeEnabled();
});

test('Stop remains responsive during native Python work and another run can succeed', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await paste(page, 'def blocked(array):\n    return sum(range(10**12))\n');
  await page.getByRole('button', { name: 'Record run', exact: true }).click();
  await expect(page.locator('.run-hint')).toContainText('steps captured');
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('status')).toContainText('Recording stopped');
  await expect(page.getByRole('button', { name: 'Play recording' })).toBeEnabled();
  await paste(page, 'def recovered(array):\n    return len(array)\n');
  await record(page);
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Returned 7');
});

test('new cells, overlapping pointers, boundary values, and auxiliary arrays', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await paste(page, 'def grow(array):\n    i = 0\n    j = 0\n    array.append(9)\n    i = -2\n    j = 10**20\n    other = array[::-1]\n    return other\n');
  await record(page);
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.locator('.array-slot').filter({ has: page.locator('.pointer-tag') }).first().locator('.pointer-tag')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.getByTestId('array-cell').last()).toHaveText('9');
  await expect(page.getByTestId('array-cell').last()).toHaveClass(/cell-changed/);
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.locator('.array-slot.boundary .pointer-tag')).toHaveCount(2);
  await expect(page.locator('.pointer-tag').first()).toContainText('-2');
  await expect(page.locator('.pointer-tag').last()).toHaveAttribute('title', 'j = 100000000000000000000');
  await page.getByLabel('Displayed array').selectOption('other');
  await expect(page.getByTestId('array-cell')).toHaveText(['9', '4', '3', '2', '1', '7', '6', '5']);
});

test('editing during execution discards old worker responses', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await paste(page, 'def blocked(array):\n    return sum(range(10**12))\n');
  await page.getByRole('button', { name: 'Record run', exact: true }).click();
  await expect(page.locator('.run-hint')).toContainText('steps captured');
  await paste(page, 'def replacement(array):\n    return 42\n');
  await expect(page.getByRole('status')).not.toBeVisible();
  await expect(page.getByTestId('array-cell')).toHaveCount(0);
  await record(page);
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Returned 42');
});

test('additional arguments, validation, and multiple-function selection', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByLabel('Load an example').selectOption('binary');
  await record(page);
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Returned 4');
  await page.getByLabel('Input target').fill('not JSON');
  await record(page);
  await expect(page.getByRole('status')).toContainText("Input 'target' must be valid JSON");
  await expect(page.getByRole('button', { name: 'Play recording' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Python code' }).fill('def first(array):\n    return 1\n\ndef second(array):\n    return 2\n');
  await expect(page.getByLabel('Entry function')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Record run', exact: true })).toBeDisabled();
  await page.getByLabel('Entry function').selectOption('second');
  await record(page);
  await page.getByRole('button', { name: 'Last step', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Returned 2');
  await paste(page, 'def index_first(i, array):\n    return array[i]\n');
  await page.getByLabel('Input i').fill('0');
  await page.getByLabel('Input array').fill('[2, 4]');
  await record(page);
  await expect(page.locator('.pointer-tag')).toHaveText(['i']);
});

test('draft reload and narrow layout remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await ready(page);
  await page.getByLabel('Input array').fill('[3, 4, 1, 2]');
  await page.waitForTimeout(400);
  await page.reload();
  await ready(page);
  await expect(page.getByLabel('Input array')).toHaveValue('[3, 4, 1, 2]');
  await record(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
});
