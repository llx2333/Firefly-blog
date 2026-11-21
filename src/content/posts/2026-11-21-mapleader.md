---
title: mapleader
published: 2026-11-21
draft: false
description: nvim的mapleader
tags:
  - nvim
category: nvim配置
series: nvim配置
slug: mapleader
---
- nvim配置里的mapleader是一个自定义的前缀键，就像dd,db,diw,其中d就是前缀键。\
  - 在配置中定义leader
  ```bash
  # 把空格设置成leader
  vim.g.mapleader = " "
  ```
  - 使用leader
  ```bash
  # 在normal模式下把空格z这个快捷键设置成撤销的功能
  vim.keymap.set("n", "<leader>z", "<Cmd>undo<CR>")
  ```
- 这套机制是怎么工作的？\
  nvim遇到<leader>这个预留的标记会去读取全局的mapleader这个变量，只要设置一下，就会自动去使用。
