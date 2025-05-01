const visit = require('unist-util-visit');
const ogs = require('open-graph-scraper');
const path = require('path');
const { writeFile, access, mkdir } = require('fs').promises;
const fetch = require('node-fetch');
const sanitize = require('sanitize-filename');
const he = require('he');

// MIME 类型到扩展名的映射表
const mimeToExt = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg'
};

// 默认配置
const defaultSaveDirectory = 'public';
const defaultOutputDirectory = '/remark-link-card/';

// 扩展名处理函数
function getFileExtension(url, contentType) {
  // 优先从 Content-Type 获取扩展名
  if (contentType && mimeToExt[contentType]) {
    return mimeToExt[contentType];
  }
  
  // 从 URL 路径提取扩展名
  const urlExtMatch = url.pathname.match(/\.([a-z0-9]{2,4})$/i);
  if (urlExtMatch && urlExtMatch[1]) {
    return `.${urlExtMatch[1].toLowerCase()}`;
  }
  
  // 未知类型使用默认扩展名
  return '.bin';
}

const rlc = (options) => {
  return async (tree) => {
    const transformers = [];
    const basePrefix = options.base || ''; // ✅ 从配置动态获取 base
    
    visit(tree, 'paragraph', (paragraphNode, index) => {
      if (paragraphNode.children.length !== 1) return;
      if (paragraphNode.data) return;

      visit(paragraphNode, 'text', (textNode) => {
        const urls = textNode.value.match(
          /(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/g
        );
        
        if (urls && urls.length === 1) {
          transformers.push(async () => {
            const data = await fetchData(urls[0], options, basePrefix);
            const linkCardHtml = createLinkCard(data, basePrefix);
            const linkCardNode = { type: 'html', value: linkCardHtml };
            tree.children.splice(index, 1, linkCardNode);
          });
        }
      });
    });

    try {
      await Promise.all(transformers.map(t => t()));
    } catch (error) {
      console.error(`[remark-link-card] Error: ${error}`);
    }

    return tree;
  };
};

const getOpenGraph = async (targetUrl) => {
  try {
    const { result } = await ogs({ url: targetUrl, timeout: 10000 });
    return result;
  } catch (error) {
    console.error(
      `[remark-link-card] Error: Failed to get Open Graph data for ${targetUrl} - ${error.message}`
    );
    return undefined;
  }
};

const fetchData = async (targetUrl, options, basePrefix) => {
  const ogResult = await getOpenGraph(targetUrl);
  const parsedUrl = new URL(targetUrl);
  
  const title = ogResult?.ogTitle ? he.encode(ogResult.ogTitle) : parsedUrl.hostname;
  const description = ogResult?.ogDescription ? he.encode(ogResult.ogDescription) : '';
  
  // Favicon 处理
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}`;
  let faviconSrc = '';
  
  if (options?.cache) {
    const filename = await downloadImage(
      faviconUrl,
      path.join(process.cwd(), defaultSaveDirectory, defaultOutputDirectory)
    );
    faviconSrc = filename ? `${basePrefix}${defaultOutputDirectory}${filename}` : '';
  } else {
    faviconSrc = faviconUrl;
  }

  // OGP Image 处理
  let ogImageSrc = '';
  if (ogResult?.ogImage?.url) {
    const filename = await downloadImage(
      ogResult.ogImage.url,
      path.join(process.cwd(), defaultSaveDirectory, defaultOutputDirectory)
    );
    ogImageSrc = filename ? `${basePrefix}${defaultOutputDirectory}${filename}` : '';
  }

  const ogImageAlt = ogResult?.ogImage?.alt ? he.encode(ogResult.ogImage.alt) : title;
  
  // URL 显示处理
  let displayUrl;
  try {
    displayUrl = options?.shortenUrl 
      ? parsedUrl.hostname 
      : decodeURI(targetUrl);
  } catch {
    displayUrl = targetUrl;
  }

  return {
    title,
    description,
    faviconSrc,
    ogImageSrc,
    ogImageAlt,
    displayUrl,
    url: targetUrl
  };
};

const createLinkCard = (data, basePrefix) => {
  // 创建 favicon 元素
  const faviconElement = data.faviconSrc
    ? `<img class="rlc-favicon" src="${data.faviconSrc}" alt="${data.title} favicon" width="16" height="16">`
    : '';

  // 创建描述元素
  const descriptionElement = data.description
    ? `<div class="rlc-description">${data.description}</div>`
    : '';

  // 创建图片元素
  const imageElement = data.ogImageSrc
    ? `<div class="rlc-image-container">
        <img class="rlc-image" src="${data.ogImageSrc}" alt="${data.ogImageAlt}" />
      </div>`
    : '';

  // 返回完整的 HTML 片段
  return `
<a class="rlc-container" href="${data.url}">
  <div class="rlc-info">
    <div class="rlc-title">${data.title}</div>
    ${descriptionElement}
    <div class="rlc-url-container">
      ${faviconElement}
      <span class="rlc-url">${data.displayUrl}</span>
    </div>
  </div>
  ${imageElement}
</a>
`.trim();
};

const downloadImage = async (url, saveDirectory) => {
  try {
    // 解析 URL 并生成基础文件名
    const targetUrl = new URL(url);
    
    // 获取扩展名
    let fileExt = '';
    try {
      const response = await fetch(targetUrl.href, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      
      const contentType = response.headers.get('content-type');
      fileExt = getFileExtension(targetUrl, contentType);
    } catch (error) {
      console.warn(`[remark-link-card] Couldn't determine extension for ${url}: ${error.message}`);
      fileExt = getFileExtension(targetUrl, null);
    }

    // 生成文件名
    const baseFilename = sanitize(decodeURI(targetUrl.href));
    const filename = `${baseFilename}${fileExt}`;
    const saveFilePath = path.join(saveDirectory, filename);

    // 检查文件是否存在（存在则直接返回）
    try {
      await access(saveFilePath);
      return filename;
    } catch {}

    // 创建目录
    try {
      await access(saveDirectory);
    } catch {
      await mkdir(saveDirectory, { recursive: true });
    }

    // 下载并保存文件
    const response = await fetch(targetUrl.href, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    
    const buffer = await response.buffer();
    await writeFile(saveFilePath, buffer);
    return filename;

  } catch (error) {
    console.error(`[remark-link-card] 下载图片失败: ${url} - ${error.message}`);
    return undefined;
  }
};

module.exports = rlc;