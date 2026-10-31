// Turns content/galleries/<slug>/ folders into gallery data for the templates.
//
// Per photo, it reads:
//   - Title and Caption that Lightroom embeds on export (XMP / IPTC / EXIF)
//   - pixel size, and makes responsive AVIF/WebP/JPEG sizes
//
// Per gallery (optional gallery.yml): artist, project, year, description, credit, cover, order, hidden.
// Without artist/project, a title like "Polina Tereshina, Macedonia Institute residency, 2023"
// is split at the first comma into artist and project.
import fs from "node:fs/promises";
import path from "node:path";
import * as yaml from "js-yaml";
import exifr from "exifr";
import Image from "@11ty/eleventy-img";

const ROOT = "content/galleries";
const WIDTHS = [480, 960, 1600, 2400];
const IMG_EXT = /\.(jpe?g|png|webp|tiff?|avif)$/i;

const text = (v) => {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v.value ?? v["x-default"] ?? Object.values(v)[0]);
  return String(v);
};

async function readMeta(file) {
  try {
    const m = await exifr.parse(file, { xmp: true, iptc: true, ifd0: true, exif: true });
    if (!m) return {};
    return {
      title: text(m.title) || text(m.ObjectName) || text(m.XPTitle),
      caption: text(m.description) || text(m.Caption) || text(m["Caption-Abstract"]) || text(m.ImageDescription),
      rights: text(m.rights) || text(m.Copyright) || text(m.CopyrightNotice),
      keywords: [].concat(m.subject || m.Keywords || []).map(text).filter(Boolean),
      taken: m.DateTimeOriginal || m.CreateDate || null,
    };
  } catch {
    return {};
  }
}


export default async function () {
  let slugs = [];
  try { slugs = (await fs.readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}

  const galleries = [];
  for (const slug of slugs) {
    const dir = path.join(ROOT, slug);
    let conf = {};
    try { conf = yaml.load(await fs.readFile(path.join(dir, "gallery.yml"), "utf8")) || {}; } catch {}
    if (conf.hidden) continue;

    let files = (await fs.readdir(dir)).filter((f) => IMG_EXT.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (Array.isArray(conf.order)) files = [...conf.order.filter((f) => files.includes(f)), ...files.filter((f) => !conf.order.includes(f))];

    const photos = [];
    for (const [i, f] of files.entries()) {
      const src = path.join(dir, f);
      const [meta, img] = await Promise.all([
        readMeta(src),
        Image(src, {
          widths: WIDTHS,
          formats: ["avif", "webp", "jpeg"],
          outputDir: "_site/img/",
          urlPath: "/img/",
          filenameFormat: (id, s, width, format) => `${slug}-${path.parse(f).name}-${width}.${format}`,
          sharpJpegOptions: { quality: 82, mozjpeg: true },
          sharpWebpOptions: { quality: 80 },
          sharpAvifOptions: { quality: 60, effort: 2 },
        }),
      ]);
      const jpg = img.jpeg;
      photos.push({
        index: i + 1,
        file: f,
        id: path.parse(f).name,
        title: meta.title || "",
        caption: meta.caption || "",
        rights: meta.rights || "",
        keywords: meta.keywords || [],
        width: jpg.at(-1).width,
        height: jpg.at(-1).height,
        ratio: jpg.at(-1).width / jpg.at(-1).height,
        large: jpg.at(-1).url,
        sources: {
          avif: img.avif.map((s) => s.srcset).join(", "),
          webp: img.webp.map((s) => s.srcset).join(", "),
          jpeg: jpg.map((s) => s.srcset).join(", "),
        },
        fallback: jpg.find((s) => s.width >= 960)?.url || jpg.at(-1).url,
        thumb: jpg[0].url,
      });
    }
    if (!photos.length) continue;

    // A title or copyright line that every photo shares (e.g. one applied on import)
    // describes the gallery, not the photo: show it once, not on every plate.
    const shared = (k) => (photos.length > 1 && photos.every((p) => p[k] && p[k] === photos[0][k]) ? photos[0][k] : "");
    if (shared("title")) photos.forEach((p) => (p.title = ""));
    const credit = conf.credit ?? shared("rights");

    const cover = photos.find((p) => p.file === conf.cover) || photos[0];
    const title = conf.title || slug.replace(/-/g, " ");
    const [first, ...rest] = title.split(/,\s*/);
    galleries.push({
      slug,
      title,
      artist: conf.artist || (rest.length ? first : title),
      project: conf.project ?? (rest.length ? rest.join(", ") : ""),
      year: conf.year || "",
      description: conf.description || "",
      credit,
      sort: conf.sort ?? null,
      cover,
      photos,
    });
  }

  // Newest first, unless a gallery sets `sort:` (lower comes first).
  galleries.sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || String(b.year).localeCompare(String(a.year)) || a.title.localeCompare(b.title));
  return galleries;
}
