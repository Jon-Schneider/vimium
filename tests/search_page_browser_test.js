// Run with: deno run -A tests/search_page_browser_test.js
// Uses Puppeteer's installed Chrome, or PUPPETEER_EXECUTABLE_PATH, with a temporary profile.
import puppeteer from "puppeteer";
import { strict as assert } from "node:assert";

const root = new URL("../", import.meta.url).pathname;
const profile = await Deno.makeTempDir({ prefix: "vimium-search-test-" });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
  return new Response(`<title>Destination</title><h1>${new URL(request.url).pathname}</h1>`, {
    headers: { "Content-Type": "text/html" },
  });
});
const base = `http://127.0.0.1:${server.addr.port}`;
let browser;
try {
  browser = await puppeteer.launch({
    headless: true,
    userDataDir: profile,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  const target = await browser.waitForTarget((t) => t.type() == "service_worker");
  const worker = await target.worker();
  const id = new URL(target.url()).host;
  const search = `chrome-extension://${id}/pages/search.html`;
  const { folderId, uniqueId } = await worker.evaluate(async (base) => {
    await Settings.onLoaded();
    Settings.set("searchEngines", `w: ${base}/search?q=%s Test engine`);
    const folder = await chrome.bookmarks.create({ title: "/gh" });
    for (
      const [title, path] of [
        ["GitHub /GH /github", "unique"],
        ["Longer /github", "longer"],
        ["Folder match only", "folder"],
        ["URL match only", "gh"],
        ["Alpha /dup", "first"],
        ["Bravo /dup", "second"],
        ["Unsafe /bad", "javascript:alert(1)"],
        ["Unicode /日本 /c++", "unicode"],
      ]
    ) {
      const bookmark = await chrome.bookmarks.create({
        parentId: folder.id,
        title,
        url: path.startsWith("javascript:") ? path : `${base}/${path}`,
      });
      if (path == "unique") globalThis.uniqueBookmarkId = bookmark.id;
    }
    return { folderId: folder.id, uniqueId: globalThis.uniqueBookmarkId };
  }, base);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const waitForURL = (url) =>
    page.waitForFunction((expected) => location.href == expected, {}, url);
  const visit = async (query) => {
    await page.goto(`${search}?${query}`);
  };

  await page.goto(`${base}/start`);
  await visit("source=bookmarks&q=%2FGH&match=title-token&open=first");
  await waitForURL(`${base}/unique`);
  await page.goBack();
  await waitForURL(`${base}/start`);
  console.log("PASS exact alias redirect, case folding, and Back skipping the search page");

  await visit("source=bookmarks&q=%2F日本&match=title-token&open=first");
  await waitForURL(`${base}/unicode`);
  await visit("source=bookmarks&q=%2Fc%2B%2B&match=title-token&open=first");
  await waitForURL(`${base}/unicode`);
  console.log("PASS Unicode and punctuation tokens");

  await visit("source=bookmarks&q=%2Fdup&match=title-token");
  await page.waitForFunction(() => document.querySelectorAll("li").length == 2);
  assert.equal(await page.$eval("input", (input) => input == document.activeElement), true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await waitForURL(`${base}/second`);
  await visit("source=bookmarks&q=%2Fdup&match=title-token&open=first");
  await waitForURL(`${base}/first`);
  console.log("PASS duplicate selection and automatic first ranked result");

  await visit("source=bookmarks&q=missing&match=title-token&open=first");
  await page.waitForFunction(() =>
    document.getElementById("search-status").textContent.includes("No matching")
  );
  await page.keyboard.press("Enter");
  assert.equal(new URL(page.url()).pathname, "/pages/search.html");
  await page.$eval("input", (input) => {
    input.value = "/gh";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll("li").length == 1);
  await page.keyboard.press("Enter");
  await waitForURL(`${base}/unique`);
  console.log("PASS missing result remains editable, Enter opens a corrected query");

  await visit("source=tabs&q=nonexistentquery&open=first");
  await page.waitForFunction(() =>
    document.getElementById("search-status").textContent.includes("No matching")
  );
  assert.equal(await page.$$eval("li", (items) => items.length), 0);
  await visit("source=omni&q=nonexistentquery&open=first");
  await page.waitForFunction(() =>
    document.getElementById("search-status").textContent.includes("No matching")
  );
  assert.equal(await page.$$eval("li", (items) => items.length), 0);
  console.log("PASS tabs and omni searches exclude their own handoff tab");

  await worker.evaluate(async ({ base, folderId }) => {
    for (let index = 0; index < 10; index++) {
      await chrome.bookmarks.create({
        parentId: folderId,
        title: "/crowded",
        url: `javascript:alert(${index})`,
      });
    }
    await chrome.bookmarks.create({
      parentId: folderId,
      title: "Longer title /crowded",
      url: `${base}/valid`,
    });
  }, { base, folderId });
  await visit("source=bookmarks&q=%2Fcrowded&match=title-token&open=first");
  await waitForURL(`${base}/valid`);
  console.log("PASS ten excluded bookmarklets cannot crowd out a navigable match");

  await visit("source=bookmarks&q=%2Fbad&match=title-token&open=first");
  await page.waitForFunction(() =>
    document.getElementById("search-status").textContent.includes("No matching")
  );
  assert.equal(await page.$$eval("li", (items) => items.length), 0);
  await visit("engine=constructor&q=anything");
  await page.waitForFunction(() =>
    document.getElementById("search-status").textContent.includes("Unknown search engine")
  );
  console.log("PASS bookmarklets excluded and invalid engine stays local");

  const bareUrl = `${base.slice("http://".length)}/bare`;
  await visit(`source=omni&q=${encodeURIComponent(bareUrl)}`);
  await page.waitForFunction(() => document.querySelector("input") == document.activeElement);
  await page.keyboard.press("Enter");
  await waitForURL(`${base}/bare`);
  console.log("PASS Enter navigates an unselected bare URL in standalone omni search");

  await visit("engine=w&q=cats+%26+dogs");
  await waitForURL(`${base}/search?q=cats%20%26%20dogs`);
  await visit("source=omni&q=w+cats");
  await page.waitForFunction(() => document.querySelector("li") != null);
  assert.equal(await page.$eval("input", (input) => input.value), "cats");
  await page.keyboard.press("Enter");
  await waitForURL(`${base}/search?q=cats`);
  console.log("PASS configured engine dispatch and prefilled omni engine search");

  await worker.evaluate(async ({ uniqueId, base }) => {
    await chrome.bookmarks.update(uniqueId, { title: "Renamed /new", url: `${base}/renamed` });
  }, { uniqueId, base });
  await visit("source=bookmarks&q=%2Fnew&match=title-token&open=first");
  await waitForURL(`${base}/renamed`);
  await worker.evaluate(async (folderId) => {
    await chrome.bookmarks.removeTree(folderId);
  }, folderId);
  await visit("source=bookmarks&q=%2Fnew&match=title-token&open=first");
  await page.waitForFunction(() =>
    document.getElementById("search-status").textContent.includes("No matching")
  );
  console.log("PASS bookmark edits and removals are refreshed on subsequent searches");

  const destinationTab = await browser.newPage();
  await destinationTab.goto(`${base}/tab`);
  const closed = new Promise((resolve) => page.once("close", resolve));
  await visit("source=tabs&q=Destination&open=first");
  await closed;
  assert.equal(page.isClosed(), true);
  console.log("PASS tab search switches to an existing result and closes the handoff tab");
  assert.deepEqual(errors, []);
  console.log("PASS no page errors");
} finally {
  if (browser) await browser.close();
  await server.shutdown();
  await Deno.remove(profile, { recursive: true });
}
