import { test, expect } from "./fixture.mjs";
import { openPage } from "./navigation.mjs";
import { pauseClock } from "./clock.mjs";

const blocked = "11111111-1111-4111-8111-111111111111";
const healthy = "22222222-2222-4222-8222-222222222222";
const agent =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
test.use({
  productionBroker: true,
  readState: true,
  localAgentActivity: true,
  savedCommunities: ["primary"],
  channelIds: [blocked, healthy],
  channelNames: { [blocked]: "Blocked history", [healthy]: "Healthy history" },
  historyCounts: { [blocked]: 0, [healthy]: 0 },
});

// Representative app wiring: the real runner admits a watch turn and the
// production Attention tab renders its history. The fake harness consumes no model.
test("watch catch-up survives one rejected history read and shows recovery in Attention", async ({
  page,
  app,
}, info) => {
  await page.clock.install();
  await page.goto(app.origin);
  await openPage(page, "Agents");
  const card = page.getByRole("gridcell", {
    name: "Local tester, Bestie",
    exact: true,
  });
  await expect(card).toBeVisible();
  await card.click();
  await page.getByRole("tab", { name: "Attention", exact: true }).click();
  await page.evaluate(
    async ({ agent, blocked, healthy }) => {
      const { agents } = window.localAgentFixture.services();
      const current = agents.find(agent);
      if (!current) throw new Error("Fixture agent is missing");
      await agents.save(current.key, {
        attention: {
          "interest/recovery": {
            type: "interest",
            instructions: "Inspect the new history.",
          },
          "watch/history": {
            type: "event",
            interest_id: "recovery",
            name: "History recovery",
            enabled: true,
            since: 1,
            kinds: [9],
            channels: [blocked, healthy],
          },
        },
      });
    },
    { agent, blocked, healthy },
  );
  await page
    .getByRole("button", { name: "Details for History recovery", exact: true })
    .click();
  await pauseClock(page);
  const stamp = await page.evaluate(() => Math.floor(Date.now() / 1000));
  for (const [channel, content] of [
    [blocked, "Blocked history marker"],
    [healthy, "Healthy history marker"],
  ]) {
    app.histories.get(`primary/${channel}`).push(
      app.sign({
        kind: 9,
        content,
        created_at: stamp + 1,
        tags: [["h", channel]],
      }),
    );
  }
  await page.evaluate((blocked) => {
    const { relay } = window.localAgentFixture.services();
    const session = relay.snapshot().session;
    const original = session.read.bind(session);
    const state = { active: true, failures: 0, down: false, recovered: false };
    window.historyReadFailure = state;
    session.read = (filters, options) => {
      if (
        state.active &&
        filters.some(
          (filter) =>
            filter["#h"]?.includes(blocked) &&
            filter.kinds?.includes(9) &&
            filter.limit === 16 &&
            filter.until !== undefined,
        )
      ) {
        state.failures++;
        return Promise.reject(new Error("Fixture channel history unavailable"));
      }
      return original(filters, options);
    };
    const stop = session.live.subscribe(() => {
      if (session.live.snapshot().status !== "connected") state.down = true;
      else if (state.down) state.recovered = true;
    });
    window.restoreHistoryRead = () => {
      session.read = original;
      stop();
    };
  }, blocked);
  try {
    await page.clock.setSystemTime((stamp + 60) * 1000);
    app.relay.disconnect("primary");
    await expect
      .poll(() => page.evaluate(() => window.historyReadFailure.recovered))
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.localAgentFixture.watched()))
      .toEqual(["Healthy history marker"]);
    expect(await page.evaluate(() => window.historyReadFailure.failures)).toBe(
      1,
    );
    await page
      .getByLabel("Show activity for History recovery", { exact: true })
      .click();
    const activity = page.getByRole("list", {
      name: "Activity for History recovery",
    });
    await expect(activity).toContainText("Healthy history marker");
    await expect(activity).not.toContainText("Blocked history marker");
    await page.screenshot({
      path: info.outputPath("healthy-during-history-error.png"),
    });
    await page.evaluate(() => {
      window.historyReadFailure.active = false;
    });
    await page.clock.runFor(43_000);
    await expect
      .poll(() => page.evaluate(() => window.localAgentFixture.watched()))
      .toEqual(["Healthy history marker", "Blocked history marker"]);
    await expect(activity).toContainText("Blocked history marker");
    await expect(activity.getByRole("listitem")).toHaveCount(2);
    await page.screenshot({ path: info.outputPath("history-recovered.png") });
  } finally {
    await page.evaluate(() => window.restoreHistoryRead?.());
  }
});
