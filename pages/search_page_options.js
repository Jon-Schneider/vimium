// Options for the standalone search page, also usable in browser site-search URL templates.
export function parseSearchPageOptions(search) {
  const params = new URLSearchParams(search);
  const query = params.get("q") || "";
  const engine = params.get("engine");
  if (engine != null) {
    if (!engine || ["source", "match", "open"].some((key) => params.has(key))) {
      throw new Error("Use engine with q, or source with q, match, and open.");
    }
    return { engine, query };
  }

  const source = params.get("source") || "omni";
  if (!["omni", "bookmarks", "tabs"].includes(source)) {
    throw new Error(`Unknown search source: ${source}`);
  }
  const match = params.get("match") || "default";
  if (match != "default" && (match != "title-token" || source != "bookmarks")) {
    throw new Error("match=title-token is supported only for bookmarks.");
  }
  const open = params.get("open");
  if (open != null && open != "first") {
    throw new Error(`Unknown opening mode: ${open}`);
  }
  return {
    query,
    options: { completer: source, query, selectFirst: source != "omni", match },
    openFirst: open == "first",
  };
}
