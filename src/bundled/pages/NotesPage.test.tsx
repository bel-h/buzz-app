// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { render, workspaceFixture } from "./ui-testing";
import { WorkingNotesCommunity } from "./WorkingNotesPage";
import { eventDto } from "../../features/relay/events";
import { signed } from "../../features/relay/testing";
import type { RelaySession } from "../../features/relay/session";

function storage(
  f: Awaited<ReturnType<typeof workspaceFixture>>,
  note: { channel: string },
) {
  const channel = f.channels.get(note.channel);
  if (!channel) throw new Error("Missing fixture storage");
  return channel;
}

it("groups by the signed creator and verified agent ownership, preserving attribution and access", async () => {
  const f = await workspaceFixture();
  const mine = f.seed("My plan", "Updated by my agent");
  await f.edit(f.carl, mine, { title: mine.title, markdown: mine.markdown });
  const agent = f.seed("Agent research", "Updated by a human");
  const other = f.seed("Other person's plan", "A shared document");
  storage(f, agent).creator = f.carl.pubkey;
  const channel = storage(f, other);
  channel.creator = f.sam.pubkey;
  channel.roles = { [f.sam.pubkey]: "owner", [f.viewer.pubkey]: "guest" };
  const roles = { ...channel.roles };
  const before = f.accepted.length;
  render(<WorkingNotesCommunity workspace={f.workspace} />);
  await screen.findByRole("link", { name: agent.title });
  expect(screen.getByRole("link", { name: mine.title })).toBeVisible();
  await within(screen.getByRole("link", { name: mine.title })).findByTitle(
    "Last edited by Carl",
  );
  expect(
    within(screen.getByRole("link", { name: agent.title })).getByTitle(
      "Last edited by You",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: other.title }),
  ).not.toBeInTheDocument();
  const folder = screen.getByRole("button", { name: "Shared with me" });
  fireEvent.click(folder);
  const back = screen.getByRole("button", { name: "Back to pages" });
  expect(back).toHaveFocus();
  expect(screen.getByRole("link", { name: other.title })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "New page" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "No match" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("No matching pages.");
  fireEvent.click(screen.getByRole("button", { name: "Clear search pages" }));
  fireEvent.click(screen.getByRole("link", { name: other.title }));
  const article = await screen.findByRole("article", { name: other.title });
  await within(article).findByText("You have read access.");
  expect(
    within(article).queryByRole("combobox", { name: "Page mode" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Back to Shared with me" }),
  );
  expect(screen.getByRole("list", { name: "Shared with me" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to pages" }));
  expect(screen.getByRole("button", { name: "Shared with me" })).toHaveFocus();
  expect(channel.roles).toEqual(roles);
  expect((await f.workspace.open(other)).event.pubkey).toBe(f.viewer.pubkey);
  expect(f.accepted).toHaveLength(before);
});

it("does not trust names, inventory, forged auth or unreadable ownership, and responds to proof removal", async () => {
  const f = await workspaceFixture();
  const agent = f.seed("Verified agent page", "Work");
  const spoof = f.seed("Spoofed owner page", "Work");
  storage(f, agent).creator = f.carl.pubkey;
  storage(f, spoof).creator = f.sam.pubkey;
  f.setAgentKeys([f.carl.pubkey, f.sam.pubkey]);
  f.profiles.push(
    eventDto(
      signed(f.sam, {
        kind: 0,
        created_at: 2_000_000_000,
        content: JSON.stringify({ name: "Carl", bot: true }),
        tags: [["auth", f.viewer.pubkey, "", "a".repeat(128)]],
      }),
    ),
  );
  // This owned-agent page is private to the agent, so grouping cannot discover it.
  const privateNote = f.seed("Private agent page", "Secret");
  const privateChannel = storage(f, privateNote);
  privateChannel.creator = f.carl.pubkey;
  privateChannel.roles = { [f.carl.pubkey]: "owner" };
  render(<WorkingNotesCommunity workspace={f.workspace} />);
  await screen.findByRole("link", { name: agent.title });
  expect(
    screen.queryByRole("link", { name: spoof.title }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: privateNote.title }),
  ).not.toBeInTheDocument();
  // A newer, validly signed profile without an ownership attestation revokes the group.
  const revoked = eventDto(
    signed(f.carl, {
      kind: 0,
      created_at: 2_000_000_001,
      content: JSON.stringify({ name: "Carl", bot: true }),
      tags: [],
    }),
  );
  f.profiles.push(revoked);
  await act(async () => {
    await f.owner.clearCache();
  });
  await waitFor(() =>
    expect(f.session.profiles.event?.(f.carl.pubkey)?.id).toBe(revoked.id),
  );
  expect(
    screen.queryByRole("link", { name: agent.title }),
  ).not.toBeInTheDocument();
  expect(f.session.profiles.snapshot().get(f.sam.pubkey)?.ownerPubkey).toBe(
    f.viewer.pubkey,
  );
  expect(f.session.profiles.owner?.(f.sam.pubkey)).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Shared with me" }));
  expect(screen.getByRole("link", { name: agent.title })).toBeVisible();
  expect(screen.getByRole("link", { name: spoof.title })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: privateNote.title }),
  ).not.toBeInTheDocument();
});

it("keeps viewer pages usable when ownership reads fail, and retries on refresh", async () => {
  const ensure = vi.fn<RelaySession["profiles"]["ensure"]>(async () => {
    throw new Error("Profiles unavailable");
  });
  const f = await workspaceFixture(undefined, (session) => ({
    ...session,
    profiles: { ...session.profiles, ensure },
  }));
  const mine = f.seed("My page", "Work");
  const agent = f.seed("Unverified agent page", "Work");
  storage(f, agent).creator = f.carl.pubkey;
  render(<WorkingNotesCommunity workspace={f.workspace} />);
  await screen.findByRole("link", { name: mine.title });
  await waitFor(() =>
    expect(ensure).toHaveBeenCalledWith(
      [f.carl.pubkey, f.viewer.pubkey],
      "background",
    ),
  );
  expect(
    screen.queryByRole("link", { name: agent.title }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Shared with me" }));
  expect(screen.getByRole("link", { name: agent.title })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to pages" }));
  ensure.mockImplementation(f.session.profiles.ensure);
  fireEvent.click(screen.getByRole("button", { name: "Refresh pages" }));
  await screen.findByRole("link", { name: agent.title });
  expect(
    screen.queryByRole("button", { name: "Shared with me" }),
  ).not.toBeInTheDocument();
});
