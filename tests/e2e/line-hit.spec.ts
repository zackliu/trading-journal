import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp } from './electronApp';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-linehit-'));
}

async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  const c = page.locator('.canvas-container');
  await expect(c).toBeVisible();
  await page.waitForTimeout(300);
  const b = await c.boundingBox();
  if (!b) throw new Error('no canvas box');
  return { x: b.x, y: b.y };
}

/** A line's hit target is a band along the stroke, not its bounding box: a diagonal line no longer
 * selects the empty triangle around it. */
test('a diagonal line is selected along the stroke, not across its bounding box', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await page.getByTestId('ribbon-new').click();
  const o = await canvasOrigin(page);
  const at = (x: number, y: number): Promise<void> => page.mouse.click(o.x + x, o.y + y);

  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-line').click();
  // Draw a diagonal from lower-left to upper-right (its bounding box is the square 100,100–340,340).
  await page.mouse.move(o.x + 100, o.y + 340);
  await page.mouse.down();
  await page.mouse.move(o.x + 340, o.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('tab-annotation')).toBeVisible(); // finishing selects it

  await at(620, 340); // empty space → deselect
  await expect(page.getByTestId('tab-annotation')).toHaveCount(0);

  // A corner of the bounding box, far from the stroke — a plain box hit-test used to select here.
  await at(130, 130);
  await expect(page.getByTestId('tab-annotation')).toHaveCount(0);

  // On the stroke (near its midpoint) → selected.
  await at(220, 220);
  await expect(page.getByTestId('tab-annotation')).toBeVisible();

  await app.close();
});

test('a thin horizontal line is grabbable within a band on either side of the stroke', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await page.getByTestId('ribbon-new').click();
  const o = await canvasOrigin(page);
  const at = (x: number, y: number): Promise<void> => page.mouse.click(o.x + x, o.y + y);

  await page.getByTestId('tab-draw').click();
  await page.getByTestId('tool-line').click();
  // A near-zero-height horizontal line at y=360 (its bounding box is a sliver ~strokeWidth tall).
  await page.mouse.move(o.x + 100, o.y + 360);
  await page.mouse.down();
  await page.mouse.move(o.x + 360, o.y + 360, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('tab-annotation')).toBeVisible();

  await at(620, 200); // deselect
  await expect(page.getByTestId('tab-annotation')).toHaveCount(0);

  // A few px above the stroke (inside the band) → selected, even though the box is a sliver.
  await at(230, 356);
  await expect(page.getByTestId('tab-annotation')).toBeVisible();

  await at(620, 200); // deselect again
  await expect(page.getByTestId('tab-annotation')).toHaveCount(0);

  // Well below the stroke (outside the band) → not selected (a line is not a filled box).
  await at(230, 388);
  await expect(page.getByTestId('tab-annotation')).toHaveCount(0);

  await app.close();
});
