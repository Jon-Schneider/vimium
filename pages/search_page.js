import { activate, launchSearchPageUrl, ui } from "./vomnibar_page.js";
import { parseSearchPageOptions } from "./search_page_options.js";
import * as userSearchEngines from "../background_scripts/user_search_engines.js";

export async function initializeSearchPage(search = globalThis.location.search) {
  try {
    const { engine, query, options, openFirst } = parseSearchPageOptions(search);
    await Settings.onLoaded();
    if (engine != null) {
      userSearchEngines.set(Settings.get("searchEngines"));
      if (!Object.hasOwn(userSearchEngines.keywordToEngine, engine)) {
        throw new Error(`Unknown search engine: ${engine}`);
      }
      const url = UrlUtils.createSearchUrl(query, userSearchEngines.keywordToEngine[engine].url);
      await launchSearchPageUrl(url);
      return;
    }
    await activate(options, true);
    // Empty queries must not automatically switch to an arbitrary tab.
    if (openFirst && query.trim() && ui.completions.length > 0) {
      await ui.openCompletion(ui.completions[0], false);
    }
  } catch (error) {
    document.getElementById("search-status").textContent = error.message;
  }
}

if (!globalThis.isUnitTests) {
  document.addEventListener("DOMContentLoaded", () => initializeSearchPage());
}
