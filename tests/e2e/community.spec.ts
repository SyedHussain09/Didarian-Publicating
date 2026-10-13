import { test, expect, type Page } from '@playwright/test';
import type { AppRole } from '../../src/auth/AuthProvider';
import { readFile } from 'node:fs/promises';

// Component/HTTP contract tests only. Every Supabase response is intercepted;
// fake signatures never reach Auth and no production content is mutated.
// supabase/tests/community.sql separately verifies real database authorization.
const uid = '11111111-1111-4111-8111-111111111111';
const articleId = '22222222-2222-4222-8222-222222222222';
const created = '2026-10-01T12:00:00Z';
const sampleArticle = {
  id: articleId,
  slug: 'controlled-research',
  title: 'Community research example',
  abstract: 'A controlled article for interface verification. '.repeat(8),
  author_names: 'Sample Author',
  contributors: [{ name: 'Sample Author', institution: 'Research Institute' }],
  category: 'Computer Science',
  keywords: ['Research'],
  published_at: created,
  deleted_at: null,
};
type ResponseValue = { json: unknown; status?: number; headers?: Record<string, string> };
async function controlledAccount(page: Page, initialRole: AppRole, complete = true) {
  const state = {
    role: initialRole,
    profile: {
      id: uid,
      first_name: 'Sample',
      last_name: 'Researcher',
      full_name: 'Sample Researcher',
      affiliation: 'Research Institute',
      username: initialRole === 'reviewer' ? 'sample_reviewer' : (null as string | null),
      profile_complete: complete,
    },
    calls: [] as { name: string; args: Record<string, unknown> }[],
    handle: undefined as
      undefined | ((name: string, args: Record<string, unknown>) => ResponseValue | undefined),
  };
  const user = {
    id: uid,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'reviewer@example.invalid',
    email_confirmed_at: created,
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { name: 'Sample Researcher' },
    created_at: created,
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: uid, aud: 'authenticated', role: 'authenticated', exp: expiry })}.invalid-browser-test-signature`;
  await page.addInitScript(
    ({ session }) => {
      localStorage.setItem('sb-ygcporcsudpjfltanqpj-auth-token', JSON.stringify(session));
    },
    {
      session: {
        access_token: token,
        refresh_token: 'invalid-browser-test-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expiry,
        user,
      },
    },
  );
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').at(-1)!;
    const args =
      route.request().method() === 'POST'
        ? (route.request().postDataJSON() as Record<string, unknown>)
        : Object.fromEntries(url.searchParams);
    if (url.pathname.includes('/rpc/')) state.calls.push({ name, args });
    const custom = state.handle?.(name, args);
    if (custom) return route.fulfill(custom);
    let json: unknown = [];
    if (name === 'user') json = user;
    if (name === 'profiles') json = state.profile;
    if (name === 'my_role') json = state.role;
    if (name === 'articles') json = url.searchParams.has('slug') ? sampleArticle : [sampleArticle];
    if (name === 'article_activity')
      json = { like_count: 0, comment_count: 0, liked: false, saved: false, comments: [] };
    if (name === 'my_reading_list' || name === 'admin_publications') json = { count: 0, rows: [] };
    return route.fulfill({
      json,
      headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-0/0' },
    });
  });
  await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
  return state;
}

test('reviewer onboarding preserves values after a taken username and uses the verified email', async ({
  page,
}) => {
  const state = await controlledAccount(page, 'author', false);
  let attempts = 0;
  state.handle = (name, args) => {
    if (name !== 'complete_profile') return;
    attempts++;
    expect(args.p_role).toBe('reviewer');
    expect(args).not.toHaveProperty('email');
    if (attempts === 1)
      return {
        status: 409,
        json: { message: 'That username is already taken. Choose another.', code: 'PT409' },
      };
    state.role = 'reviewer';
    state.profile.profile_complete = true;
    state.profile.username = String(args.p_username);
    return { json: state.profile };
  };
  await page.goto('/account/setup');
  await page.getByRole('radio', { name: 'Reviewer', exact: true }).check();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByLabel('Full name', { exact: true }).fill('Sample Reviewer');
  await page.getByLabel('Username', { exact: true }).fill('Taken_Name');
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await expect(page.getByRole('alert')).toContainText('already taken');
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Sample Reviewer');
  await page.getByLabel('Username', { exact: true }).fill('Available_Name');
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await expect(page).toHaveURL(/\/reviewer$/);
  await expect(page.getByRole('heading', { name: 'Reviewer workspace' })).toBeVisible();
  expect(state.calls.filter((x) => x.name === 'complete_profile').at(-1)?.args.p_username).toBe(
    'available_name',
  );
});

test('Admin Author onboarding requires an institution and cannot self-register as Admin', async ({
  page,
}) => {
  const state = await controlledAccount(page, 'author', false);
  state.profile.affiliation = '';
  state.handle = (name, args) => {
    if (name !== 'complete_profile') return;
    expect(args.p_role).toBe('author');
    expect(args.p_affiliation).toBe('Sample University');
    state.profile.profile_complete = true;
    state.profile.affiliation = String(args.p_affiliation);
    return { json: state.profile };
  };
  await page.goto('/account/setup');
  await expect(page.getByRole('radio')).toHaveCount(2);
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  expect(state.calls.filter((x) => x.name === 'complete_profile')).toHaveLength(0);
  await page.getByLabel('Institute / Organization Name').fill('Sample University');
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await expect(page).toHaveURL(/\/author$/);
  await expect(page.getByRole('heading', { name: 'Admin Author Portal' })).toBeVisible();
});

test('co-author forms expand invalid fields and retain ordered private contact details', async ({
  page,
}) => {
  const state = await controlledAccount(page, 'author');
  state.handle = (name) =>
    name === 'save_draft_with_contributors'
      ? {
          status: 503,
          json: { code: '503', message: 'Controlled retry: your typed fields are retained.' },
        }
      : undefined;
  await page.goto('/author/submissions/new');
  await page.getByLabel('Paper title').fill('A research paper with co-authors');
  await page
    .getByLabel('Abstract', { exact: true })
    .fill('An abstract with enough detail to describe this example study.');
  await page
    .getByRole('combobox', { name: 'Category', exact: true })
    .selectOption('Computer Science');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '+ Add co-author', exact: true }).click();
  const second = page.locator('[data-author-index="1"]');
  await second.getByLabel('Full name', { exact: true }).fill('Second Researcher');
  await page.getByRole('button', { name: /1\. Sample Researcher/ }).click();
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(second.getByLabel('Institute / Organization', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Author 2');
  await second.getByLabel('Institute / Organization', { exact: true }).fill('Second University');
  await second.getByLabel('Email', { exact: true }).fill('second@example.invalid');
  await page.getByRole('button', { name: 'Move author 2 up', exact: true }).click();
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Controlled retry');
  const sent = state.calls.find((x) => x.name === 'save_draft_with_contributors')!.args
    .p_contributors;
  expect(sent).toEqual([
    {
      name: 'Second Researcher',
      institution: 'Second University',
      email: 'second@example.invalid',
    },
    {
      name: 'Sample Researcher',
      institution: 'Research Institute',
      email: 'reviewer@example.invalid',
    },
  ]);
  await expect(page.getByLabel('Paper title')).toHaveValue('A research paper with co-authors');
});

test('reviewers can like, save, edit and delete their own discussion; modal keeps a cursor', async ({
  page,
}) => {
  const state = await controlledAccount(page, 'reviewer');
  const activity = {
    like_count: 0,
    comment_count: 0,
    liked: false,
    saved: false,
    comments: [] as {
      id: string;
      article_id: string;
      reviewer_id: string;
      username: string;
      body: string;
      version: number;
      created_at: string;
      updated_at: string;
    }[],
  };
  state.handle = (name, args) => {
    if (name === 'article_activity') return { json: activity };
    if (name !== 'write_article_activity') return;
    if (args.p_action === 'like') {
      activity.liked = Boolean(args.p_enabled);
      activity.like_count = activity.liked ? 1 : 0;
    }
    if (args.p_action === 'save') activity.saved = Boolean(args.p_enabled);
    if (args.p_action === 'comment') {
      activity.comments.push({
        id: 'comment-one',
        article_id: articleId,
        reviewer_id: uid,
        username: 'sample_reviewer',
        body: String(args.p_body),
        version: 1,
        created_at: created,
        updated_at: created,
      });
      activity.comment_count = 1;
    }
    if (args.p_action === 'edit_comment') {
      expect(args.p_expected_version).toBe(1);
      activity.comments[0].body = String(args.p_body);
      activity.comments[0].version = 2;
    }
    if (args.p_action === 'delete_comment') {
      expect(args.p_expected_version).toBe(2);
      activity.comments = [];
      activity.comment_count = 0;
    }
    return { json: { ok: true } };
  };
  await page.goto('/articles/controlled-research');
  await page.getByRole('button', { name: '♡ Like', exact: true }).click();
  await expect(page.getByRole('button', { name: '♥ Liked', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '+ Save to reading list', exact: true }).click();
  await expect(page.getByRole('button', { name: '✓ Saved', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByLabel('Comment as @sample_reviewer').fill('A thoughtful research question.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByText('A thoughtful research question.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit your comment').fill('An updated research question.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('An updated research question.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.hover();
  expect(await dialog.evaluate((el) => getComputedStyle(el).cursor)).not.toBe('none');
  await dialog.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(page.getByText('An updated research question.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '✓ Saved', exact: true }).click();
  await page.getByRole('button', { name: '♥ Liked', exact: true }).click();
  await expect(page.getByRole('button', { name: '♡ Like', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('Admin moderation requires a reason, removes articles and permits restoration', async ({
  page,
}) => {
  const state = await controlledAccount(page, 'admin');
  let removed = false;
  state.handle = (name, args) => {
    if (name === 'admin_publications')
      return {
        json: {
          count: args.p_removed === removed ? 1 : 0,
          rows:
            args.p_removed === removed
              ? [{ ...sampleArticle, deleted_at: removed ? created : null }]
              : [],
        },
      };
    if (name === 'moderate_article') {
      expect(String(args.p_reason).length).toBeGreaterThan(2);
      removed = Boolean(args.p_removed);
      return { json: { ok: true } };
    }
  };
  await page.goto('/admin/publications');
  await page.getByRole('button', { name: 'Remove article', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a reason');
  await page.getByLabel('Reason', { exact: true }).fill('Editorial moderation test');
  await page.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Removed', exact: true }).click();
  await page.getByRole('button', { name: 'Restore article', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Restored after editorial review');
  await page.getByRole('button', { name: 'Confirm decision' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Published', exact: true }).click();
  await expect(page.getByText(sampleArticle.title, { exact: true })).toBeVisible();
});

test('reviewer workspace and account navigation fit small screens and block the author portal', async ({
  page,
}) => {
  await controlledAccount(page, 'reviewer');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/reviewer');
  await expect(page.getByRole('heading', { name: 'Reviewer workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('#mobile-menu summary').click();
  await expect(
    page.locator('#mobile-menu').getByRole('link', { name: 'Notifications', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'docs/evidence/ggc-reviewer-mobile.png', fullPage: true });
  await page.goto('/author');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
});

test('reading lists paginate and let reviewers remove saved papers, likes and comments', async ({
  page,
}) => {
  const state = await controlledAccount(page, 'reviewer');
  const items = Array.from({ length: 6 }, (_, index) => ({
    ...sampleArticle,
    id: `item-${index}`,
    title: `Saved paper ${index + 1}`,
    created_at: created,
    comment_id: `comment-${index}`,
    version: 1,
    body: `Reviewer observation ${index + 1}`,
  }));
  state.handle = (name, args) => {
    if (name === 'my_reading_list')
      return {
        json: {
          count: items.length,
          rows: items.slice(Number(args.p_page) * 5, Number(args.p_page) * 5 + 5),
        },
      };
    if (name === 'write_article_activity') {
      const index = items.findIndex((x) => x.id === args.p_article_id);
      if (args.p_action === 'edit_comment') {
        items[index].body = String(args.p_body);
        items[index].version++;
      } else items.splice(index, 1);
      return { json: { ok: true } };
    }
  };
  await page.goto('/reviewer');
  await expect(page.getByRole('article')).toHaveCount(5);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove from saved', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(5);
  await page.getByRole('button', { name: 'Liked articles', exact: true }).click();
  await page.getByRole('button', { name: 'Unlike', exact: true }).first().click();
  await expect(page.getByRole('article')).toHaveCount(4);
  await page.getByRole('button', { name: 'My comments', exact: true }).click();
  await page.getByRole('button', { name: 'Edit comment', exact: true }).first().click();
  await page
    .getByRole('textbox', { name: 'Edit comment', exact: true })
    .fill('Revised observation');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Revised observation', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete comment', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm decision' }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
});

test('author notifications link to discussions, can be read and templates download genuine branded bytes', async ({
  page,
}) => {
  const state = await controlledAccount(page, 'author');
  const notice = {
    id: 'website-notice',
    recipient_id: uid,
    submission_id: 'sample-draft',
    article_id: articleId,
    article: { slug: sampleArticle.slug },
    message: '@sample_reviewer commented on your paper.',
    read_at: null as string | null,
    created_at: created,
    kind: 'comment',
  };
  state.handle = (name) => {
    if (name === 'notifications')
      return {
        json: [notice],
        headers: { 'access-control-expose-headers': 'content-range', 'content-range': '0-0/1' },
      };
    if (name === 'mark_notification_read') {
      notice.read_at = created;
      return { json: { ok: true } };
    }
  };
  await page.goto('/notifications');
  await expect(page.getByText(notice.message, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open article', exact: true })).toHaveAttribute(
    'href',
    '/articles/controlled-research#discussion',
  );
  await page.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(page.getByText('Read', { exact: true })).toBeVisible();
  await page.goto('/author');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download Template \(Word\)/ }).click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe('GGC_Research_Template.doc');
  const contents = await readFile((await downloaded.path())!);
  expect(contents.equals(await readFile('public/resources/GGC_Research_Template.doc'))).toBe(true);
});
