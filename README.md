# SONAT Offshore website

## Local preview

Serve the static files in `public/` with a local web server to preview the design.

## News content build

News posts and categories are authored in the Sanity project `diimer9i`, dataset
`production`. The dataset is public, so the website build needs no Sanity token.

Run `npm run build` to fetch published posts, copy the site to `dist/`, render
the News listing and one static article page per post under `dist/articles/`,
and add those article URLs to the sitemap. Drafts are not included. With no
published posts, the News page keeps its empty-state message.

Cloudflare Pages settings for the Git-connected site:

- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

For automatic updates after publishing Sanity content, create a Cloudflare Pages
deploy hook and add it in Sanity Manage under API → Webhooks. Set the webhook
dataset to `production`, the filter to `_type in ["blogPost", "blogCategory"]`,
and include published document create, update, and delete events. The build
only reads published documents, so draft edits do not appear on the website.
