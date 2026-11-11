// Teams web endpoints are discovered from this user's own browser session.
// Authentication lives in memory and in a private, dedicated browser profile.
const { chromium } = require("playwright");
const path = require("node:path");
const { read, save, scrub, sleep } = require("./storage.cjs");
const teamsHosts = new Set(["teams.cloud.microsoft", "teams.microsoft.com"]);
const isSharePoint = (host) => host.endsWith(".sharepoint.com");
const isMedia = (host) =>
  host.endsWith(".asyncgw.teams.microsoft.com") ||
  host.endsWith(".asm.skype.com");
const authKeys = new Set([
  "authorization",
  "authentication",
  "x-ms-skypetoken",
]);

async function connect(options) {
  const context = await chromium.launchPersistentContext(options.profile, {
    headless: Boolean(options.headless),
    ...(options.channel ? { channel: options.channel } : {}),
    acceptDownloads: false,
    viewport: { width: 1280, height: 900 },
  });
  const captured = new Map();
  const endpoints = {};
  let selfId = options.selfId || "";
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "https:") return;
    const service =
      teamsHosts.has(url.hostname) &&
      url.pathname.match(/^\/api\/(csa|chatsvc|mt)\/[^/]+/);
    if (!service && !isSharePoint(url.hostname) && !isMedia(url.hostname))
      return;
    const prefix = service ? service[1] : url.origin;
    request
      .allHeaders()
      .then((headers) => {
        const auth = Object.fromEntries(
          Object.entries(headers).filter(([k]) =>
            authKeys.has(k.toLowerCase()),
          ),
        );
        if (!Object.keys(auth).length) return;
        captured.set(prefix, { origin: url.origin, headers: auth });
        if (service) endpoints[service[1]] = url.origin + service[0];
      })
      .catch(() => {});
    const owner = url.pathname.match(
      /\/beta\/users\/([a-f0-9-]{36})\/profilepicturev2\//i,
    );
    if (owner && service) selfId ||= "8:orgid:" + owner[1];
  });
  const page = context.pages()[0] || (await context.newPage());
  const endpoint = (service) => {
    if (!endpoints[service])
      throw new Error(
        "Teams did not expose the " +
          service +
          " service. Open a chat and retry.",
      );
    return endpoints[service];
  };
  async function refresh() {
    await page.goto("https://teams.microsoft.com/v2/", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    console.log(
      "Waiting for Teams. Complete Microsoft sign-in in the browser if necessary.",
    );
    const until = Date.now() + (options.headless ? 90000 : 300000);
    while (Date.now() < until) {
      if (captured.has("csa") && captured.has("chatsvc")) break;
      await sleep(1000);
    }
    if (!captured.has("csa") || !captured.has("chatsvc"))
      throw new Error(
        "Teams sign-in or API discovery is incomplete. Run login, open a chat, and retry.",
      );
    if (options.output) {
      const file = path.join(options.output, "archive-settings.json");
      save(file, {
        ...read(file, {}),
        selfId,
        snapshotTime: new Date().toISOString(),
        timeZone: "Asia/Seoul",
        synthetic: false,
      });
    }
  }
  const siteLoads = new Map();
  async function headersFor(target) {
    const url = new URL(target);
    if (url.protocol !== "https:")
      throw new Error("Authenticated requests require HTTPS");
    let entry;
    if (teamsHosts.has(url.hostname)) {
      const service = url.pathname.match(/^\/api\/(csa|chatsvc|mt)\//)?.[1];
      entry = service && captured.get(service);
    } else if (isSharePoint(url.hostname)) {
      if (!captured.has(url.origin)) {
        if (!siteLoads.has(url.origin))
          siteLoads.set(
            url.origin,
            (async () => {
              const tab = await context.newPage();
              try {
                const site =
                  url.pathname.match(/^\/(sites|teams|personal)\/[^/]+/)?.[0] ||
                  "";
                await tab
                  .goto(url.origin + site, {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                  })
                  .catch(() => {});
                for (let i = 0; i < 15 && !captured.has(url.origin); i++)
                  await sleep(1000);
              } finally {
                await tab.close();
              }
            })(),
          );
        await siteLoads.get(url.origin);
      }
      entry = captured.get(url.origin);
      // The context request can also use that exact site's own cookies. Never
      // reuse a bearer captured for another SharePoint hostname/tenant.
      if (!entry) return {};
    } else if (isMedia(url.hostname)) {
      entry = captured.get(url.origin);
      if (!entry) {
        // AMS accepts a Skype token, not a Microsoft Graph/SharePoint bearer.
        const source = captured.get("chatsvc")?.headers || {};
        return Object.fromEntries(
          Object.entries(source).filter(
            ([k]) => k === "authentication" || k === "x-ms-skypetoken",
          ),
        );
      }
    } else throw new Error("Authentication is not available for this origin");
    if (!entry || entry.origin !== url.origin)
      throw new Error("No authentication captured for the requested origin");
    return { ...entry.headers };
  }
  async function get(url, raw = false) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await context.request.get(url, {
        headers: await headersFor(url),
        timeout: 90000,
        maxRedirects: 0,
      });
      const status = response.status();
      if (
        status === 401 &&
        attempt === 0 &&
        teamsHosts.has(new URL(url).hostname)
      ) {
        await response.dispose();
        await refresh();
        continue;
      }
      if (status === 429 || status >= 500) {
        const delay = Math.max(
          Number(response.headers()["retry-after"] || 0) * 1000,
          1500 * 2 ** attempt,
        );
        await response.dispose();
        await sleep(Math.min(delay, 60000));
        continue;
      }
      if (raw) return response;
      let data;
      try {
        data = await response.json();
      } catch {
        data = {
          error: "Non-JSON response",
          contentType: response.headers()["content-type"],
        };
      }
      await response.dispose();
      return { status, data: scrub(data) };
    }
    throw new Error("API retry limit reached");
  }
  try {
    await refresh();
  } catch (error) {
    await context.close();
    throw error;
  }
  return {
    context,
    page,
    captured,
    endpoint,
    get,
    headersFor,
    refresh,
    get selfId() {
      return selfId;
    },
    close: () => context.close(),
  };
}
module.exports = { connect, teamsHosts, isSharePoint, isMedia };
