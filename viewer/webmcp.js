// WebMCP tools use the current document API and retain compatibility with earlier previews.
// All requests stay in this authenticated origin. Credentials never enter JavaScript.
(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  const archive = (window.TeamsArchive ||= {});
  archive.call = async (name, args = {}) => {
    const response = await fetch("api/call", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: args }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Archive request failed");
    return result;
  };
  archive.ready = (async () => {
    const response = await fetch("api/tools", { credentials: "same-origin" });
    if (!response.ok) return false;
    const { tools } = await response.json();
    archive.tools = tools;
    const context = document.modelContext || navigator.modelContext;
    if (context?.registerTool) {
      const controller = new AbortController();
      try {
        for (const tool of tools) {
          await context.registerTool(
            { ...tool, execute: (args) => archive.call(tool.name, args) },
            { signal: controller.signal },
          );
        }
        window.addEventListener("pagehide", () => controller.abort(), {
          once: true,
        });
        archive.webmcpRegistered = true;
      } catch {
        controller.abort();
        archive.webmcpRegistered = false;
      }
    }
    return true;
  })().catch(() => false);
})();
