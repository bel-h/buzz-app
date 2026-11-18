import { formatPublicKey } from "../../shared/identity/public-key";

export type SignatureLookup = {
  /** The channel's name, when the app already knows it. */
  channel?(id: string): string | undefined;
  /** The person's display name, when the app already knows it. */
  person?(pubkey: string): string | undefined;
};

export type SignatureDescription = {
  /** What this one request does: "leave #general". */
  action: string;
  /** The kind as a noun, to name what a remembered approval allows: "leaves". */
  plural: string;
  /** The kind in general, after "Can": "leave channels". */
  ability: string;
};

type Entry = {
  plural: string;
  ability: string;
  action(tags: readonly (readonly string[])[], text: Text): string;
};
type Text = {
  channel: string | undefined;
  people: string | undefined;
};

const MAX_NAME = 60;
const first = (tags: readonly (readonly string[])[], name: string) =>
  tags.find((tag) => tag[0] === name)?.[1];
const clip = (value: string) =>
  [...value].length > MAX_NAME
    ? `${[...value].slice(0, MAX_NAME).join("")}…`
    : value;

const fixed = (
  action: string,
  plural: string,
  ability: string,
  extra?: Partial<Entry>,
): Entry => ({ plural, ability, action: () => action, ...extra });
const inChannel = (verb: string, text: Text) =>
  text.channel ? `${verb} in ${text.channel}` : verb;
const admin: Entry = {
  plural: "admin changes",
  ability: "change channel admin settings",
  action: (_tags, text) =>
    text.channel
      ? `change admin settings for ${text.channel}`
      : "change channel admin settings",
};

const KINDS: Readonly<Record<number, Entry>> = {
  0: fixed("change your profile", "profile changes", "change your profile"),
  3: fixed(
    "change your contact list",
    "contact list changes",
    "change your contact list",
  ),
  5: {
    plural: "deletions",
    ability: "delete messages or reactions",
    action: (tags) =>
      first(tags, "k") === "7" ? "remove a reaction" : "delete a message",
  },
  9000: {
    plural: "member additions",
    ability: "add channel members",
    action: (_tags, text) =>
      `add ${text.people ?? "a member"} to ${text.channel ?? "a channel"}`,
  },
  9001: {
    plural: "member removals",
    ability: "remove channel members",
    action: (_tags, text) =>
      `remove ${text.people ?? "a member"} from ${text.channel ?? "a channel"}`,
  },
  9002: {
    plural: "channel edits",
    ability: "edit channels",
    action: (tags, text) => {
      const target = text.channel ?? "a channel";
      const archived = first(tags, "archived");
      if (archived !== undefined)
        return `${archived === "true" ? "archive" : "unarchive"} ${target}`;
      const autoJoin = first(tags, "auto_join");
      if (autoJoin !== undefined)
        return `turn auto-join ${autoJoin === "true" ? "on" : "off"} for ${target}`;
      const name = first(tags, "name") !== undefined;
      const about = ["about", "topic", "purpose"].some(
        (tag) => first(tags, tag) !== undefined,
      );
      if (name && about) return `change the name and description of ${target}`;
      if (name) return `rename ${target}`;
      if (about) return `change the description of ${target}`;
      return `edit ${target}`;
    },
  },
  9003: admin,
  9004: admin,
  9005: {
    plural: "message deletions",
    ability: "delete messages",
    action: (_tags, text) => inChannel("delete a message", text),
  },
  9006: admin,
  9007: {
    plural: "channel creations",
    ability: "create channels",
    action: (tags) => {
      const name = first(tags, "name");
      return name ? `create the channel “${clip(name)}”` : "create a channel";
    },
  },
  9008: {
    plural: "channel deletions",
    ability: "delete channels",
    action: (_tags, text) => `delete ${text.channel ?? "a channel"}`,
  },
  9009: admin,
  9021: {
    plural: "joins",
    ability: "join channels",
    action: (_tags, text) => `join ${text.channel ?? "a channel"}`,
  },
  9022: {
    plural: "leaves",
    ability: "leave channels",
    action: (_tags, text) => `leave ${text.channel ?? "a channel"}`,
  },
  9040: {
    plural: "bans",
    ability: "ban people from channels",
    action: (_tags, text) =>
      `ban ${text.people ?? "someone"} from ${text.channel ?? "a channel"}`,
  },
  9041: {
    plural: "unbans",
    ability: "unban people from channels",
    action: (_tags, text) =>
      `unban ${text.people ?? "someone"} from ${text.channel ?? "a channel"}`,
  },
  9042: {
    plural: "timeouts",
    ability: "time out people in channels",
    action: (_tags, text) =>
      inChannel(`time out ${text.people ?? "someone"}`, text),
  },
  9043: {
    plural: "timeout removals",
    ability: "end timeouts in channels",
    action: (_tags, text) =>
      inChannel(`end the timeout for ${text.people ?? "someone"}`, text),
  },
  9044: {
    plural: "report resolutions",
    ability: "resolve reports",
    action: (_tags, text) => inChannel("resolve a report", text),
  },
  10002: fixed(
    "change your relay list",
    "relay list changes",
    "change your relay list",
  ),
  10100: fixed(
    "change your agent profile",
    "agent profile changes",
    "change your agent profile",
  ),
  28936: fixed("leave the community", "community exits", "leave the community"),
  30175: fixed("change a persona", "persona changes", "change personas"),
  30176: fixed("change a team", "team changes", "change teams"),
  30177: fixed(
    "change a managed agent",
    "managed agent changes",
    "change managed agents",
  ),
  30179: fixed(
    "change a managed agent",
    "managed agent changes",
    "change managed agents",
  ),
  30617: fixed(
    "announce a repository",
    "repository announcements",
    "announce repositories",
  ),
  30618: fixed(
    "update a repository’s state",
    "repository updates",
    "update repository state",
  ),
  30620: fixed("change a workflow", "workflow changes", "change workflows"),
  30621: fixed("change a project", "project changes", "change projects"),
  41011: {
    plural: "DM additions",
    ability: "add people to DMs",
    action: (_tags, text) => `add ${text.people ?? "someone"} to a DM`,
  },
  45011: fixed("remove an artifact", "artifact removals", "remove artifacts"),
  46030: fixed(
    "approve a workflow step",
    "workflow approvals",
    "approve workflow steps",
  ),
  46031: fixed(
    "deny a workflow step",
    "workflow denials",
    "deny workflow steps",
  ),
};

const channelLabel = (id: string, lookup: SignatureLookup) => {
  const name = lookup.channel?.(id)?.trim();
  return name ? `#${clip(name)}` : `channel ${id.slice(0, 8)}`;
};

const personLabel = (pubkey: string, lookup: SignatureLookup) => {
  const name = lookup.person?.(pubkey)?.trim();
  return name ? clip(name) : (formatPublicKey(pubkey) ?? "someone");
};

const peopleLabel = (
  tags: readonly (readonly string[])[],
  lookup: SignatureLookup,
) => {
  const keys = [
    ...new Set(
      tags.flatMap((tag) => (tag[0] === "p" && tag[1] ? [tag[1]] : [])),
    ),
  ];
  const [one, two] = keys;
  if (one === undefined) return undefined;
  if (two === undefined) return personLabel(one, lookup);
  return keys.length === 2
    ? `${personLabel(one, lookup)} and ${personLabel(two, lookup)}`
    : `${personLabel(one, lookup)} and ${keys.length - 1} others`;
};

/** Says in plain words what a tool asks Buzz to sign. The event's `content`
 * is never read: only its kind and the tags that name what it acts on. */
export function describeSignature(
  kind: number,
  tags: readonly (readonly string[])[],
  lookup: SignatureLookup = {},
): SignatureDescription {
  const entry = Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
  if (!entry)
    return {
      action: `sign a kind ${kind} event`,
      plural: `kind ${kind} events`,
      ability: `sign kind ${kind} events`,
    };
  const channelId = first(tags, "h");
  return {
    action: entry.action(tags, {
      channel: channelId ? channelLabel(channelId, lookup) : undefined,
      people: peopleLabel(tags, lookup),
    }),
    plural: entry.plural,
    ability: entry.ability,
  };
}
