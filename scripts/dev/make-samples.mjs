// Generates placeholder "artwork" photos so the site builds before real photos exist.
// Each JPEG carries XMP title + caption exactly where Lightroom writes them on export.
// Delete content/galleries/* once you've published real galleries.
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../content/galleries");

const projects = [
  { slug: "joe-feddersen", title: "Joe Feddersen", year: 2025, n: 7,
    palette: ["#2f4a5c", "#c9a227", "#8c3b2a", "#d8d2c4", "#1d1d1b", "#6e8b74"],
    blurb: "Prints and glass for a retrospective catalog. Shot under cross-polarized light to keep the ink surfaces flat and the glass free of glare.",
    medium: ["Monoprint on paper", "Fused glass", "Lithograph", "Screenprint with chine-collé"] },
  { slug: "polina-bertou", title: "Polina Bertou fka Tereshina", year: 2025, n: 6,
    palette: ["#e3d5c8", "#b34e3f", "#3b3a6b", "#f0b84d", "#2c2c2c", "#9fb7c7"],
    blurb: "Paintings documented for archive and giclée reproduction, color-managed to the originals in the studio.",
    medium: ["Oil on linen", "Gouache on paper", "Oil on panel"] },
  { slug: "rob-katkowski", title: "Rob Katkowski", year: 2024, n: 6,
    palette: ["#101418", "#e7e4dc", "#c43d2f", "#5a6a3b", "#a8a59c", "#d9b44a"],
    blurb: "Large-format works on paper, captured in stitched tiles and assembled at full resolution.",
    medium: ["Charcoal and acrylic on paper", "Ink on paper", "Mixed media"] },
  { slug: "jerry-harrison-spencer-drate", title: "Jerry Harrison & Spencer Drate", year: 2024, n: 5,
    palette: ["#f2e9d8", "#d6432f", "#1b4d8f", "#f2c230", "#151515", "#7a7a7a"],
    blurb: "Record sleeves, posters and ephemera photographed for a book on music graphics.",
    medium: ["Offset lithograph", "Record sleeve", "Silkscreen poster"] },
];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

function artworkSvg(p, i, w, h) {
  const r = rng(p.slug.length * 997 + i * 31);
  const pick = () => p.palette[Math.floor(r() * p.palette.length)];
  const ground = p.palette[(i + 3) % p.palette.length];
  let shapes = "";
  const count = 6 + Math.floor(r() * 10);
  for (let k = 0; k < count; k++) {
    const x = r() * w, y = r() * h, s = (0.08 + r() * 0.45) * Math.min(w, h);
    const fill = pick(), op = (0.55 + r() * 0.45).toFixed(2);
    const kind = r();
    if (kind < 0.4) shapes += `<rect x="${x - s / 2}" y="${y - s / 3}" width="${s}" height="${s * (0.3 + r())}" fill="${fill}" opacity="${op}" transform="rotate(${(r() - 0.5) * 24} ${x} ${y})"/>`;
    else if (kind < 0.75) shapes += `<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${fill}" opacity="${op}"/>`;
    else shapes += `<path d="M${x} ${y} q ${s} ${-s * r()} ${s * 1.6} ${s * 0.4}" stroke="${fill}" stroke-width="${4 + r() * 22}" fill="none" opacity="${op}" stroke-linecap="round"/>`;
  }
  // artwork sits on a neutral copy-stand background with a little margin, like a real repro shot
  const m = Math.round(Math.min(w, h) * 0.06);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + m * 2}" height="${h + m * 2}">
    <defs><filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${i}"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.08 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>
    <rect width="100%" height="100%" fill="#d4d4d2"/>
    <g transform="translate(${m} ${m})"><rect width="${w}" height="${h}" fill="${ground}"/>${shapes}<rect width="${w}" height="${h}" filter="url(#g)"/></g>
  </svg>`;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const xmp = (title, desc) => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(desc)}</rdf:li></rdf:Alt></dc:description>
<dc:creator><rdf:Seq><rdf:li>Michael Newton</rdf:li></rdf:Seq></dc:creator>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

const titles = ["Untitled", "Study", "Tide line", "Field", "Night signal", "Second harvest", "Weir", "Ledger", "Ochre room", "Night bus"];

for (const p of projects) {
  const dir = path.join(root, p.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "gallery.yml"),
`title: ${p.title}
year: ${p.year}
description: >-
  ${p.blurb}
# Optional: which photo is the cover (filename). Defaults to the first one.
# cover: 01.jpg
`);
  for (let i = 0; i < p.n; i++) {
    const r = rng(i * 7 + p.year);
    const portrait = i % 3 !== 0;
    const w = portrait ? 1500 : 2000, h = portrait ? 2000 : 1400;
    const t = `${titles[(i + p.n) % titles.length]}${i % 3 === 0 ? `, ${p.year - 1 - (i % 4)}` : ""}`;
    const inW = Math.round(20 + r() * 40), inH = Math.round(inW * (h / w));
    const d = `${p.medium[i % p.medium.length]}, ${inH} × ${inW} in.`;
    const file = path.join(dir, `${String(i + 1).padStart(2, "0")}.jpg`);
    await sharp(Buffer.from(artworkSvg(p, i, w, h))).jpeg({ quality: 88 }).withXmp(xmp(t, d)).toFile(file);
  }
  console.log("wrote", p.slug);
}
