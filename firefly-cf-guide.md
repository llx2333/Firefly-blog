# Firefly 部署与运维手册 · Cloudflare Workers 版

> 配套文档：`firefly-deploy-guide.md`（那是给 **Cloudflare Pages** 和 GitHub Pages 写的教程）。
> 你实际建的是 **Worker**，所以以本文件为准，Pages 那份只当参考。
>
> 本文所有结论的来源：你仓库里的实际文件与 Git 历史、在你仓库里实跑的 `wrangler` 命令、
> Cloudflare 官方文档（链接见 §10）。凡是没有直接证据的地方我都标了【推断】。

---

## 0. 一句话结论

你现在这套配置**方向是对的，不用推翻重来**：`pnpm run build` + `npx wrangler deploy` + 仓库里的
`wrangler.jsonc`（把 `./dist` 当静态资源上传）就是 Firefly 在 Cloudflare Workers 上的正确做法。

真正需要修的问题只有一条：**仓库里 worker 名字写的是 `firefly`，而面板上的项目名叫 `firefly-blog`**，
不一致。你截图里那张橙色警告就是它。我已经在 `wrangler.jsonc` 里改好了（见 §3.1）。

---

## 1. 先认清：你建的是 Worker，不是 Pages 项目

判断依据（你第一张截图里的字段）：

- 有 **部署命令**、**构建监视路径**、**API 令牌** → 这些是 **Workers Builds**（Worker 的 Git 自动构建）独有的字段。
- 没有 **构建输出目录** → 这是 Pages 独有的字段。Pages 不需要"部署命令"（它默认把输出目录整个上传），所以也没有部署命令这一栏。

**所以你找不到"构建输出目录"不是看漏了，是这条产品线没有这个字段。** 产物位置改由 `wrangler.jsonc`
里的 `assets.directory` 指定。

两者的区别，一句话版：

- **Pages**：专门托管静态站 / 前端框架的产品，配置字段少，Firefly 的 README 演示的就是它。
- **Worker**：通用计算单元，可以跑 JS 代码。当它**不跑代码、只当静态文件容器**时，效果和 Pages 一样，而且是 Cloudflare 现在推荐的新项目方式。
- 你的 Worker 属于后者：`wrangler.jsonc` 里**没有 `main` 字段** → 没有 Worker 脚本 → 请求全部直接命中静态资源。

两个直接好处（Cloudflare 官方原文）：静态资源请求是 **"free and unlimited"（免费且不限量）**，
存储静态资源也不额外收费。所以**你这条路上基本不可能产生费用**；那个"免费版 10 万请求/天"的限制
只针对**跑 Worker 脚本**的请求，你一个都没有。

本地实证（我在你仓库里跑的）：

```
$ npx wrangler deploy --dry-run
✨ Read 387 files from the assets directory E:\AI\project\Firefly-blog\dist
Total Upload: 22.32 KiB / gzip: 5.43 KiB
No bindings found.
--dry-run: exiting now.
```

→ 配置合法、可部署。文件规模（380 多个文件、约 24 MB）离上限（免费版 **20,000 个文件 / 单文件 25 MiB**）差得很远，不用担心。

---

## 2. 面板字段逐项解释（对应第一张截图）

| 字段 | 它在干什么 | 你该怎么设 |
|---|---|---|
| 构建命令 `pnpm run build` | 装完依赖后执行的命令。它跑的是 `package.json` 里那串完整构建链（生成 LQIP/封面/GitHub 卡片 → astro build → 裁剪看板娘资源 → 字体子集 → 压缩内联脚本 → Pagefind 搜索索引） | ✅ 保持不动 |
| 部署命令 `npx wrangler deploy` | 构建完成后把产物推上线。它读仓库根目录的 `wrangler.jsonc`，把 `./dist` 上传成这个 Worker 的静态资源 | ✅ **正确，别改**。你之前担心的那个默认值没问题（用的是你 `package.json` 里 `wrangler ^4.147.0` 的版本） |
| 根目录 `/` | 构建时的工作目录 | ✅ 保持（仓库根就是站点根） |
| 构建监视路径（包括 `*` / 排除 `node_modules/**,.git/`） | 决定"哪些文件变了才重新构建" | ✅ 先保持默认（任何改动都构建）。以后嫌构建太频繁再收窄，例如包括路径写 `src/**`、`public/**`、`package.json`、`pnpm-lock.yaml`、`astro.config.mjs`、`wrangler.jsonc`。**别把 `wrangler.jsonc` 排除掉**，否则改了它不会重建 |
| API 令牌 | 构建容器用它在你账号里完成部署；Cloudflare 一般会自动生成一个专用令牌 | 见 §5 |
| 构建变量和密钥 | 构建时就绪的环境变量 | 见 §4 |

---

## 3. 那张橙色警告（第二张截图）到底在说什么

原文："请更新您的存储库中的 wrangler.jsonc，以保持一致的设置。在 Wrangler v3.109.0+ 上，我们会自动生成 PR 来在构建后修复此问题"

**含义**：面板认为这个 Worker 叫 `firefly-blog`，而仓库 `wrangler.jsonc` 里写的是 `firefly` —— 两边不一致。
真正执行部署的是 wrangler 命令行，它读的是**文件**，所以名字不一致时可能出现"构建成功、但界面上的部署没更新"
或者"另外多出一个叫 firefly 的 Worker"这类怪事【推断：Cloudflare 文档没有明写不一致时的后果】。

**它提议的做法**：Cloudflare 可以自动开一个 PR，把仓库文件改成和面板一致。

⚠️ **不要盲点合并那个 PR**：它给出的片段只有 `{"name": "firefly-blog"}`。如果 PR 整个覆盖文件，
`assets` 段就没了，`npx wrangler deploy` 会因为"既没有 Worker 入口脚本、也没有资源目录"而失败【推断】。
真出现了那个 PR，先看 diff 再决定。

**我做的处理**：直接改仓库文件让两边一致，从源头消掉这个提示。

### 3.1 我改了 `wrangler.jsonc` 两处

```diff
 {
-	"name": "firefly",
+	"name": "firefly-blog",
 	"compatibility_date": "2025-01-01",
 	"compatibility_flags": ["nodejs_compat"],
 	"assets": {
-		"directory": "./dist"
+		"directory": "./dist",
+		"not_found_handling": "404-page"
 	}
 }
```

1. `name` → `firefly-blog`：和面板上的项目名对齐。**如果你面板上显示的 Worker 名字不是 `firefly-blog`，改成那个实际名字。**
2. 新增 `not_found_handling: "404-page"`：这个字段**默认值是 `"none"`**（官方文档写明），意思是访问不存在的路径时
   返回 Cloudflare 的通用 404 页面。设成 `"404-page"` 会返回站点自己的 `dist/404.html`，也就是 Firefly 那个统一的 404 页。
   想恢复默认，删掉这一行即可。

`compatibility_date` 和 `nodejs_compat` 是上游自带的，纯静态站用不到，留着无害，别动。

---

## 4. 环境变量怎么设（构建变量 vs 运行时变量）

Cloudflare 把变量分两类，这个区分对静态站特别关键：

- **构建变量**（在"构建"设置里）：只在构建容器里有效，比如决定用什么 Node/pnpm 版本。**你的站点只会用到这一类。**
- **运行时变量**（在"变量和密钥"里）：给 Worker **脚本**运行时读取。**你的 Worker 没有脚本 → 这一栏对你完全没用**，可以忽略。

建议设置（都在"生产"环境的构建变量里加）：

| 变量 | 值 | 为什么 |
|---|---|---|
| `PNPM_VERSION` | `11.22.0` | 构建镜像自带的 pnpm 是 10.11.1，而你 `package.json` 要求 `pnpm@11.22.0`。虽然仓库 `.npmrc` 里的 `manage-package-manager-versions = true` 一般能自动切到 11.22.0，但显式固定最稳 |
| `NODE_VERSION` | 可不设 | 镜像默认 Node **24.18.0**，另外预装 **22.23.2**，都满足 `engines: node >=22.23.0`。你本机 v24.13.1 能构建成功也印证了 Node 24 没问题。真出问题再设 `NODE_VERSION=22.23.2` |

可选：

| 变量 | 作用 |
|---|---|
| `SITE_URL` | 你的 `astro.config.mjs` 已经改成 `site: process.env.SITE_URL || siteConfig.site_url`，所以换域名时可以只设变量、不改代码 |
| `PUBLIC_DISPLAY_SETTINGS=true` | 打开"视图设置面板"（访客可自己切主题色/壁纸/布局）。代价是每页体积约 +33 KB，详见 `src/config/displaySettingsConfig.ts` 的注释 |

⛔ **绝对不要设 `CF_WORKERS`**。那个变量会让 Astro 走 Cloudflare 适配器、把站点构建成"带脚本的 Worker"（输出 `_worker.js`），
那就必须在 `wrangler.jsonc` 里加 `main` 才能部署，完全是另一条路。你的站点是全静态的，不需要它。

---

## 5. 部署失败、"API 令牌不可用"怎么查

**第一步永远是看日志**：Workers & Pages → 选你的 Worker → 部署（Deployments）/ 构建记录 → 点开最近一次 →
看是 install / build / deploy 哪一步红的。只看面板上的"成功/失败"没有信息量，**日志是唯一可靠依据**。

你截图里"API 令牌：已配置的 API 令牌不可用"是在说：构建时用来部署的那个令牌，当前选中的不可用。
两种可能、两种动作：

1. 下拉里选到了一个没有 Workers 权限、或已失效的自定义令牌 → **把下拉切回 Cloudflare 自动生成的那个**。
2. Cloudflare 为这次 Git 集成自动创建的令牌被删掉了 → **断开再重连 Git 集成**（Settings → Builds → Git repository，
   断开后重新连接）会重新生成一个。
   判断到底是哪种：看构建日志里 deploy 那一步的报错。如果日志说部署认证失败，就是令牌问题。

常见报错对照：

| 现象 | 原因 | 动作 |
|---|---|---|
| `Unsupported engine` / `ERR_PNPM_UNSUPPORTED_ENGINE` | 构建容器的 Node 版本低于 `engines` 要求 | 设 `NODE_VERSION=22.23.2`（或 `24`） |
| pnpm 版本相关报错 | 镜像自带 pnpm 与 `packageManager` 不一致 | 设 `PNPM_VERSION=11.22.0` |
| deploy 步骤报 "Missing entry-point to Worker script or to assets directory" | `wrangler.jsonc` 里的 `assets` 段丢了（比如被自动 PR 覆盖） | 把 `assets` 配置恢复回来 |
| 构建超时 | Firefly 构建链较重（OG 图 / 字体子集 / Pagefind），免费版构建有时间限制 | 重试；仍失败先关掉 `siteConfig.post.generateOgImages` 再试 |
| 改完看不到新内容 | 浏览器缓存 | `Ctrl + F5`；一般不需要去 Cloudflare 清缓存 |
| 页面里的链接指向错误域名 | `siteConfig.site_url` 或构建变量 `SITE_URL` 没设对 | 改 `src/config/siteConfig.ts` 或设 `SITE_URL` |

---

## 6. 生产 / 预览 / 域名 —— 你问的"启用对象"是什么

Cloudflare 把每个项目的构建分成两类环境，那一栏就是让你选"你正在配置哪一套"：

- **生产（Production）**：只有**生产分支**（你的仓库是 `master`）的推送会更新它。它的地址 = `workers.dev` 子域 + 你绑的自定义域。
  **这就是你唯一需要关心的环境。**
- **预览（Preview）**：任何**非生产分支**的推送会生成一次"预览"——一个临时地址（预览 URL），
  在 Worker 的"预览"区域能看到，如果开了 PR 还会自动评论在 PR 里。预览有自己独立的变量/密钥，**不影响线上**。
  你只往 master 推 → 预览环境基本用不到，可以完全不管它。

"**预览域名**"指的就是上面那些临时地址，**不是**你要绑的业务域名。别把两者搞混。

域名有三种，各是什么：

| 类型 | 是什么 | 你要不要 |
|---|---|---|
| `<worker>.<你的账号子域>.workers.dev` | Cloudflare 免费送的永久地址，随时可用，也可以关掉 | 先用它验证部署成功 |
| **自定义域（Custom Domain）** | 你自己的域名，如 `blog.adoai.me`。CF 会自动建 DNS 记录并签发证书 | ✅ 这是你要的 |
| 路由（Route） | 用于"源站在别处、只想让某些路径走 Worker"的场景 | ❌ 不需要 |

**加自定义域的步骤**：Workers & Pages → 选中你的 Worker → **Settings → Domains & Routes → Add → Custom Domain**
→ 填 `blog.adoai.me` → 添加。Cloudflare 会自动帮你建 DNS 记录并签发证书。

两个前置条件（官方文档要求）：

1. 这个域名（zone）必须在你**同一个 Cloudflare 账号**里且状态正常（"active zone"）。不能给不属于你的域名加自定义域。
2. 该主机名下**不能已经存在冲突的 DNS 记录**（官方明确说不允许在已有 CNAME 记录的主机名上创建）。

**你现在域名的情况（我实测查的）**：

- `adoai.me` 的 NS 已经是 Cloudflare（`dylan.ns.cloudflare.com` / `paloma.ns.cloudflare.com`）→ ✅ 条件 1 满足。
- `blog.adoai.me` 目前解析到 Cloudflare 的代理 IP（`172.67.189.58`、`104.21.9.102` 等），
  说明你 zone 里**可能已经有一条 `blog` 的（被代理的）记录**。→ 加自定义域之前，先去
  Cloudflare 面板的 **DNS → 记录** 里看这条 `blog`：如果存在，先删掉或处理它，否则添加自定义域会被拦。
  （记录类型我从外部看不到，需要你在面板确认。）

---

## 7. Cloudflare 面板词汇表（看到就查这一节）

| 词 | 一句话解释 |
|---|---|
| 构建（Builds） | "从 Git 拉代码 → 装依赖 → 跑构建命令 → 跑部署命令"这套自动流程 |
| 部署（Deployments） | 每次构建上线的结果记录；出问题先来这里看日志，也可以在这里回滚到上一版 |
| 版本（Versions） | Worker 的不可变快照，部署就是"把某个版本设为当前生效版本" |
| 回滚（Rollback） | 把线上切回之前的某个版本（面板可点，命令行是 `npx wrangler rollback`） |
| 生产分支 | 触发正式部署的那个分支，你的仓库是 `master` |
| 预览 / 预览 URL | 非生产分支构建出来的临时环境与它的临时地址 |
| 域和路由（Domains & Routes） | 给 Worker 挂域名的入口：自定义域、路由、workers.dev 开关都在这 |
| 变量和密钥（Variables & Secrets） | **运行时**变量，给 Worker 脚本用的。你没有脚本 → 用不上 |
| 构建变量（Build variables） | **构建时**变量，Node/pnpm 版本、`SITE_URL` 这类都在这设 |
| 绑定（Bindings） | 把 KV / D1 / R2 / AI 等资源挂到 Worker 脚本上。你的纯静态站一个都不需要 |
| 观察 / 实时日志（Logs） | Worker 脚本运行时的日志。你没有脚本 → 用不上 |
| 分析（Analytics） | 请求量、状态码、地理位置等统计 |

---

## 8. 日常更新流程（回答"只能本地改好再推吗"）

**是的，主流做法就是本地改 → 推 GitHub → Cloudflare 自动构建部署。推完 Cloudflare 那边什么都不用做。**

只有一种例外：你改了**平台设置**（构建命令、部署命令、环境变量、分支、域名），那才需要去面板改。

```bash
cd /e/AI/project/Firefly-blog

git pull            # 先拉，避免和网页端改动冲突
# ……改文件（写文章用 pnpm new-post <文件名>）……

pnpm dev            # 本地实时预览 http://localhost:4321
pnpm build          # 可选：本地先确认能构建成功

git add -A
git commit -m "feat: 新增文章 xxx"
git push            # ← 这一下就触发了 Cloudflare 的自动构建
```

- 也可以直接在 **GitHub 网页**上改文件（适合改文章、小配置），一样会触发构建；但记得下次本地改之前先 `git pull`。
- 推送后去 Worker 的部署记录看进度，通常 1–3 分钟上线。
- 你的仓库里还有一条 GitHub Actions 工作流 `.github/workflows/deploy.yml`，推 `master` 时也会跑，往 **GitHub Pages** 部署。
  如果你确定只用 Cloudflare：要么把 GitHub Pages 一并配好当备份，要么把这条 workflow 删掉，
  免得每次推送多跑一次、并且在 GitHub 上显示红叉【推断：Pages 未在仓库设置里启用时，`deploy-pages` 会失败】。
- 顺带一提：你最近那条提交 `3da522c` 的提交信息是 "null"，内容只是给一行注释加了个空格——应该是误提交，不影响功能，
  以后按仓库约定写 `feat:` / `fix:` / `chore:` 更清楚。

---

## 9. 上游主题升级怎么同步（fork 的长期维护）

上游是 `CuteLeaf/Firefly`，你的 fork 是 `llx2333/Firefly-blog`。你改过的文件越多，同步时冲突越多。
目前你只动过三处：`src/config/siteConfig.ts`（site_url）、`astro.config.mjs`（SITE_URL 支持）、`wrangler.jsonc`（名字 + 404）。

```bash
cd /e/AI/project/Firefly-blog
git remote add upstream https://github.com/CuteLeaf/Firefly.git   # 只需一次
git fetch upstream
git merge upstream/master          # 有冲突就按提示逐个解决，冲突大概率在那三个文件里
pnpm install                       # 上游可能新增/升级了依赖
pnpm build                         # 确认还能构建
git push
```

- 网页端 fork 页面也有 **Sync fork → Update branch**，但它只在**没有冲突**时可用；你改过配置，大概率要走上面的本地流程。
- 降低冲突的长期建议：个人内容放 `src/content/**`、图片放 `public/`，个人配置改动尽量集中在少数几个文件里。

---

## 10. 官方文档（要深挖时看这些）

- Workers 静态资源：https://developers.cloudflare.com/workers/static-assets/
- 静态资源计费与限制：https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- 平台限制（文件数/单文件大小/请求额度）：https://developers.cloudflare.com/workers/platform/limits/
- Workers Builds 配置（构建/部署命令、API 令牌）：https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- 构建镜像与可用变量（Node/pnpm 版本）：https://developers.cloudflare.com/workers/ci-cd/builds/build-image/
- 自定义域：https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- wrangler.jsonc 全字段（`assets` 各项默认值）：https://developers.cloudflare.com/workers/wrangler/configuration/
