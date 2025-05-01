# astro-remark-link-card
适配astro的链接卡片样式，修改自：[](https://github.com/HidemaruOwO/remark-link-card/tree/main)

## 背景
1.原作者已经很久不维护了
2.我在我的astro项目中使用原作者的插件时，由于项目设置了base，所以图片路径一直加载失败。
3.如果开启缓存，会在本地下载爬取到的链接图片，但是原作者下载的图片文件没有后缀名。虽然理论上可以加载，但是我还是遇到了bug。

## 主要修改点
1.index.js中 downloadImage 函数中，通过 response.headers.get('content-type') 获取 MIME 类型，并将其映射为常见扩展名（如 .png, .jpg）
2.动态读取 Astro 的 base 配置，只需要在你的astro项目中astro.config.mjs中显式传递base即可。
```
import remarkLinkCard from 'remark-link-card'

export default defineConfig({
  base: "/Astro-blogs", // ✅ 你的 base 配置
  markdown: {
    remarkPlugins: [
      [remarkLinkCard, {
        shortenUrl: true,
        // 显式传递 base 配置
        base: "/Astro-blogs"
      }],
    ],
  },
})
```


