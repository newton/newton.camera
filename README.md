# newton.camera

A site you own completely. It's plain HTML templates, one CSS file and your photos,
built with [Eleventy](https://www.11ty.dev/docs/), a static site generator. The output
is a folder of static files that any host can serve: GitHub Pages, Netlify,
Cloudflare Pages, S3, or a $5 server.

```
content/                 ← what you edit day to day
  site.yml               all the words: intro, about, services, contact
  lightroom.yml          Lightroom album links to publish
  galleries/<slug>/      one folder per project: photos + optional gallery.yml
src/                     ← the design: yours to change
  index.njk              home page (one work on the stage + index of artists)
  work.njk               a record page per artist/project (plates + contact sheet)
  about.njk              Information: about + contact
  _includes/base.njk     the frame around every page (head, nav, footer)
  assets/site.css        all styling. Colors, type and spacing are tokens at the top
  assets/site.js         the full-screen photo viewer
  _data/galleries.js     reads photos and captions from content/galleries
scripts/sync-lightroom.mjs   pulls shared albums from Lightroom
```

## Publishing photos from Lightroom

You can use either route, and you can mix them on the same site.

### A. Paste an album link (the easy way)

1. In Lightroom (desktop, web or mobile), put the photos in an album and order them.
   Type a **Title** and **Caption** for each photo in the Info panel. On the site they
   become the plate title (e.g. *Tide line, 2023*) and the line under it
   (e.g. *Oil on linen, 48 × 36 in.*).
2. Share the album. Choose **Share & Invite**, set link access to **Anyone can view**, and copy the link.
3. Add it to `content/lightroom.yml` (you can do this in the GitHub website editor):
   ```yaml
   albums:
     - slug: joe-feddersen
       url: https://adobe.ly/xxxxxxx
       year: 2025
       description: Prints and glass for a retrospective catalog.
   ```
4. On GitHub, open **Actions → Publish site → Run workflow**. A few minutes later the gallery is live.

After that, any change you make in Lightroom (adding photos, reordering, retouching,
fixing a caption) shows up on the site after the nightly run. Press **Run workflow**
if you don't want to wait.

**What to expect:** Adobe doesn't offer a public API for shared albums. The sync opens
your share link the same way a visitor's browser does and saves the 2048px versions
Lightroom serves there. If Adobe changes its viewer, the sync stops with a message in
the Actions log. Your published galleries stay up, and route B keeps working.
The 2048px size is sharp on large screens. If you want bigger files for the
full-screen view, use route B.

### B. Export a folder (always works, full control over size)

1. In Lightroom, select the photos and choose **Export**. Use JPEG, sRGB, long edge 3000px, quality 90.
   Turn **Include metadata** on so your titles and captions are kept. Name the files in a sequence
   (e.g. *Custom name – Sequence*). The site follows filename order.
2. Put the files in `content/galleries/<slug>/`. You can drag them onto the folder on
   github.com (**Add file → Upload files**) or use GitHub Desktop.
3. Optionally add a `gallery.yml` next to them:
   ```yaml
   artist: Polina Bertou fka Tereshina
   project: Paintings for archive and giclée reproduction
   year: 2025
   description: Paintings documented for archive and giclée reproduction.
   cover: 03.jpg        # which photo leads (default: the first)
   sort: 1              # position on the home page (default: newest year first)
   # hidden: true       # keep it off the site without deleting it
   ```
   The commit triggers a rebuild.

### C. Later: the official Lightroom API

Adobe's Lightroom Services API can read albums directly, but Adobe has to approve
your app as a partner first. If they do, `scripts/sync-lightroom.mjs` is the only file
that changes. The rest of the site stays the same.

## Changing the design

Run the site on your computer and edit with live reload:

```bash
npm install
npm run dev          # http://localhost:8080 refreshes as you save
```

- **Colors, type, spacing:** change the tokens at the top of `src/assets/site.css`.
- **Font:** Host Grotesk, one size throughout, served from your own site (no Google Fonts call). Swap it with
  `npm i @fontsource/<family>`, then update the `@font-face` lines and the copy rule in `eleventy.config.js`.
- **Layout:** the `.njk` files are HTML with `{{ }}` placeholders ([Nunjucks](https://mozilla.github.io/nunjucks/templating.html)).
  To add a page, create `src/whatever.njk` and it appears at `/whatever/`.
- **Artist and project names:** taken from the album title, split at the first comma
  ("Polina Tereshina, Macedonia Institute residency, 2023"). Override with `artist:` and `project:` in
  `gallery.yml` or `lightroom.yml`. A title or © line that every photo shares is shown once, not on every plate.

Image sizes (480 to 2400px, in AVIF, WebP and JPEG) are generated at build time. The first build takes about a
minute per 25 photos. After that, only new photos get processed.

To try the design locally before any real photos are in, run `npm run samples`. It fills `content/galleries/`
with placeholder paintings. Delete those folders before you push.

## Setup (once)

1. Create a GitHub repository (it can be private if your plan supports Pages for private repos) and push this folder to it.
2. In the repository, go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Press **Run workflow**. The site appears at `https://<you>.github.io/<repo>/` until the domain is connected.
4. Domain: in **Settings → Pages → Custom domain**, enter `newton.camera`. At your registrar, replace the Adobe Portfolio
   records with GitHub's: four `A` records for `@` pointing to `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153` and `185.199.111.153`, plus a `CNAME` for `www` pointing to `<you>.github.io`.
   Then turn on **Enforce HTTPS**. Check GitHub's "Managing a custom domain" page in case these addresses have changed.
   Keep Adobe Portfolio running until the new site loads on the domain.

Netlify or Cloudflare Pages work too (`netlify.toml` is included). They build on every push.
The Lightroom sync still runs on GitHub Actions, which commits the photos, and your host picks up that commit.
