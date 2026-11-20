import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(projectRoot, 'public')
const outputDir = path.join(projectRoot, 'dist')
const projectId = process.env.SANITY_PROJECT_ID || 'diimer9i'
const dataset = process.env.SANITY_DATASET || 'production'
const siteOrigin = process.env.SITE_ORIGIN || 'https://www.sonatoffshore.com'

const query = `*[_type == "blogPost" && defined(slug.current) && defined(publishedAt)] | order(publishedAt desc) {
  _id,
  title,
  "slug": slug.current,
  excerpt,
  "category": category->{title, "slug": slug.current},
  "cardThumbnail": {alt, "url": cardThumbnail.asset->url},
  "headerImage": {alt, "url": headerImage.asset->url},
  body[]{
    ...,
    _type == "image" => {"asset": asset->{url}, alt}
  },
  authorName,
  publishedAt,
  readingTimeMinutes,
  tableOfContents[]{_key, title, "anchor": anchor.current},
  seoTitle,
  seoDescription
}`

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char])
}

function safeSlug(value) {
  const segments = String(value || '').split('/').filter(Boolean)
  if (!segments.length || segments.some((segment) => !/^[a-z0-9-]+$/i.test(segment))) {
    throw new Error(`Invalid blog post slug: ${value}`)
  }
  return segments
}

function assetUrl(asset, width, height) {
  const raw = typeof asset === 'string' ? asset : asset?.url
  if (!raw) return ''
  const url = new URL(raw)
  url.searchParams.set('auto', 'format')
  url.searchParams.set('fit', 'crop')
  if (width) url.searchParams.set('w', String(width))
  if (height) url.searchParams.set('h', String(height))
  return url.toString()
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return ''
  return new Intl.DateTimeFormat('en', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).format(date)
}

function readingTime(value) {
  const minutes = Number(value)
  return Number.isInteger(minutes) && minutes > 0 ? `${minutes} min read` : ''
}

function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section'
}

function textForBlock(block) {
  return (block.children || []).map((child) => child.text || '').join('').trim()
}

function renderInline(block) {
  const marksByKey = new Map((block.markDefs || []).map((mark) => [mark._key, mark]))
  return (block.children || []).map((child) => {
    let text = escapeHtml(child.text || '')
    for (const markKey of child.marks || []) {
      const mark = marksByKey.get(markKey)
      if (mark?._type === 'link') {
        const href = String(mark.href || '')
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          text = `<a href="${escapeHtml(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`
        }
      } else if (markKey === 'strong') text = `<strong>${text}</strong>`
      else if (markKey === 'em') text = `<em>${text}</em>`
      else if (markKey === 'code') text = `<code>${text}</code>`
      else if (markKey === 'underline') text = `<u>${text}</u>`
      else if (markKey === 'strike-through') text = `<s>${text}</s>`
    }
    return text
  }).join('')
}

function portableTextHtml(blocks, contents) {
  const tocByTitle = new Map()
  for (const item of contents) {
    const key = String(item.title || '').toLowerCase()
    const items = tocByTitle.get(key) || []
    items.push(item.anchor || slugify(item.title))
    tocByTitle.set(key, items)
  }

  const sections = []
  let current = {html: ''}
  const flush = () => {
    if (current.html) sections.push(`<section class="post-section">${current.html}</section>`)
    current = {html: ''}
  }

  let activeList = ''
  const closeList = () => {
    if (activeList) current.html += `</${activeList}>`
    activeList = ''
  }

  for (const block of blocks || []) {
    if (block._type === 'image') {
      closeList()
      const src = assetUrl(block.asset, 1400)
      if (src) current.html += `<figure class="post-figure"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt || '')}" loading="lazy" /></figure>`
      continue
    }

    if (block._type !== 'block') continue
    const inline = renderInline(block)
    const text = textForBlock(block)
    const style = block.style || 'normal'

    if (style === 'h2') {
      closeList()
      flush()
      const matches = tocByTitle.get(text.toLowerCase()) || []
      const id = matches.shift() || slugify(text)
      current = {html: `<h2 id="${escapeHtml(id)}">${inline}</h2>`}
      continue
    }

    if (block.listItem === 'bullet' || block.listItem === 'number') {
      const tag = block.listItem === 'number' ? 'ol' : 'ul'
      if (activeList !== tag) {
        closeList()
        current.html += `<${tag}>`
        activeList = tag
      }
      current.html += `<li>${inline}</li>`
      continue
    }

    closeList()
    if (style === 'h3') current.html += `<h3>${inline}</h3>`
    else if (style === 'blockquote') current.html += `<blockquote>${inline}</blockquote>`
    else if (text) current.html += `<p>${inline}</p>`
  }
  closeList()
  flush()
  return sections.join('') || '<section class="post-section"><p>This article has no body content yet.</p></section>'
}

function renderSidebar(post, contents, canonicalUrl) {
  const articlePath = new URL(canonicalUrl).pathname
  const toc = contents.length
    ? `<div class="post-sidebar__contents"><h2>What’s Inside</h2><ol>${contents.map((item) => `<li><a href="${escapeHtml(articlePath)}#${escapeHtml(item.anchor || slugify(item.title))}">${escapeHtml(item.title)}</a></li>`).join('')}</ol></div>`
    : ''
  const xUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(canonicalUrl)}&text=${encodeURIComponent(post.title || '')}`
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(canonicalUrl)}`
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl)}`
  return `<aside class="post-sidebar" aria-label="Article information"><div class="post-sidebar__inner"><img class="post-sidebar__line" src="/assets/post-sidebar-line.svg" alt="" />${toc}<div class="post-sidebar__author"><h2>Author</h2><p>${escapeHtml(post.authorName || 'SONAT Offshore')}</p></div><div class="post-sidebar__share"><h2>Share</h2><div><a href="${escapeHtml(linkedinUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93zM6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37z"/></svg></a><a href="${escapeHtml(facebookUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M20.9 2H3.1A1.1 1.1 0 0 0 2 3.1v17.8A1.1 1.1 0 0 0 3.1 22h9.58v-7.75h-2.6v-3h2.6V9a3.64 3.64 0 0 1 3.88-4a20 20 0 0 1 2.33.12v2.7H17.3c-1.26 0-1.5.6-1.5 1.47v1.93h3l-.39 3H15.8V22h5.1a1.1 1.1 0 0 0 1.1-1.1V3.1A1.1 1.1 0 0 0 20.9 2"/></svg></a><a href="${escapeHtml(xUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Share on X"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 1024 1024"><path fill="currentColor" fill-rule="evenodd" d="M823.111 912H200.89C151.8 912 112 872.2 112 823.111V200.89C112 151.8 151.8 112 200.889 112H823.11c49.09 0 88.89 39.8 88.89 88.889V823.11c0 49.09-39.8 88.89-88.889 88.89M286 291l171.773 245.278L286 735h45.297l146.569-170.031L596.942 735H740L555.891 472.108L715 289h-44.67L535.793 443.41L429.058 291zm69.053 37.65l258.935 368.699h56.96L412.013 328.65z"/></svg></a></div></div></div></aside>`
}

function renderArticle(post, template) {
  const categories = post.category?.title || 'News'
  const date = formatDate(post.publishedAt)
  const readTime = readingTime(post.readingTimeMinutes)
  const slug = safeSlug(post.slug).join('/')
  const canonicalUrl = `${siteOrigin}/articles/${slug}/`
  const headerUrl = assetUrl(post.headerImage || post.cardThumbnail, 2200, 1200)
  const headerAlt = post.headerImage?.alt || post.title || ''
  const title = post.seoTitle || post.title || 'SONAT Offshore News'
  const description = post.seoDescription || post.excerpt || 'News and insights from SONAT Offshore.'
  const toc = (post.tableOfContents || []).map((item) => ({title: item.title, anchor: safeSlug(item.anchor || slugify(item.title)).join('-')}))
  const content = portableTextHtml(post.body, toc)
  const meta = `<span>${escapeHtml(categories)}</span>${date ? `<span class="news-post-meta__dot" aria-hidden="true">·</span><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(date)}</time>` : ''}${readTime ? `<span class="news-post-meta__dot" aria-hidden="true">·</span><span>${escapeHtml(readTime)}</span>` : ''}`
  const body = `<section class="news-post-body"><article class="post-article">${content}</article>${renderSidebar(post, toc, canonicalUrl)}</section>`
  let page = template

  page = page.replace('<head>', '<head>\n    <base href="/" />')
  page = page.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)} | SONAT Offshore</title>`)
  page = page.replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`)
  page = page.replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
  page = page.replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escapeHtml(title)} | SONAT Offshore" />`)
  page = page.replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`)
  page = page.replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`)
  page = page.replace(/<meta property="og:image" content="[^"]*"\s*\/>/, `<meta property="og:image" content="${escapeHtml(headerUrl || `${siteOrigin}/assets/news-post-hero.png`)}" />`)
  page = page.replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${escapeHtml(title)} | SONAT Offshore" />`)
  page = page.replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${escapeHtml(description)}" />`)
  page = page.replace(/<meta name="twitter:image" content="[^"]*"\s*\/>/, `<meta name="twitter:image" content="${escapeHtml(headerUrl || `${siteOrigin}/assets/news-post-hero.png`)}" />`)
  page = page.replace('<div class="news-post-hero__backdrop" aria-hidden="true"></div>', `<div class="news-post-hero__backdrop">${headerUrl ? `<img src="${escapeHtml(headerUrl)}" alt="${escapeHtml(headerAlt)}" />` : ''}</div>`)
  page = page.replace('<div class="news-post-meta"><span>News</span></div>', `<div class="news-post-meta">${meta}</div>`)
  page = page.replace('<h1 id="news-post-title">News and insights from Sonat Offshore will appear here.</h1>', `<h1 id="news-post-title">${escapeHtml(post.title || '')}</h1>`)
  page = page.replace(/<section class="news-post-body news-post-empty"[\s\S]*?<\/section>/, body)
  return {page, slugSegments: safeSlug(post.slug)}
}

function renderCard(post) {
  const slug = safeSlug(post.slug).map(encodeURIComponent).join('/')
  const thumbnail = assetUrl(post.cardThumbnail, 1064, 748)
  const category = post.category?.title || 'News'
  const date = formatDate(post.publishedAt)
  const readTime = readingTime(post.readingTimeMinutes)
  return `<article class="news-card">${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(post.cardThumbnail?.alt || post.title || '')}" loading="lazy" />` : ''}<div class="news-card__body"><div class="news-card__meta"><span>${escapeHtml(category)}</span>${date ? `<time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(date)}</time>` : ''}${readTime ? `<span>${escapeHtml(readTime)}</span>` : ''}</div><h2>${escapeHtml(post.title || '')}</h2><p>${escapeHtml(post.excerpt || '')}</p><a href="/articles/${slug}/">Read article</a></div></article>`
}

function renderSitemap(posts, sitemapPath) {
  const xml = readFileSync(sitemapPath, 'utf8')
  const articleUrls = posts.map((post) => {
    const slug = safeSlug(post.slug).map(encodeURIComponent).join('/')
    return `  <url>\n    <loc>${siteOrigin}/articles/${slug}/</loc>\n  </url>`
  }).join('\n')
  return xml.replace(/\s*<!-- SANITY_ARTICLES_START -->[\s\S]*?<!-- SANITY_ARTICLES_END -->/, articleUrls ? `\n${articleUrls}\n` : '')
}

async function getPublishedPosts() {
  const endpoint = new URL(`https://${projectId}.api.sanity.io/v2025-01-01/data/query/${encodeURIComponent(dataset)}`)
  endpoint.searchParams.set('query', query)
  endpoint.searchParams.set('perspective', 'published')
  const response = await fetch(endpoint)
  if (!response.ok) throw new Error(`Sanity query failed with HTTP ${response.status}`)
  const payload = await response.json()
  if (!Array.isArray(payload.result)) throw new Error('Sanity returned an unexpected blog post response.')
  return payload.result
}

function renderListing(posts, listingPath) {
  let listing = readFileSync(listingPath, 'utf8')
  const cards = posts.map(renderCard).join('\n')
  const emptyState = '<p class="news-empty-state">News and insights from Sonat Offshore will appear here.</p>'
  const content = cards || emptyState
  listing = listing.replace(/\s*<!-- SANITY_NEWS_START -->[\s\S]*?<!-- SANITY_NEWS_END -->\s*/, `\n            ${content}\n          `)
  return listing
}

async function main() {
  const posts = await getPublishedPosts()
  rmSync(outputDir, {recursive: true, force: true})
  cpSync(sourceDir, outputDir, {recursive: true})
  const listingPath = path.join(outputDir, 'news.html')
  writeFileSync(listingPath, renderListing(posts, listingPath))
  const sitemapPath = path.join(outputDir, 'sitemap.xml')
  writeFileSync(sitemapPath, renderSitemap(posts, sitemapPath))
  const template = readFileSync(path.join(sourceDir, 'news-post.html'), 'utf8')
  const articlesDir = path.join(outputDir, 'articles')
  if (posts.length) mkdirSync(articlesDir, {recursive: true})
  for (const post of posts) {
    const {page, slugSegments} = renderArticle(post, template)
    const pageDir = path.join(articlesDir, ...slugSegments)
    mkdirSync(pageDir, {recursive: true})
    writeFileSync(path.join(pageDir, 'index.html'), page)
  }
  console.log(`Built static site with ${posts.length} published blog post${posts.length === 1 ? '' : 's'} from Sanity (${projectId}/${dataset}).`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
