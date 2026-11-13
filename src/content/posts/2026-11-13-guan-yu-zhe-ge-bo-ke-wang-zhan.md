---
title: 关于这个网站
published: 2026-11-13
draft: false
description: 网站介绍
tags:
  - 介绍
pinned: true
slug: guan-yu-zhe-ge-bo-ke-wang-zhan
---
欢迎来到我的博客，这是一个纯静态博客，此博客是以[firefly-blog](https://github.com/CuteLeaf/Firefly)为基础进行的二次开发。

- 我的项目仓库：[https://github.com/llx2333/Firefly-blog](https://github.com/llx2333/Firefly-blog)
- 博客网址（当前）：[https://blog.adoai.me](https://blog.adoai.me)
- 博客网址（github pages镜像）：[https://blog-img.adoai.me](https://blog-img.adoai.me)

**特色功能：**

- **网页编辑器**：塞了一整套网页编辑器——作者用 GitHub token 登录（浏览器拿 token 调 GitHub 的 /user 接口验证身份）之后，打开任意一篇文章，点一下「编辑」，就能原地改它。免去了原项目每次改动都得打开项目，在编辑器里编辑后再用命令push到仓库这样繁杂的步骤
- **暂存草稿**：
有些没编辑完不能发布的草稿，如果用浏览器自带的存储，怕数据会丢失，而且不能跨设备，于是想到了一个方法：提交到另一个专门放草稿的分支 `write-drafts`。进入编辑器时顺手探测草稿分支有没有同名文件，只有草稿和线上版本不同、而且比线上新时才弹横幅，可载入、丢弃或忽略，否则完全不打扰。点「发布」时内容会提交回 master 分支，草稿分支上的暂存也自动清理。

**点「发布」之后发生了什么**
1. 当前页走的是 Cloudflare Pages，通过 GitHub 集成盯着仓库，每次push到github都会收到事件，然后自动拉代码、跑构建、把产物推到全球 CDN。暂存草稿的提交信息里带了 `[CI Skip]` 标记，Cloudflare 默认构建所有分支，没有这个的话每次暂存草稿都会构建，虽然不会影响主分支就是了。
2. 镜像走的是 Github Pages，仓库里的 Github Actions Workflow 只监听master分支的push，推送时自动构建，发布到pages。
