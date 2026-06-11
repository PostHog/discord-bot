import { ChannelType } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addWatchedForum, removeWatchedForum, listWatchedForums } = vi.hoisted(() => ({
  addWatchedForum: vi.fn(),
  removeWatchedForum: vi.fn(),
  listWatchedForums: vi.fn(),
}));
vi.mock("@/db.js", () => ({ addWatchedForum, removeWatchedForum, listWatchedForums }));

const { handleForumsWatch, handleForumsUnwatch, handleForumsList } = await import(
  "@/interactions/forums.js"
);

function ix(channel?: { id: string; type: ChannelType }) {
  const reply = vi.fn(async () => {});
  return {
    guildId: "g",
    options: { getChannel: () => channel },
    reply,
  };
}
const replyText = (i: { reply: ReturnType<typeof vi.fn> }) =>
  (i.reply.mock.calls[0][0] as { content: string }).content;

beforeEach(() => vi.clearAllMocks());

describe("handleForumsWatch", () => {
  it("watches a forum channel", async () => {
    addWatchedForum.mockReturnValue(true);
    const i = ix({ id: "f1", type: ChannelType.GuildForum });
    await handleForumsWatch(i as never);
    expect(addWatchedForum).toHaveBeenCalledWith("g", "f1");
    expect(replyText(i)).toContain("forwarding new posts");
  });

  it("notes when already watched", async () => {
    addWatchedForum.mockReturnValue(false);
    const i = ix({ id: "f1", type: ChannelType.GuildForum });
    await handleForumsWatch(i as never);
    expect(replyText(i)).toContain("already being watched");
  });

  it("rejects a non-forum channel", async () => {
    const i = ix({ id: "c1", type: ChannelType.GuildText });
    await handleForumsWatch(i as never);
    expect(addWatchedForum).not.toHaveBeenCalled();
    expect(replyText(i)).toContain("isn't a forum");
  });
});

describe("handleForumsUnwatch", () => {
  it("unwatches a watched channel", async () => {
    removeWatchedForum.mockReturnValue(true);
    const i = ix({ id: "f1", type: ChannelType.GuildForum });
    await handleForumsUnwatch(i as never);
    expect(removeWatchedForum).toHaveBeenCalledWith("g", "f1");
    expect(replyText(i)).toContain("Stopped forwarding");
  });

  it("notes when it wasn't watched", async () => {
    removeWatchedForum.mockReturnValue(false);
    const i = ix({ id: "f1", type: ChannelType.GuildForum });
    await handleForumsUnwatch(i as never);
    expect(replyText(i)).toContain("wasn't being watched");
  });
});

describe("handleForumsList", () => {
  it("lists watched forums", async () => {
    listWatchedForums.mockReturnValue(["f1", "f2"]);
    const i = ix();
    await handleForumsList(i as never);
    expect(replyText(i)).toContain("<#f1>");
    expect(replyText(i)).toContain("<#f2>");
  });

  it("handles the empty case", async () => {
    listWatchedForums.mockReturnValue([]);
    const i = ix();
    await handleForumsList(i as never);
    expect(replyText(i)).toContain("No forums are being watched");
  });
});
