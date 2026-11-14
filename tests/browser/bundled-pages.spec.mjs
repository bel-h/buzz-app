import { test, expect } from "./source-fixture.mjs";
import { watchPageErrors } from "./page-errors.mjs";

async function manual(page, article) {
  await article.getByRole("button", { name: "Page actions" }).click();
  await page
    .getByRole("menuitem", { name: "Revision history", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Disable auto-save", exact: true })
    .click();
}

// Browser boundary: plugin composition, native rich editing, mounted live delivery,
// retained view state and responsive layout. Policy permutations live in Vitest.
test("edits and preserves drafts using host UI, then adopts an agent revision without rewriting it", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto("/tests/fixtures/bundled-pages.html");
  await page
    .getByRole("link", { name: "Connected pages plan", exact: true })
    .click();
  const article = page.getByRole("article", {
    name: "Connected pages plan",
    exact: true,
  });
  await manual(page, article);
  const body = article.getByRole("textbox", { name: "Page body", exact: true });
  await body.fill("A draft retained while browsing.");
  await page
    .getByRole("button", { name: "Back to pages", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Connected pages plan", exact: true })
    .click();
  await expect(body).toHaveText("A draft retained while browsing.");
  await article.getByRole("button", { name: "Save", exact: true }).click();
  await expect(article.getByRole("status")).toHaveText(/^Saved /);
  await article
    .getByRole("combobox", { name: "Page mode", exact: true })
    .click();
  await page.getByRole("option", { name: "Editing", exact: true }).click();
  const remote = "# Agent update\n\n- retain spacing\n- no echo\n";
  const saved = await page.evaluate(
    (markdown) =>
      window.workingNotesFixture.agentEdit(
        window.workingNotesFixture.plan,
        markdown,
      ),
    remote,
  );
  await expect(body).toContainText("Agent update");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.workingNotesFixture.head(window.workingNotesFixture.plan.id)
            .revision,
      ),
    )
    .toBe(saved.revision);
  expect(saved.message).toBe(`[Connected pages plan](<${saved.link}>)`);
  await article.getByRole("button", { name: "Page actions" }).click();
  await page
    .getByRole("menuitem", { name: "Markdown source", exact: true })
    .click();
  await expect(
    article.getByRole("textbox", { name: "Markdown", exact: true }),
  ).toHaveValue(remote);
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 480]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate((theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.style.fontSize = "20px";
      }, theme);
      await expect(
        article.getByRole("button", { name: "Share page", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }
  }
  expect(errors.unexplained()).toEqual([]);
});

// Browser boundary: the real conversation link dispatcher must retain the
// composer and use the existing addressable panel Back/Forward/Close owner.
test("opens a Page beside the conversation and preserves host history and live edits", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto("/tests/fixtures/bundled-pages.html");
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  const reference = page.getByRole("link", {
    name: "Connected pages plan",
    exact: true,
  });
  await reference.focus();
  await reference.press("Enter");
  const article = page.getByRole("article", {
    name: "Connected pages plan",
    exact: true,
  });
  await expect(article).toBeVisible();
  await expect(page.getByRole("textbox", { name: /message/i })).toBeVisible();
  const remote = "Updated through the agent tool beside the conversation.";
  await page.evaluate(
    (markdown) =>
      window.workingNotesFixture.agentEdit(
        window.workingNotesFixture.plan,
        markdown,
      ),
    remote,
  );
  await expect(
    article.getByRole("textbox", { name: "Page body", exact: true }),
  ).toHaveText(remote);
  await page.goBack();
  await expect(article).toBeHidden();
  await page.goForward();
  await expect(article).toBeVisible();
  const tab = page.getByRole("tab", {
    name: "Connected pages plan",
    exact: true,
  });
  await tab.click({ button: "middle" });
  await expect(article).toBeHidden();
  await page.goBack();
  await page.goForward();
  await expect(article).toBeHidden();
  await reference.click();
  await expect(article).toBeVisible();
  expect(errors.unexplained()).toEqual([]);
});
