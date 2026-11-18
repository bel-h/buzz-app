import { npubEncode } from "nostr-tools/nip19";
import { expect, it } from "vitest";
import { describeSignature } from "./describe-signature";

const channel = "0b6b3a8e-1d7c-4f0e-9a52-6a1f0c5d2e77";
const pubkey = "ab".repeat(32);
const lookup = {
  channel: (id: string) => (id === channel ? "general" : undefined),
  person: (key: string) => (key === pubkey ? "Alex" : undefined),
};

it("names a channel it knows, and a short id for one it does not", () => {
  expect(describeSignature(9022, [["h", channel]], lookup).action).toBe(
    "leave #general",
  );
  expect(describeSignature(9022, [["h", channel]]).action).toBe(
    "leave channel 0b6b3a8e",
  );
  expect(describeSignature(9022, [], lookup).action).toBe("leave a channel");
});

it("tells a reaction from a message in a deletion", () => {
  expect(
    describeSignature(5, [
      ["e", "x"],
      ["k", "7"],
    ]).action,
  ).toBe("remove a reaction");
  expect(
    describeSignature(5, [
      ["e", "x"],
      ["k", "9"],
    ]).action,
  ).toBe("delete a message");
  expect(describeSignature(5, [["e", "x"]]).action).toBe("delete a message");
});

it("names the person a moderation or membership change is about", () => {
  const tags = [
    ["h", channel],
    ["p", pubkey],
  ];
  expect(describeSignature(9000, tags, lookup).action).toBe(
    "add Alex to #general",
  );
  expect(describeSignature(9001, tags, lookup).action).toBe(
    "remove Alex from #general",
  );
  expect(describeSignature(9040, tags, lookup).action).toBe(
    "ban Alex from #general",
  );
  expect(describeSignature(9042, tags, lookup).action).toBe(
    "time out Alex in #general",
  );
  expect(describeSignature(9043, tags, lookup).action).toBe(
    "end the timeout for Alex in #general",
  );
  expect(describeSignature(41011, [["p", pubkey]], lookup).action).toBe(
    "add Alex to a DM",
  );
});

it("falls back to a short npub for a person it cannot name, never the raw key", () => {
  const { action } = describeSignature(9000, [
    ["h", channel],
    ["p", pubkey],
  ]);
  expect(action).toBe(
    `add npub…${npubEncode(pubkey).slice(-3)} to channel 0b6b3a8e`,
  );
  expect(action).not.toContain(pubkey);
  expect(describeSignature(9001, [["p", "not a key"]]).action).toBe(
    "remove someone from a channel",
  );
});

it("sums up several people", () => {
  const other = "cd".repeat(32);
  const third = "ef".repeat(32);
  const names = {
    person: (key: string) => ({ [pubkey]: "Alex", [other]: "Sam" })[key],
  };
  expect(
    describeSignature(
      9000,
      [
        ["p", pubkey],
        ["p", other],
      ],
      names,
    ).action,
  ).toBe("add Alex and Sam to a channel");
  expect(
    describeSignature(
      9000,
      [
        ["p", pubkey],
        ["p", other],
        ["p", third],
      ],
      names,
    ).action,
  ).toBe("add Alex and 2 others to a channel");
  expect(
    describeSignature(
      9000,
      [
        ["p", pubkey],
        ["p", pubkey],
      ],
      names,
    ).action,
  ).toBe("add Alex to a channel");
});

it("says what an edit changes", () => {
  const h = ["h", channel];
  const edit = (...tags: string[][]) =>
    describeSignature(9002, [h, ...tags], lookup).action;
  expect(edit(["archived", "true"])).toBe("archive #general");
  expect(edit(["archived", "false"])).toBe("unarchive #general");
  expect(edit(["auto_join", "true"])).toBe("turn auto-join on for #general");
  expect(edit(["auto_join", "false"])).toBe("turn auto-join off for #general");
  expect(edit(["name", "new"])).toBe("rename #general");
  expect(edit(["about", "x"])).toBe("change the description of #general");
  expect(edit(["name", "new"], ["about", "x"])).toBe(
    "change the name and description of #general",
  );
  expect(edit()).toBe("edit #general");
});

it("describes every kind that can be asked, with a noun and a general ability", () => {
  const asked = [
    0, 3, 5, 9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9021,
    9022, 9040, 9041, 9042, 9043, 9044, 10002, 10100, 28936, 30175, 30176,
    30177, 30179, 30617, 30618, 30620, 30621, 41011, 45011, 46030, 46031,
  ];
  for (const kind of asked) {
    const { action, plural, ability } = describeSignature(kind, []);
    expect(action, `${kind}`).not.toMatch(/kind/);
    expect(plural, `${kind}`).not.toMatch(/kind/);
    expect(ability, `${kind}`).not.toMatch(/kind/);
  }
  expect(describeSignature(9022, [])).toEqual({
    action: "leave a channel",
    plural: "leaves",
    ability: "leave channels",
  });
  expect(describeSignature(28936, []).action).toBe("leave the community");
  expect(describeSignature(9009, [["h", channel]], lookup).action).toBe(
    "change admin settings for #general",
  );
  expect(describeSignature(9007, [["name", "ops"]]).action).toBe(
    "create the channel “ops”",
  );
});

it("falls back for a kind it does not know", () => {
  expect(describeSignature(31234, [["h", channel]], lookup)).toEqual({
    action: "sign a kind 31234 event",
    plural: "kind 31234 events",
    ability: "sign kind 31234 events",
  });
});

it("clips a long name and never reads content", () => {
  const long = "x".repeat(200);
  const { action } = describeSignature(9022, [["h", channel]], {
    channel: () => long,
  });
  expect(action).toBe(`leave #${"x".repeat(60)}…`);
  // A tag named like content is not a tag the words come from.
  expect(
    describeSignature(
      9022,
      [
        ["content", "secret"],
        ["h", channel],
      ],
      lookup,
    ).action,
  ).not.toContain("secret");
});
