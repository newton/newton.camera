// Eleventy docs: https://www.11ty.dev/docs/
import { HtmlBasePlugin } from "@11ty/eleventy";

export default function (eleventyConfig) {
  // Lets the site work at a sub-path (e.g. you.github.io/newton-camera/) before the domain is connected.
  eleventyConfig.addPlugin(HtmlBasePlugin);

  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({
    "node_modules/@fontsource/host-grotesk/files/host-grotesk-latin-{400,500}-{normal,italic}.woff2": "assets/fonts",
  });
  eleventyConfig.addPassthroughCopy({ "src/CNAME": "CNAME" });
  eleventyConfig.addWatchTarget("content/");

  // Paragraphs from a plain-text block in site.yml
  eleventyConfig.addFilter("paras", (s = "") =>
    s.trim().split(/\n\s*\n/).map((p) => `<p>${p.replace(/\s+/g, " ").trim()}</p>`).join("\n"));

  eleventyConfig.addFilter("pad", (n, w = 2) => String(n).padStart(w, "0"));

  // Asset version: changes whenever site.css or site.js changes, so browsers fetch the new file.
  eleventyConfig.addGlobalData("build", async () => {
    const { createHash } = await import("node:crypto");
    const fs = await import("node:fs/promises");
    const h = createHash("sha1");
    for (const f of ["src/assets/site.css", "src/assets/site.js"]) h.update(await fs.readFile(f));
    return { year: new Date().getFullYear(), v: h.digest("hex").slice(0, 8) };
  });

  // Delete resized images that no page references any more (removed or re-edited photos).
  eleventyConfig.on("eleventy.after", async ({ results, dir }) => {
    const fs = await import("node:fs/promises");
    const html = results.map((r) => r.content || "").join("\n");
    let removed = 0;
    for (const f of await fs.readdir(`${dir.output}/img`).catch(() => [])) {
      if (!html.includes(`/img/${f}`)) { await fs.rm(`${dir.output}/img/${f}`); removed++; }
    }
    if (removed) console.log(`[img] removed ${removed} unused image files`);
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    templateFormats: ["njk", "md"],
    htmlTemplateEngine: "njk",
    pathPrefix: process.env.PATH_PREFIX || "/",
  };
}
