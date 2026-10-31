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

  eleventyConfig.addGlobalData("build", () => ({ year: new Date().getFullYear() }));

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    templateFormats: ["njk", "md"],
    htmlTemplateEngine: "njk",
    pathPrefix: process.env.PATH_PREFIX || "/",
  };
}
