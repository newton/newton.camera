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
import sharp from "sharp";

// Colors around an image's outer edge. The home page turns them into a conic gradient centred on
// the work: each direction from the image takes the color of the edge on that side, so the work
// bleeds into the page and floats. Text colors come from the edge's average and stay readable.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const RAYS = 24;
async function edgePalette(file) {
  const band = 3;
  const { data, info } = await sharp(file).resize(96, 96, { fit: "inside" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const px = (x, y) => { const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const sum = [0, 0, 0]; let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= band && x < W - band && y >= band && y < H - band) continue;
    const c = px(x, y); sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; n++;
  }
  const bg = sum.map((v) => v / n);
  // Walk clockwise from 12 o'clock (CSS conic-gradient's 0deg), casting a ray from the centre to the
  // edge at each angle and averaging a small patch of the outer band where it lands.
  const ring = [];
  for (let k = 0; k < RAYS; k++) {
    const a = (k / RAYS) * 2 * Math.PI, dx = Math.sin(a), dy = -Math.cos(a);
    const t = Math.min(dx ? (W / 2) / Math.abs(dx) : Infinity, dy ? (H / 2) / Math.abs(dy) : Infinity);
    const ex = Math.round(W / 2 + dx * t), ey = Math.round(H / 2 + dy * t);
    const acc = [0, 0, 0]; let m = 0;
    for (let oy = -band; oy <= band; oy++) for (let ox = -band; ox <= band; ox++) {
      const c = px(ex + ox, ey + oy); acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; m++;
    }
    ring.push(hex(acc.map((v) => v / m)));
  }
  const step = 360 / RAYS;
  const gradient = ring.map((c, k) => `${c} ${k * step}deg`).join(", ") + `, ${ring[0]} 360deg`;
  // Text sits in the corners, over the gradient rather than the average, so pick whichever of
  // dark or light text stays most readable against the worst edge color.
  const ringRgb = ring.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  const worst = (c) => Math.min(...ringRgb.map((r) => contrast(c, r)), contrast(c, bg));
  const dark = [38, 38, 36], pale = [239, 239, 236];
  const text = worst(dark) >= worst(pale) ? dark : pale;
  const floor = Math.min(4.5, worst(text));
  let t = 0.45;                                          // secondary text: a step toward the background,
  while (t > 0 && worst(mix(text, bg, t)) < floor) t -= 0.05;   // never less readable than 4.5:1 (or the main text)
  // The name and menu sit at the top of the page: choose their color from the top edge alone.
  const topRgb = ringRgb.filter((_, k) => k <= RAYS / 6 || k >= RAYS - RAYS / 6);
  const worstTop = (c) => Math.min(...topRgb.map((r) => contrast(c, r)));
  const top = worstTop(dark) >= worstTop(pale) ? dark : pale;
  return { bg: hex(bg), text: hex(text), muted: hex(mix(text, bg, Math.max(t, 0))), top: hex(top), gradient };
}


// content/galleries: folders you add yourself (committed to git).
// content/lightroom: albums pulled by `npm run sync` (not in git; cached by the publish workflow).
// Links: a list of URLs (or {label, url}). Shown the way people write them:
// Instagram and Bluesky as @handle, everything else as a clean address (polinabertou.com, x.com/polina).
function displayLink(u) {
  const host = u.hostname.replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (/(^|\.)instagram\.com$/.test(host) && parts[0]) return `@${parts[0]}`;
  if (/(^|\.)bsky\.app$/.test(host) && parts[0] === "profile" && parts[1]) return `@${parts[1]}`;
  return host + (parts.length ? `/${parts.join("/")}` : "");
}
function normalizeLinks(list) {
  const out = [];
  for (const item of [].concat(list || [])) {
    let url = typeof item === "string" ? item : item?.url;
    if (!url) continue;
    url = String(url).trim();
    if (/^@[\w.]+$/.test(url)) url = `https://www.instagram.com/${url.slice(1)}/`; // "@handle" means Instagram
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    out.push({ url, label: (typeof item === "object" && item.label) || displayLink(parsed) });
  }
  return out;
}
// represented_by: one gallery or a list. Each is a name, or {name, links}.
function normalizeRepresentation(value) {
  return [].concat(value || []).map((g) => {
    if (typeof g === "string") return { name: g, links: [] };
    if (!g?.name) return null;
    return { name: g.name, links: normalizeLinks(g.links || g.url) };
  }).filter(Boolean);
}

const ROOTS = ["content/galleries", "content/lightroom"];
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
  const folders = [];
  for (const root of ROOTS) {
    try {
      for (const d of await fs.readdir(root, { withFileTypes: true })) if (d.isDirectory()) folders.push({ root, slug: d.name });
    } catch {}
  }

  const galleries = [];
  for (const { root, slug } of folders) {
    if (galleries.some((g) => g.slug === slug)) { console.warn(`[galleries] "${slug}" exists in more than one folder; using the first.`); continue; }
    const dir = path.join(root, slug);
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
          filenameFormat: (id, s, width, format) => `${slug}-${path.parse(f).name}-${id.slice(0, 8)}-${width}.${format}`,
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
    const sharedBy = (k, min) => (photos.length >= min && photos.every((p) => p[k] && p[k] === photos[0][k]) ? photos[0][k] : "");
    if (sharedBy("title", 2)) photos.forEach((p) => (p.title = ""));
    // A "title" that just repeats the copyright line ("Polina Tereshina 2023" / "© Polina Tereshina 2023")
    // is a name stamp, not the artwork's title.
    photos.forEach((p) => { if (p.title && p.rights && p.title === p.rights.replace(/^\s*(©|\(c\)|copyright)\s*/i, "")) p.title = ""; });
    const credit = conf.credit ?? sharedBy("rights", 1);

    const cover = photos.find((p) => p.file === conf.cover) || photos[0];
    try { cover.edge = await edgePalette(path.join(dir, cover.file)); } catch { cover.edge = null; }
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
      links: normalizeLinks(conf.links),
      representedBy: normalizeRepresentation(conf.represented_by ?? conf.gallerist),
      sort: conf.sort ?? null,
      cover,
      photos,
    });
  }

  // Newest first, unless a gallery sets `sort:` (lower comes first).
  galleries.sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || String(b.year).localeCompare(String(a.year)) || a.title.localeCompare(b.title));
  return galleries;
}
