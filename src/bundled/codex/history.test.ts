import { expect, it } from "vitest";
import { keypair, message } from "../../features/relay/testing";
import { conversationHistory } from "./history";

it("keeps each context message's tags but its channel and signatures", async () => {
  const alice = keypair();
  const tags = [
    ["p", alice.pubkey],
    ["t", "release"],
    ["audience", "agents"],
  ];
  const earlier = message(alice, "c", "Earlier", 10, [
    ["auth", alice.pubkey, "kind=9", "8".repeat(128)],
    ...tags,
  ]);
  const history = await conversationHistory(
    message(alice, "c", "Now", 20),
    { channelId: "c", name: "c" },
    async (filters) => (filters[0]?.kinds?.includes(40003) ? [] : [earlier]),
  );
  expect(history).toContain(
    `"content":"Earlier","tags":${JSON.stringify(tags)}`,
  );
  expect(history).not.toContain("8".repeat(128));
});
