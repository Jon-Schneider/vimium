import * as testHelper from "./test_helper.js";
import { withPromise } from "./test_helper.js";
import { parseSearchPageOptions } from "../../pages/search_page_options.js";
import * as vomnibarPage from "../../pages/vomnibar_page.js";
import { initializeSearchPage } from "../../pages/search_page.js";

context("search page options", () => {
  should("decode a bookmark query and explicit title-token and open-first options", () => {
    assert.equal(
      {
        query: "/日本 /C++",
        options: {
          completer: "bookmarks",
          query: "/日本 /C++",
          selectFirst: true,
          match: "title-token",
        },
        openFirst: true,
      },
      parseSearchPageOptions("?source=bookmarks&q=%2F日本+%2FC%2B%2B&match=title-token&open=first"),
    );
    assert.equal("omni", parseSearchPageOptions("").options.completer);
    assert.equal("tabs", parseSearchPageOptions("?source=tabs").options.completer);
    assert.equal(
      { engine: "w", query: "cats & dogs" },
      parseSearchPageOptions("?engine=w&q=cats+%26+dogs"),
    );
  });

  should("reject unsupported options instead of launching a different search", () => {
    for (
      const search of [
        "?source=constructor",
        "?source=commands",
        "?match=title-token",
        "?match=unknown",
        "?source=tabs&match=title-token",
        "?open=all",
        "?engine=",
        "?engine=w&source=bookmarks",
        "?engine=w&open=first",
        "?engine=w&match=default",
      ]
    ) {
      assert.throwsError(() => parseSearchPageOptions(search));
    }
  });

  should("exclude executable results but allow supported navigation protocols", () => {
    for (
      const url of ["javascript:alert(1)", "data:text/html,hello", "invalid", "JAVASCRIPT:alert(1)"]
    ) {
      assert.isFalse(UrlUtils.isNavigableUrl(url));
    }
    for (const url of ["https://example.com", "chrome://settings", "file:///tmp/test.html"]) {
      assert.isTrue(UrlUtils.isNavigableUrl(url));
    }
  });
});

context("standalone search page", () => {
  let opened;
  let completions;
  setup(async () => {
    await testHelper.jsdomStub("pages/search.html");
    stub(globalThis, "location", {
      replace: (url) => {
        opened = url;
      },
    });
    opened = null;
    completions = [];
    stub(chrome.tabs, "getCurrent", withPromise(() => ({ id: 99 })));
    stub(
      chrome.runtime,
      "sendMessage",
      withPromise((message) => {
        if (message.handler == "filterCompletions") return completions;
      }),
    );
    vomnibarPage.reset();
    await Settings.onLoaded();
    stub(Settings._settings, "searchEngines", "w: https://example.com/search?q=%s Example");
  });

  should("dispatch a configured engine using its URL template", async () => {
    await initializeSearchPage("?engine=w&q=cats+%26+dogs");
    assert.equal("https://example.com/search?q=cats%20%26%20dogs", opened);
  });

  should("normalize bare URLs submitted without selecting an omni result", async () => {
    for (const query of ["example.com", "localhost:8080", "127.0.0.1:8080/path"]) {
      await initializeSearchPage(`?source=omni&q=${encodeURIComponent(query)}`);
      let navigation;
      // Capture the launch callback so the test can await navigation independently of the UI's
      // asynchronous hide acknowledgement.
      stub(vomnibarPage.ui, "hide", (callback) => {
        navigation = callback();
      });
      await vomnibarPage.ui.handleEnterKey({});
      await navigation;
      assert.equal(`http://${query}`, opened);
    }
  });

  should("show an error for unknown engines and executable engine URLs", async () => {
    await initializeSearchPage("?engine=constructor&q=cats");
    assert.equal(null, opened);
    assert.isTrue(
      document.getElementById("search-status").textContent.includes("Unknown search engine"),
    );
    stub(Settings._settings, "searchEngines", "bad: javascript:alert('%s')");
    await initializeSearchPage("?engine=bad&q=cats");
    assert.equal(null, opened);
    assert.isTrue(
      document.getElementById("search-status").textContent.includes("cannot be opened"),
    );
  });

  should("open the first navigable result only after the search completes", async () => {
    completions = [
      { url: "javascript:alert(1)", html: "unsafe" },
      { url: "https://example.com/first", html: "first" },
      { url: "https://example.com/second", html: "second" },
    ];
    await initializeSearchPage("?source=bookmarks&q=%2Fgh&open=first");
    assert.equal("https://example.com/first", opened);
  });

  should(
    "retain the query when there are no matches or automatic opening is disabled",
    async () => {
      await initializeSearchPage("?source=bookmarks&q=missing&open=first");
      assert.equal(null, opened);
      assert.equal("missing", document.querySelector("input").value);
      assert.isTrue(document.getElementById("search-status").textContent.includes("No matching"));
      completions = [{ url: "https://example.com/first", html: "first" }];
      await initializeSearchPage("?source=bookmarks&q=first");
      assert.equal(null, opened);
      assert.equal(1, document.querySelectorAll("li").length);
      await initializeSearchPage("?source=tabs&q=&open=first");
      assert.equal(null, opened);
    },
  );

  should("scope a prefilled omni query to its custom engine", async () => {
    await initializeSearchPage("?q=w+cats");
    assert.equal("cats", vomnibarPage.ui.input.value);
    assert.equal("w cats", vomnibarPage.ui.getInputValueAsQuery());
  });
});
