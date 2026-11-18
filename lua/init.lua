-- Firefly 编辑器配置入口（系统自带，不可删除；lua/ 下其他文件可自由增删）。
-- 保存后点「重载配置」立即生效；语法错误会被忽略并提示，编辑器照常可用。
-- 以下示例默认全部注释，去掉行首 -- 即启用。

-- ff.opt 选项（未列出的字段一律忽略；缺省 = 站点默认值）
-- ff.opt.tab_size = 2          -- 缩进宽度：Tab 实得 2 个空格
-- ff.opt.wrap = false          -- 自动换行（缺省开启）
-- ff.opt.vim = true            -- 初始进入 vim 模式（之后仍可手动切换）
-- ff.opt.indent_guides = false -- 缩进竖线（缺省开启）
-- ff.opt.layout = "edit"       -- 编辑器布局："edit" | "split" | "preview"

-- ff.map 键位映射（mode 限 "normal" / "insert"）
-- ff.map("insert", "<M-j>", "<Esc>")      -- 右侧为按键记法：转发该按键（此处退出插入模式）
ff.map("insert", "jj", "<Esc>")
-- ff.map("normal", "<C-s>", "save")    -- 右侧为命令名：save = 保存当前文章
-- ff.map("normal", "gq", function()    -- 右侧也可以是 lua 函数
--   print("hello from firefly lua")
-- end)

-- 模块引用示例：新建 lua/mymodule.lua 后即可 require
-- local mymodule = require("lua.mymodule")
-- mymodule.hello()
