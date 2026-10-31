// Pulls public Lightroom shared albums (listed in content/lightroom.yml) into
// content/lightroom/<slug>/ (not committed to git; the publish workflow caches it) as numbered JPEGs with title + caption embedded.
//
// How: opens each share link in headless Chromium, reads the album data the
// Lightroom web viewer itself loads, and downloads the 2048px renditions.
// Adobe has no official public API for shared albums, so this relies on the
// web viewer's internal format. If Adobe changes it, the script stops with a
// clear message and the site keeps building from whatever is already in
// content/galleries/ — nothing gets deleted. The export-a-folder route in
// README.md always works as a fallback.
//
//   npm run sync               sync every album
//   npm run sync -- slug       sync one album
import fs from "node:fs/promises";
import path from "node:path";
import * as yaml from "js-yaml";
import sharp from "sharp";
import { chromium } from "playwright";

const CONFIG = "content/lightroom.yml";
const OUT = "content/lightroom";
const MANIFEST = ".lightroom.json"; // per-gallery record of what was synced
const SIZES = ["2048", "1280", "640"]; // preferred rendition, then fallbacks

const only = process.argv[2];
const conf = yaml.load(await fs.readFile(CONFIG, "utf8")) || {};
// Optional: publish only photos with this Lightroom color label (e.g. "green"). Per album, `only_label:` overrides it.
const onlyLabel = conf.only_label;
const albums = (conf.albums || []).filter((a) => a && a.url && a.slug && (!only || a.slug === only));
if (!albums.length) {
  if (!only) await fs.rm(OUT, { recursive: true, force: true });
  console.log("No Lightroom albums listed in content/lightroom.yml. Nothing to sync.");
  process.exit(0);
}

const stripGuard = (t) => t.replace(/^\s*while\s*\(\s*1\s*\)\s*\{\s*\}\s*/, "");
const parseJSON = (t) => { try { return JSON.parse(stripGuard(t)); } catch { return null; } };
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const pick = (v) => (v == null ? "" : typeof v === "string" ? v : v["x-default"] ?? v.value ?? Object.values(v)[0] ?? "");
const alt = (tag, v) => (v ? `<dc:${tag}><rdf:Alt><rdf:li xml:lang="x-default">${esc(v)}</rdf:li></rdf:Alt></dc:${tag}>` : "");
const xmp = (title, desc, rights) => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">${alt("title", title)}${alt("description", desc)}${alt("rights", rights)}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
// The share's JSON lives on lightroom.adobe.com/v2; its images on lightroom.adobe.com/v2c.
const jsonUrl = (href, base) => new URL(href, base).href.replace("://photos.adobe.io/v2/", "://lightroom.adobe.com/v2/");
const imageUrl = (href, base) => new URL(href, base).href.replace("://photos.adobe.io/v2/", "://lightroom.adobe.com/v2c/");

export function readAsset(r, base) {
  const a = r.asset || r;
  const links = a.links || {};
  let href = null;
  for (const s of SIZES) if (links[`/rels/rendition_type/${s}`]) { href = links[`/rels/rendition_type/${s}`].href; break; }
  if (!href) return null;
  const url = imageUrl(href, base);
  const x = a.payload?.xmp || {};
  return {
    id: a.id,
    // The rendition link names the edit revision, so a re-edit in Lightroom changes it.
    revision: href.match(/revisions\/([^/]+)/)?.[1] || a.payload?.userUpdated || a.updated || "",
    order: r.payload?.order ?? "",
    title: pick(x.dc?.title),
    caption: pick(x.dc?.description),
    rights: pick(x.dc?.rights),
    label: String(x.photoshop?.LabelColor || x.xmp?.Label || "").toLowerCase(),
    captured: a.payload?.captureDate || "",
    url,
  };
}

async function readAlbum(page, url) {
  const pages = [];
  let albumName = "", coverId = "";
  page.on("response", async (res) => {
    const u = res.url();
    if (!/\/v2\/spaces\/[^/]+\/albums\/[^/?]+/.test(u)) return;
    const data = parseJSON(await res.text().catch(() => ""));
    if (data && Array.isArray(data.resources)) pages.push({ url: u, data });
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
  // Scroll so the viewer requests every page of the album.
  let seen = -1;
  for (let i = 0; i < 40 && seen !== pages.length; i++) {
    seen = pages.length;
    await page.mouse.wheel(0, 20_000);
    await page.waitForTimeout(1200);
  }
  // Follow any "next" links the viewer didn't fetch itself.
  const fetched = new Set(pages.map((p) => p.url));
  for (let i = 0; i < pages.length; i++) {
    const { data } = pages[i];
    const next = data.links?.next?.href;
    if (!next) continue;
    const nu = jsonUrl(next, data.base || pages[i].url);
    if (fetched.has(nu)) continue;
    fetched.add(nu);
    const d = parseJSON(await (await page.request.get(nu)).text());
    if (d?.resources) pages.push({ url: nu, data: d });
  }
  // Album name and cover come from the album record, which the viewer doesn't always request.
  if (pages[0]) {
    const albumUrl = pages[0].url.replace(/\/assets.*$/, "");
    const rec = parseJSON(await (await page.request.get(albumUrl)).text().catch(() => ""));
    albumName = rec?.payload?.name || "";
    coverId = rec?.payload?.cover?.id || "";
  }
  if (!albumName) albumName = (await page.title()).replace(/\s*[-|]\s*Adobe.*$/i, "").trim();
  const byId = new Map();
  for (const { data, url: u } of pages) {
    const base = data.base || u;
    for (const r of data.resources) { const a = readAsset(r, base); if (a && !byId.has(a.id)) byId.set(a.id, a); }
  }
  const assets = [...byId.values()];
  // Lightroom's order keys compare as plain strings ("9---0" < "9---1").
  if (assets.some((a) => a.order)) assets.sort((a, b) => (String(a.order) < String(b.order) ? -1 : String(a.order) > String(b.order) ? 1 : 0));
  return { albumName, coverId, assets };
}

// Albums no longer listed in lightroom.yml leave the site.
if (!only) {
  const listed = new Set(albums.map((a) => a.slug));
  for (const d of await fs.readdir(OUT, { withFileTypes: true }).catch(() => [])) {
    if (d.isDirectory() && !listed.has(d.name)) { await fs.rm(path.join(OUT, d.name), { recursive: true, force: true }); console.log(`removed ${d.name} (no longer in lightroom.yml)`); }
  }
}

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
let failed = 0;
for (const album of albums) {
  const dir = path.join(OUT, album.slug);
  await fs.mkdir(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  try {
    console.log(`\n${album.slug}: reading ${album.url}`);
    const { albumName, coverId, assets: all } = await readAlbum(page, album.url);
    if (!all.length) throw new Error("Found no photos. Check the album's link access is set to \"Anyone can view\", or Adobe changed the viewer — use the export-folder route meanwhile.");
    const want = String(album.only_label ?? onlyLabel ?? "").toLowerCase().trim();
    const assets = want ? all.filter((a) => a.label === want) : all;
    if (want) console.log(`  ${assets.length} of ${all.length} photos labelled ${want}`);
    if (!assets.length) {
      await fs.rm(dir, { recursive: true, force: true });
      console.log(`  left off the site: no photos labelled ${want}`);
      continue;
    }

    let manifest = {};
    try { manifest = JSON.parse(await fs.readFile(path.join(dir, MANIFEST), "utf8")); } catch {}
    const next = {};
    const width = String(assets.length).length < 3 ? 3 : String(assets.length).length;
    for (const [i, a] of assets.entries()) {
      const file = `${String(i + 1).padStart(width, "0")}-${a.id.slice(0, 8)}.jpg`;
      next[a.id] = { file, revision: a.revision, title: a.title, caption: a.caption, rights: a.rights };
      const prev = manifest[a.id];
      const unchanged = prev && prev.file === file && prev.revision === a.revision && prev.title === a.title && prev.caption === a.caption && prev.rights === a.rights;
      if (unchanged && (await fs.stat(path.join(dir, file)).catch(() => null))) continue;
      if (prev && prev.file !== file) {
        // Same photo, new position in the album: just rename it.
        const same = prev.revision === a.revision && prev.title === a.title && prev.caption === a.caption && prev.rights === a.rights;
        if (same && (await fs.rename(path.join(dir, prev.file), path.join(dir, file)).then(() => true, () => false))) { console.log(`  moved  ${prev.file} → ${file}`); continue; }
        await fs.rm(path.join(dir, prev.file), { force: true });
      }
      const res = await page.request.get(a.url, { headers: { referer: album.url } });
      if (!res.ok()) throw new Error(`Download failed (${res.status()}) for ${a.title || a.id}`);
      await sharp(await res.body()).jpeg({ quality: 92 }).withXmp(xmp(a.title, a.caption, a.rights)).toFile(path.join(dir, file));
      console.log(`  ${prev ? "updated" : "added"}  ${file}  ${a.title}`);
    }
    for (const [id, p] of Object.entries(manifest)) if (!next[id]) { await fs.rm(path.join(dir, p.file), { force: true }); console.log(`  removed  ${p.file}`); }
    await fs.writeFile(path.join(dir, MANIFEST), JSON.stringify(next, null, 2));

    const gy = path.join(dir, "gallery.yml");
    let g = {};
    try { g = yaml.load(await fs.readFile(gy, "utf8")) || {}; } catch {}
    // For a synced gallery, Lightroom and content/lightroom.yml are the source of truth:
    // these keys are rewritten on every sync, so a renamed album or an edited entry shows up.
    // Any other keys you add to gallery.yml by hand (sort, hidden, credit…) are kept.
    const managed = {
      title: album.title || albumName || album.slug,
      year: album.year, description: album.description,
      artist: album.artist, project: album.project,
      sort: album.sort, hidden: album.hidden, credit: album.credit,
      links: album.links, represented_by: album.represented_by ?? album.gallerist,
      cover: album.cover || (coverId && next[coverId] ? next[coverId].file : undefined),
    };
    for (const [k, v] of Object.entries(managed)) { if (v !== undefined && v !== null && v !== "" && v !== false) g[k] = v; else delete g[k]; }
    delete g.order; // album order wins for synced galleries
    delete g.gallerist; // older name for represented_by
    await fs.writeFile(gy, yaml.dump(g, { lineWidth: 100 }));
    console.log(`  ${assets.length} photos in sync`);
  } catch (e) {
    failed++;
    console.error(`  ${album.slug} not synced: ${e.message}`);
  } finally {
    await page.close();
  }
}
await browser.close();
if (failed) { console.error(`\n${failed} album(s) failed. The site still builds from existing photos.`); process.exitCode = 1; }
