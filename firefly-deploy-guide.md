# Firefly 博客部署全教程（Cloudflare Pages + GitHub Pages + 自定义域名）

> 适用仓库：https://github.com/CuteLeaf/Firefly （master 分支）
> 本教程事实来源：仓库 `package.json`（v6.16.8）、`astro.config.mjs`、`.github/workflows/deploy.yml`、README 与官方文档 `docs-firefly.cuteleaf.cn/zh/guide/getting-started.html` 的实际读取结果。
> 关键版本：Node ≥ 22.23.0（`engines.node`）、pnpm 11.22.0（`packageManager`）、Astro 7.3.2。

---

## 0. 先决条件与本地跑通（部署前必做的验证）

### 0.1 装环境

- **Node.js ≥ 22.23.0**：`node -v` 检查。低于此版本构建脚本会失败（构建链里有多个 `tsx` 脚本）。推荐用官方安装包或 fnm/volta 管理版本。
- **pnpm**：仓库 `preinstall` 脚本是 `npx only-allow pnpm`，用 npm/yarn 装依赖会直接报错。

```bash
npm install -g pnpm@11.22.0
pnpm -v    # 应显示 11.x
```

### 0.2 Fork + 克隆（用自己的仓库，不要直接 clone 原仓库）

1. 打开 https://github.com/CuteLeaf/Firefly ，点右上 **Fork** → 得到 `<你的用户名>/Firefly`。
2. Fork 后可改仓库名（Settings → General → Rename），例如改成 `blog`。**注意：这会影响 GitHub Pages 项目页地址**（见第 4 节）。
3. 确认默认分支是 `master`（自带的部署工作流只监听 `master`）。

```bash
git clone https://github.com/<你的用户名>/Firefly.git
cd Firefly
pnpm install
pnpm dev        # 浏览器打开 http://localhost:4321
```

### 0.3 改成自己的站点

所有配置在 `src/config/` 目录，按需修改：

| 文件 | 作用 |
|---|---|
| `siteConfig.ts` | **最重要**：`site_url`（站点 URL，`astro.config.mjs` 直接读取它）、`SITE_LANG`（如 `"zh_CN"`）、标题/副标题等 |
| `profileConfig.ts` | 头像、昵称、简介 |
| `backgroundWallpaper.ts` | 壁纸/横幅模式 |
| `effectsConfig.ts` | 特效开关（樱花、看板娘等） |
| `commentConfig.ts` | 评论系统（可选，需第三方服务） |
| `navBarConfig.ts` / `sidebarConfig.ts` | 导航与侧栏 |
| `announcementConfig.ts` / `footerConfig` | 公告、页脚 |

官方配置文档：`https://docs-firefly.cuteleaf.cn/zh/guide/site.html`（其余配置项同目录下 `wallpaper.html`、`effects.html`、`comment.html` 等）。

`site_url` 先填占位域名即可，等第 3.5/4.5 节定好域名后改成最终值（影响 RSS、sitemap、绝对链接）。

### 0.4 部署前的本地构建闸门（强烈建议）

```bash
pnpm build      # 产物在 ./dist/
pnpm preview    # 本地预览构建结果
```

本地 `pnpm build` 成功 = 云端构建大概率成功。构建链会依次执行：GitHub 卡片数据 → LQIP 占位图 → 封面数据 → `astro build` → 清理看板娘资源 → 字体子集化 → 内联脚本压缩 → Pagefind 搜索索引，因此**首次构建耗时较长属正常**。

写新文章：`pnpm new-post`（对应 `scripts/new-post.js`）。

---

## 1. 部署到 Cloudflare Pages（建议作为主站）

### 1.1 创建项目

1. 登录 https://dash.cloudflare.com
2. 左侧 **Workers & Pages** → **Create** → 选 **Pages** 标签 → **Connect to Git**
3. 授权 GitHub，选择你的 `<你的用户名>/Firefly` 仓库 → Begin setup

### 1.2 构建配置（照抄）

| 配置项 | 值 |
|---|---|
| Project name | 自定义，决定 `<project>.pages.dev` |
| Production branch | `master` |
| Framework preset | `Astro` |
| Build command | `pnpm run build` |
| Build output directory | `dist` |
| Root directory | 留空（仓库根目录） |

### 1.3 环境变量（关键）

在项目设置 **Settings → Environment variables**（或创建时的 Advanced）加：

| 变量 | 值 | 原因 |
|---|---|---|
| `NODE_VERSION` | `22.23.0` | `engines.node` 要求 ≥22.23.0，CF 默认 Node 可能更低 |
| `PNPM_VERSION` | `11.22.0` | 仓库 `packageManager` 锁定 pnpm@11.22.0，且 `preinstall` 只允许 pnpm；CF 一般能按 lockfile 自动识别 pnpm，若构建日志里 pnpm 版本不对就靠这个显式指定 |

> **绝对不要设 `CF_WORKERS`**。`astro.config.mjs` 里写了：一旦该变量存在，就启用 `@astrojs/cloudflare` adapter 进入 Workers 模式。纯静态博客 + Pages 直接构建，不设它才是正确的静态产物。

### 1.4 部署

Save and Deploy → 等待构建（首次几分钟）→ 拿到 `https://<project>.pages.dev`。
此后每次 push 到 `master` 自动重新部署；对其它分支的 PR 会生成预览部署。

### 1.5 绑定自定义域名

**情况 A：域名 DNS 已托管在 Cloudflare（最省事）**

1. 先把域名加入 CF（Add a site），按提示到域名商处把 NS 改成 CF 给的两个 NS，等待生效。
2. Pages 项目 → **Custom domains** → **Set up a custom domain** → 输入子域 `blog.example.com`
   → CF 自动在 DNS 里创建 CNAME 指向 `<project>.pages.dev`（Proxied 开启）。
3. 根域也要用：同样流程加 `example.com`，CF 会用 CNAME flattening 处理。
4. 等状态变为 **Active**（证书签发通常 1–5 分钟）。
5. 建议：SSL/TLS 模式设 **Full (strict)**；开启 **Always Use HTTPS**。
6. 可选：用 Redirect Rule 把根域 301 到 `www`/子域。

**情况 B：域名不在 Cloudflare**

- 子域：去域名商 DNS 加 `CNAME  blog  →  <project>.pages.dev`（先不要加 CDN 代理）→ 回 CF 页面填该子域并等待验证通过。
- 根域（apex）：CF 的自定义域机制依赖 CNAME/扁平化，通常需要把 NS 迁到 CF，或使用支持 ALIAS/ANAME 的 DNS 商。**最省事仍是把 NS 迁到 Cloudflare。**

---

## 2. 部署到 GitHub Pages（可作镜像/备用）

### 2.1 先看懂仓库自带的工作流

`.github/workflows/deploy.yml` 已存在，内容要点：

- 触发：**push 到 `master`** 或手动 `workflow_dispatch`
- 权限：`contents: read`、`pages: write`、`id-token: write`
- build job：`actions/checkout@v4` → `actions/setup-node@v4`（node 22）→ `pnpm/action-setup@v4`（11.22.0）→ `pnpm install --no-frozen-lockfile` → `pnpm run build` → `touch dist/.nojekyll` → `actions/upload-pages-artifact@v3`（path: `dist`）
- deploy job：`actions/deploy-pages@v4`，environment `github-pages`

也就是说：**你不需要自己写工作流**。

### 2.2 一个必须处理的坑：`base` 写死为 `/`

`astro.config.mjs` 里 `base: "/"` 是写死的，`site: siteConfig.site_url` 读自配置。后果：GitHub Pages 的**项目页**（`https://<你>.github.io/<仓库名>/`）资源路径会指向域名根 → 样式和资源 404。

两条路线二选一：

- **路线①（推荐）：绑自定义域名**（第 2.4 节）。域名根路径与 `base: "/"` 正好匹配，什么都不用改。
- **路线②：不绑域名，就用项目页**。需要改 `astro.config.mjs`：`base: "/<仓库名>"`，并把 `siteConfig.ts` 的 `site_url` 改成 `https://<你的用户名>.github.io`。同时把工作流里的 `branches: [master]` 与你的默认分支保持一致（若你改过分支名）。

### 2.3 开启 Pages（用 Actions 作为发布源）

1. 你的仓库 → **Settings → Pages**
2. **Build and deployment → Source** 选 **GitHub Actions**
   （**不要**选 "Deploy from a branch"——本仓库没有把产物提交到分支的设计）
3. push 一次到 `master`，或 Actions → "Deploy to GitHub Pages" → Run workflow
4. 等工作流跑完，Pages 页面会显示站点地址（项目页形如 `https://<你>.github.io/Firefly/`）
5. 之后每次 push `master` 自动部署

补充：若 fork 后 Actions 被禁用，去 **Settings → Actions → General** 允许运行工作流。

### 2.4 绑定自定义域名

1. Settings → Pages → **Custom domain** → 填域名（强烈建议子域，如 `home.example.com`）→ Save
2. 加 DNS 记录（在域名商处，或 CF 里；**若域名在 CF 托管，建议先设为 DNS only / 灰云**，等 GitHub 签好证书再考虑是否开代理）：

| 类型 | 名称 | 值 |
|---|---|---|
| CNAME | `home`（子域） | `<你的用户名>.github.io` |
| A | `@`（根域，4 条） | `185.199.108.153` / `185.199.109.153` / `185.199.110.153` / `185.199.111.153` |

（可选 AAAA：`2606:50c0:8000::153`、`2606:50c0:8001::153`、`2606:50c0:8002::153`、`2606:50c0:8003::153`。以上 IP 以 GitHub 官方文档「Configuring a custom domain for your GitHub Pages site」为准。）

3. 回 Pages 设置勾选 **Enforce HTTPS**（证书签发需几分钟到 1 小时，未签发前该项可能灰显）。
4. 双保险做法：在仓库 `public/CNAME` 放一行域名（Astro 会原样拷进 `dist`），与 Settings 设置并存。

### 2.5 两个平台同时用

- push 一次 `master`：CF Pages（GitHub Webhook 触发）与 GH Actions 各自独立构建，互不干扰。
- 建议给两边绑**不同域名**：如 `blog.example.com` → Cloudflare Pages（主站），`home.example.com` → GitHub Pages（镜像）。
- 两边的构建链都相同（含字体子集化、Pagefind、LQIP 生成），public 仓库的 GitHub Actions 免费不限量；Cloudflare Pages 免费版带宽不限、构建次数足够个人使用。

---

## 3. 日常发布流程

```bash
pnpm new-post                # 生成新文章（scripts/new-post.js）
pnpm dev                     # 本地预览 localhost:4321
pnpm build                   # 本地构建验证
git add . && git commit -m "new post" && git push
```

push 后：Cloudflare Pages 与 GitHub Pages 同时自动重建上线。
也可以直接在 GitHub 网页上编辑 `src/content/posts/` 下的 Markdown 并提交，平台会自动重新构建。

---

## 4. 故障排查速查

| 现象 | 原因与处理 |
|---|---|
| 云端构建报 Node 版本/语法错误 | 设 `NODE_VERSION=22.23.0` |
| 构建报 `only-allow pnpm` | 平台用了 npm/yarn 安装；让其识别 pnpm（确认有 `pnpm-lock.yaml`，必要时设 `PNPM_VERSION=11.22.0`） |
| GH Pages 打开后样式全丢 | `base` 问题，见 2.2 节（绑域名，或改 `base` + `site_url`） |
| GH Pages 工作流不触发 | 默认分支不是 `master`，改工作流里的 `branches`，或手动 Run workflow |
| 自定义域名一直 Active 不了 / 证书签发失败 | 检查 DNS 记录是否正确、是否被代理（GH 验证建议灰云）、域名 CAA 记录是否限制了 Let's Encrypt / Google Trust Services |
| Cloudflare 构建被切成 Workers 模式 | 误设了 `CF_WORKERS`，删掉该环境变量 |
| 首次构建很慢 | 构建链含 LQIP/字体子集/Pagefind，属正常 |

---

## 5. 附：官方资源

- 仓库：https://github.com/CuteLeaf/Firefly
- 中文文档：https://docs-firefly.cuteleaf.cn/zh/ （快速开始 `guide/getting-started.html`，站点配置 `guide/site.html`）
- 演示站：https://firefly.cuteleaf.cn/
