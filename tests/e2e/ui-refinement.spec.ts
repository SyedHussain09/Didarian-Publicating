import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Browser-only sample responses; never insert demonstration articles into the backend.
const articles = Array.from({ length: 9 }, (_, index) => ({
  id: `article-${index + 1}`,
  slug: `sample-research-${index + 1}`,
  title:
    index % 2
      ? `Exploring cellular resilience in changing environments ${index + 1}`
      : `Rethinking clean energy systems for growing cities ${index + 1}`,
  abstract: 'This browser-test article examines an interdisciplinary approach to research. '.repeat(
    20,
  ),
  author_names: 'Example Researcher, Example Collaborator',
  category: index % 2 ? 'Biology' : 'Engineering',
  keywords: ['Research', 'Test sample'],
  published_at: '2026-09-28T10:00:00Z',
}));

async function sampleLibrary(page: Page) {
  await page.route('**/rest/v1/articles?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('slug'))
      return route.fulfill({
        json: articles.find((article) => `eq.${article.slug}` === params.get('slug')) || null,
      });
    let rows = articles;
    if (params.has('category'))
      rows = rows.filter((article) => `eq.${article.category}` === params.get('category'));
    if (params.has('title')) {
      const term = params
        .get('title')!
        .replace(/^ilike\.%|%$/g, '')
        .toLowerCase();
      rows = rows.filter((article) => article.title.toLowerCase().includes(term));
    }
    const start = Number(params.get('offset') || 0);
    const limit = Number(params.get('limit') || 4);
    return route.fulfill({
      headers: {
        'access-control-expose-headers': 'content-range',
        'content-range': `${start}-${Math.min(start + limit, rows.length) - 1}/${rows.length}`,
      },
      json: rows.slice(start, start + limit),
    });
  });
}

test('homepage is the paginated article library and filters survive navigation', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await sampleLibrary(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Latest articles' })).toBeVisible();
  await expect(page.locator('.article-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('.article-card').first()).toContainText('cities 5');
  await page.getByLabel('Search article titles').fill('energy');
  await page.getByLabel('Research discipline').selectOption('Engineering');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByText('5 articles', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.article-card')).toHaveCount(1);
  await expect(page).toHaveURL(/q=energy&category=Engineering&page=2/);
  await page.reload();
  await expect(page.getByLabel('Research discipline')).toHaveValue('Engineering');
  await expect(page.locator('.article-card')).toHaveCount(1);
  await page.locator('.article-card a').click();
  await expect(page.getByRole('heading', { name: 'Abstract', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Read full abstract' }).click();
  await expect(page.getByRole('button', { name: 'Show less' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.goBack();
  await expect(page).toHaveURL(/q=energy&category=Engineering&page=2/);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('9 articles', { exact: true })).toBeVisible();
  await expect(page.locator('.article-card')).toHaveCount(4);
});

test('empty and invalid library pages offer recovery without fabricated articles', async ({
  page,
}) => {
  await sampleLibrary(page);
  await page.goto('/?page=999');
  await expect(page.getByRole('heading', { name: 'No articles on this page' })).toBeVisible();
  await page.getByRole('button', { name: 'First page', exact: true }).click();
  await expect(page.locator('.article-card')).toHaveCount(4);
  await page.getByLabel('Search article titles').fill('unmatched-title');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching articles' })).toBeVisible();
  await page.getByRole('button', { name: 'View all articles' }).click();
  await expect(page.locator('.article-card')).toHaveCount(4);
});

for (const width of [390, 1440]) {
  test(`compact public pages and sample articles at ${width}px`, async ({ page }) => {
    await sampleLibrary(page);
    const height = width < 768 ? 844 : 900;
    await page.setViewportSize({ width, height });
    await mkdir('docs/evidence/ui-refinement', { recursive: true });
    for (const route of [
      '/',
      '/articles',
      '/about',
      '/privacy',
      '/editorial',
      '/contact',
      '/login',
    ]) {
      await page.goto(route);
      await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
      if (route === '/' || route === '/articles')
        await expect(page.locator('.article-card')).toHaveCount(4);
      await page.evaluate(() => document.fonts.ready);
      const size = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      }));
      expect(size.width, route).toBeLessThanOrEqual(width);
      expect(size.height, `${route} stays within two screenfuls`).toBeLessThanOrEqual(height * 2);
      await page.screenshot({
        path: `docs/evidence/ui-refinement/${route === '/' ? 'home-sample' : route.slice(1)}-${width}.png`,
        fullPage: true,
      });
    }
    await page.goto('/privacy');
    await page.getByText('3. Publication', { exact: true }).click();
    await expect(
      page.getByText('On acceptance, the selected manuscript file', { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText('We collect information you voluntarily provide', { exact: false }),
    ).toBeHidden();
  });
}
