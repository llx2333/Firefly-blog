# Firefly 改外观手册（UI 定制入口地图）

> 面向"我想换个样子 / 调调外观"的场景。所有路径都是仓库内的真实路径，
> 每个配置字段旁边都有中文注释，边看边改就行。改完 `pnpm dev` 在 http://localhost:4321 实时看效果。

---

## 0. 先回答：有没有"一键切换的预设/皮肤"？

**没有整套 UI 的预设切换。** Firefly 是"配置驱动 + 组件/CSS 驱动"的：外观 = 改
`src/config/*.ts` 里的字段，或者改 `src/styles/*` 与 `src/components/*`。

- 名字里带"预设"的只有一处：`src/config/navBarConfig.ts` 底部的 **`LinkPresets`** —— 那是**导航栏链接的预设**
  （名称/图标/URL 的现成组合，比如 `LinkPresets.Archive`），不是皮肤预设。
- 但有一套**运行时可切换**的选项（访客能自己点着切）：视图设置面板，见 §3。

---

## 1. 改外观的主战场：`src/config/`（26 个文件，全中文注释）

**完整清单和说明就在仓库里**：`src/config/README.md`。下面是按"想改什么"组织的索引。

### 最常改的几个

| 文件 | 管什么 | 常用字段 |
|---|---|---|
| `siteConfig.ts` | 站点核心与主题 | `title` / `subtitle` / `description` / `keywords` / `site_url`；**`themeColor.hue`（0–360，整站主色）**、`themeColor.defaultMode`（light/dark/system）；`pageWidth`（页面总宽，rem）；`card.border`、`card.followTheme`；`navbar.*`（logo/标题/对齐/`navbarMode`）；`favicon`；`categoryStyle`、`tagStyle`；`postListLayout`（列表/网格、封面左右、元数据显示）；`pages`（页面开关） |
| `backgroundWallpaper.ts` | 壁纸与横幅 | 壁纸模式、图片列表、横幅文字、水波纹、全屏模式与模糊 |
| `effectsConfig.ts` | 动画特效 | 樱花（数量/速度/尺寸）等 |
| `sidebarConfig.ts` | 侧边栏布局 | 左/右/移动端各放哪些组件、顺序 |
| `navBarConfig.ts` | 导航栏菜单 | 菜单项（用 `LinkPresets` 或自定义名称/图标/URL）、搜索配置 |
| `fontConfig.ts` | 字体 | 字体列表、回退、预加载 |
| `profileConfig.ts` | 个人资料 | 头像、昵称、社交链接 |
| `commentConfig.ts` | 评论 | Twikoo / Waline / Artalk / Giscus / Disqus |
| `musicConfig.ts` | 音乐播放器 | Meting API 或本地音乐、导航栏/侧边栏开关 |
| `pioConfig.ts` | 看板娘 | Spine / Live2D 模型 |
| `displaySettingsConfig.ts` | 视图设置面板 | 见 §3 |

### 其余（按需查）

`analyticsConfig.ts`（统计）、`announcementConfig.ts`（公告）、`coverImageConfig.ts`（封面图）、
`dynamicConfig.ts`（动态页）、`expressiveCodeConfig.ts`（代码块主题/折叠/语言徽章）、
`friendsConfig.ts`（友链）、`galleryConfig.ts`（相册）、`licenseConfig.ts`（版权协议）、
`mermaidConfig.ts` / `plantumlConfig.ts`（图表）、`sponsorConfig.ts`（打赏）。

### 三个"立刻改观"的字段

1. **`themeColor.hue: 165`** —— 你现在的青绿色调就是它。换成别的数字，整站配色跟着变
   （文件注释给的参照：0 红、200 青、250 蓝绿、345 粉）。想要"低饱和"观感，主要靠这个色相 + 下面的卡片配置。
2. **`card.border` / `card.followTheme`** —— 卡片要不要边框阴影、要不要跟随主题色，直接影响"通透感"。
3. **`navbar.navbarMode`** —— `dynamic`（下滑隐藏、上滑显示）/ `fixed`（常驻）/ `static`（随滚动消失），配合 `menuAlign` 和 `widthFull`。

---

## 2. 改布局 / 结构（组件级）

目录地图：

- `src/layouts/` —— `Layout.astro`（HTML 外壳、主题初始化）、`MainGridLayout.astro`（整页网格：侧栏 + 导航 + 壁纸 + 页脚）
- `src/components/` —— 按域分：`layout/`、`widget/`（侧栏小组件）、`controls/`、`features/`、`common/`、`misc/`、`pages/`、`comment/`、`analytics/`
- `src/styles/` —— 一个组件一份 CSS（`navbar.css`、`toc.css`、`banner-*.css`…），
  `variables.styl`（Stylus 变量：颜色/圆角等）、`main.css`、`transition.css`、`waves.css`

建议：

- **小改**（颜色、圆角、间距、阴影）→ 优先改 `src/styles/variables.styl` 和对应组件的 CSS，改动面最小。
- **大改**（换布局、挪组件、改结构）→ 改 `src/components/**` 里的 `.astro` / `.svelte`。
  `.astro` 是静态结构，`.svelte` 是交互组件（搜索、设置面板、分页等，用 `client:load` / `client:visible` 挂载）。
- ⚠️ 这些文件都是上游的文件，改得越多，将来同步上游（见 `firefly-cf-guide.md` §9）时冲突越多。
  尽量把个人化改动集中在少数文件和 `src/config/`、`src/content/`、`public/` 里。

---

## 3. 视图设置面板（访客能自己点的那种）

开关在 `src/config/displaySettingsConfig.ts`：

- **默认是关的**（`enable: false`）。原因文件里写得很清楚：打开后设置面板及其依赖会打进客户端产物，
  体积变大、首屏多一份 JS，其中"壁纸模式切换"大约 **+33 KB/页**。所以建议生产环境保持关闭。
- **不改代码也能开**：在部署平台的**构建变量**里设 `PUBLIC_DISPLAY_SETTINGS=true`（环境变量优先级高于文件）。
  在 Cloudflare 里怎么设见 `firefly-cf-guide.md` §4。

打开后访客可切换：主题色相、亮/暗、文章列表布局（列表/网格）、卡片边框、卡片跟随主题色、壁纸模式、
全屏布局（classic/hero）、水波纹、渐变过渡、横幅标题、壁纸轮播、遮罩透明度/模糊、樱花特效。
每一项都能单独关掉（`xxxSwitchable` 系列字段）。

---

## 4. 内容也是很重要的"外观"

| 内容类型 | 位置 | 新建方式 |
|---|---|---|
| 文章 | `src/content/posts/` | `pnpm new-post <文件名>` |
| 动态（微语） | `src/content/dynamic/` | `pnpm new-dynamic` |
| 项目展示 | `src/content/projects/` | 手动加 md |
| 特殊页（关于、留言板） | `src/content/spec/` | 手动改 |

- frontmatter 字段（title/published/tags/category/draft/pinned/password/comment…）以 `src/content.config.ts` 为准。
- 图片：`public/` 下的原样复制、不做优化；`src/assets/` 下的会走 Astro 图片优化（会增加构建时间）。
- 图片格式与质量、防盗链域名在 `siteConfig.imageOptimization`。

---

## 5. 改完怎么验证、怎么上线

```bash
cd /e/AI/project/Firefly-blog
pnpm dev        # 实时预览 http://localhost:4321
pnpm check      # Astro 诊断（可选）
pnpm build      # 正式构建，最接近线上效果（可选但推荐）
git add -A && git commit -m "feat: ..." && git push   # 推送后 Cloudflare 自动重新部署
```

- 提交信息按仓库约定用 Conventional Commits（`feat:` / `fix:` / `chore:`）。
- 代码风格约定（Tab 缩进、双引号、组件 PascalCase、`xxxConfig.ts` 驼峰命名等）写在仓库的
  `AGENTS.md` 和 `CLAUDE.md` 里，也会被 `pnpm lint` / `pnpm format`（Biome）自动修正。

---

## 6. 文档入口

- 官方配置文档：https://docs-firefly.cuteleaf.cn/
- 仓库内自带：`src/config/README.md`（配置文件总览）、`README.md`（安装/部署/配置说明）、
  `AGENTS.md` 与 `CLAUDE.md`（项目结构与开发约定）
