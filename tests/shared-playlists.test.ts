import { describe, expect, it } from "vitest";
import { mergePlaylists } from "../src/sharedPlaylists";
const p = (id: string, name = id) => ({
  id,
  name,
  trackIds: ["song"],
  cover: null,
});
describe("playlists arriving during PC saves", () => {
  it("keeps incoming creations when only volume changed", () => {
    expect(mergePlaylists([p("a")], [p("a")], [p("a"), p("phone")])).toEqual([
      p("a"),
      p("phone"),
    ]);
  });
  it("keeps local edits and remote deletions without resurrecting lists", () => {
    expect(
      mergePlaylists(
        [p("a"), p("b")],
        [p("a", "edited"), p("b")],
        [p("a"), p("phone")],
      ),
    ).toEqual([p("a", "edited"), p("phone")]);
    expect(mergePlaylists([p("a")], [], [p("a"), p("phone")])).toEqual([
      p("phone"),
    ]);
  });
});
