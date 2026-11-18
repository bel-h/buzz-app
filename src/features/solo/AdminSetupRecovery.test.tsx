// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import type { Delivery, Outbox, OutgoingEvent } from "../relay/outbox";
import { soloAdminRecovery } from "../relay/solo-admins";
import { AdminSetupRecovery } from "./AdminSetupRecovery";

afterEach(cleanup);

const chat = "33333333-3333-4333-8333-333333333333";
const agent = "a".repeat(64);
const recovery = soloAdminRecovery(chat, [agent], [agent]);

function records(setup: Delivery, opening: Delivery, channel = chat) {
  return [
    {
      event: {
        id: "create",
        kind: 9007,
        content: "",
        tags: [
          ["h", channel],
          ["p", agent],
        ],
      },
      delivery: setup,
      recovery: soloAdminRecovery(channel, [agent], [agent]),
    },
    {
      event: {
        id: "opening",
        kind: 9,
        content: "Opening work",
        tags: [["h", channel]],
      },
      delivery: opening,
    },
  ] as OutgoingEvent[];
}

function show(
  items: OutgoingEvent[],
  dismiss = vi.fn<Outbox["dismiss"]>(async () => {}),
) {
  let current = items;
  const listeners = new Set<() => void>();
  const outbox = {
    snapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dismiss: vi.fn<Outbox["dismiss"]>(async (id, owner) => {
      await dismiss(id, owner);
      current = current.filter((item) => item.event.id !== id);
      for (const listener of listeners) listener();
    }),
  } as unknown as Outbox;
  render(
    <ToastProvider>
      <AdminSetupRecovery outbox={outbox} channelId={chat} />
    </ToastProvider>,
  );
  return outbox;
}

it.each([
  ["setup still sending", records("sending", "failed")],
  ["opening message sent", records("accepted", "accepted")],
  ["another chat's setup", records("accepted", "failed", "other")],
])("offers no abandonment with %s", async (_, items) => {
  show(items);
  await new Promise((resolve) => setTimeout(resolve));
  expect(
    screen.queryByRole("button", { name: "Abandon admin setup" }),
  ).not.toBeInTheDocument();
});

it.each(["failed", "unknown"] as const)(
  "abandons a blocked setup from the chat when its opening message is %s",
  async (opening) => {
    const outbox = show(records("seen", opening));
    fireEvent.click(
      await screen.findByRole("button", { name: "Abandon admin setup" }),
    );
    const confirmation = screen.getByRole("alertdialog", {
      name: "Abandon admin setup?",
    });
    fireEvent.click(
      within(confirmation).getByRole("button", {
        name: "Abandon admin setup",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Abandon admin setup" }),
      ).not.toBeInTheDocument(),
    );
    expect(outbox.dismiss).toHaveBeenCalledWith("create", recovery);
  },
);

it("keeps the setup and explains a failed abandonment", async () => {
  show(
    records("accepted", "failed"),
    vi.fn<Outbox["dismiss"]>(async () => {
      throw new Error("Storage unavailable");
    }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Abandon admin setup" }),
  );
  const confirmation = screen.getByRole("alertdialog", {
    name: "Abandon admin setup?",
  });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "Abandon admin setup" }),
  );
  expect(await within(confirmation).findByRole("alert")).toHaveTextContent(
    "Storage unavailable",
  );
});
