import type { BackgroundWallpaperConfig } from "@/types/backgroundWallpaper";
import { profileConfig } from "./profileConfig";

export const backgroundWallpaper: BackgroundWallpaperConfig = {
	// 壁纸模式："banner" 横幅壁纸，"fullscreen" 全屏壁纸，"overlay" 覆盖透明，"none" 纯色背景无壁纸
	mode: "fullscreen",
	// 是否启用背景视频播放，配置后将在导航栏显示视频播放按钮
	// 批二下架主题自带背景视频（流萤 MP4，作者图床外链）；想恢复：改回 true 并放开下方 playerUrl
	playerEnable: false,
	/**
	 * 背景图片配置
	 * 图片路径支持三种格式：
	 * 1. public 目录（以 "/" 开头，不优化）："/assets/images/banner.avif"
	 * 2. src 目录（不以 "/" 开头，自动优化但会增加构建时间，推荐）："assets/images/banner.avif"
	 * 3. 远程 URL："https://example.com/banner.jpg"
	 * 注意：远程URL和public目录的图片不会被优化，请确保图片体积足够小以免影响加载速度
	 *
	 * 建议不要替换d1-d6，m1-m6这些默认示例图片，但你可以删除掉节省空间
	 * 因为以后可能会更换示例图片，导致你自定义的图片被覆盖
	 * 所以建议使用自己的图片的时候命名为其他名称，不要使用d1-d6，m1-m6这些名称
	 *
	 * 如果只使用一张图片或者使用随机图API，推荐直接使用字符串格式：
	 * desktop: "https://t.alcy.cc/pc",   // 随机图API
	 * desktop: "assets/images/DesktopWallpaper/d1.avif", // 单张图片
	 *
	 * mobile: "https://t.alcy.cc/mp", // 随机图API
	 * mobile: "assets/images/MobileWallpaper/m1.avif", // 单张图片
	 *
	 * 支持配置多张图片（数组），每次刷新页面随机显示一张：
	 * desktop: [
	 * "assets/images/DesktopWallpaper/d1.avif",
	 * "assets/images/DesktopWallpaper/d2.avif",
	 * ],
	 *
	 * mobile:[
	 *   "assets/images/MobileWallpaper/m1.avif",
	 *   "assets/images/MobileWallpaper/m2.avif",
	 * ],
	 */
	src: {
		// 桌面背景图片（支持单张或多张随机）
		// 批六起主组 = 通用池（四季常驻轮播）+ 季节池（desktopSeasonal，只在对应季节并入）
		// 批七起新增主题配对池（desktopThemePairs）：同景亮/暗双版占一个轮播位，
		// 按当前亮暗色主题只下载显示对应版本；配对成员不再出现在单张数组里
		desktop: [
			"assets/images/DesktopWallpaper/garden-1.avif",
			"assets/images/DesktopWallpaper/garden-2.avif",
			"assets/images/DesktopWallpaper/garden-3.avif",
			"assets/images/DesktopWallpaper/garden-4.avif",
			"assets/images/DesktopWallpaper/garden-5.avif",
			"assets/images/DesktopWallpaper/d1.avif",
			"assets/images/DesktopWallpaper/d2.avif",
			"assets/images/DesktopWallpaper/pd001.avif",
			"assets/images/DesktopWallpaper/pd013.avif",
			"assets/images/DesktopWallpaper/pd022.avif",
			"assets/images/DesktopWallpaper/pd023.avif",
			"assets/images/DesktopWallpaper/pd025.avif",
			"assets/images/DesktopWallpaper/pd035.avif",
			"assets/images/DesktopWallpaper/pd040.avif",
			"assets/images/DesktopWallpaper/pd045.avif",
			"assets/images/DesktopWallpaper/pd068.avif",
			"assets/images/DesktopWallpaper/pd073.avif",
			"assets/images/DesktopWallpaper/pd074.avif",
			"assets/images/DesktopWallpaper/pd075.avif",
			"assets/images/DesktopWallpaper/pd076.avif",
			"assets/images/DesktopWallpaper/pd080.avif",
			"assets/images/DesktopWallpaper/pcd037.avif",
			"assets/images/DesktopWallpaper/pcd074.avif",
			"assets/images/DesktopWallpaper/garden-6.avif",
		],
		// 移动背景图片（支持单张或多张随机）；garden-m6 批六按用户清单剔除
		mobile: [
			"assets/images/MobileWallpaper/garden-m1.avif",
			"assets/images/MobileWallpaper/garden-m2.avif",
			"assets/images/MobileWallpaper/garden-m3.avif",
			"assets/images/MobileWallpaper/garden-m4.avif",
			"assets/images/MobileWallpaper/m1.avif",
			"assets/images/MobileWallpaper/m2.avif",
			"assets/images/MobileWallpaper/pm003.avif",
			"assets/images/MobileWallpaper/pm005.avif",
			"assets/images/MobileWallpaper/pm031.avif",
			"assets/images/MobileWallpaper/pm033.avif",
			"assets/images/MobileWallpaper/pm034.avif",
			"assets/images/MobileWallpaper/pm035.avif",
			"assets/images/MobileWallpaper/pm037.avif",
			"assets/images/MobileWallpaper/pm039.avif",
			"assets/images/MobileWallpaper/pm040.avif",
			"assets/images/MobileWallpaper/pcm033.avif",
			"assets/images/MobileWallpaper/pcm034.avif",
		],
		// 季节池（批六/批七）：只收季节特征极强的图（雪=冬、落瓣=春、柿子/落叶=秋…），
		// 客户端按访问月份把当季池并入轮播，其余季节的图躺在 <template> 里不会被下载；
		// 打标依据 = 生成提示词 + 目视核对；批六特型按生成脚本注释打标
		// （cd065-068/cm029-030 冬，cd069-070/cm031 春，cd071-073/cm032 秋，cd074/cm033-034 通用）
		// 批七：季节感极强的对成员移入 desktopThemePairs/mobileThemePairs 带 season 字段
		desktopSeasonal: {
			spring: [
				"assets/images/DesktopWallpaper/pd078.avif",
				"assets/images/DesktopWallpaper/pcd069.avif",
				"assets/images/DesktopWallpaper/pcd070.avif",
			],
			summer: [],
			autumn: [
				"assets/images/DesktopWallpaper/pcd071.avif",
				"assets/images/DesktopWallpaper/pcd072.avif",
				"assets/images/DesktopWallpaper/pcd073.avif",
			],
			winter: [
				"assets/images/DesktopWallpaper/pd051.avif",
				"assets/images/DesktopWallpaper/pd077.avif",
				"assets/images/DesktopWallpaper/pcd065.avif",
				"assets/images/DesktopWallpaper/pcd066.avif",
				"assets/images/DesktopWallpaper/pcd067.avif",
				"assets/images/DesktopWallpaper/pcd068.avif",
			],
		},
		mobileSeasonal: {
			spring: [
				"assets/images/MobileWallpaper/pm038.avif",
				"assets/images/MobileWallpaper/pcm031.avif",
			],
			summer: [],
			autumn: [
				"assets/images/MobileWallpaper/garden-m5.avif",
				"assets/images/MobileWallpaper/pcm032.avif",
			],
			winter: [
				"assets/images/MobileWallpaper/pm036.avif",
				"assets/images/MobileWallpaper/pcm029.avif",
				"assets/images/MobileWallpaper/pcm030.avif",
			],
		},
		// 主题配对池（批七）：同景亮/暗双版，一个配对一个轮播位；
		// light = 明亮/晨雾版（亮色主题显示），dark = 暗一点/金昏暖光版（暗色主题显示），
		// 判定依据 = 亮度测量（pair_analysis.json 的 L 值）+ 57 对逐对目视复核；
		// 带 season 的配对只在对应季节进入轮播
		desktopThemePairs: [
			{
				light: "assets/images/DesktopWallpaper/pd007.avif",
				dark: "assets/images/DesktopWallpaper/pd008.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd009.avif",
				dark: "assets/images/DesktopWallpaper/pd010.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd015.avif",
				dark: "assets/images/DesktopWallpaper/pd016.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd019.avif",
				dark: "assets/images/DesktopWallpaper/pd020.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd029.avif",
				dark: "assets/images/DesktopWallpaper/pd030.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd037.avif",
				dark: "assets/images/DesktopWallpaper/pd038.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd041.avif",
				dark: "assets/images/DesktopWallpaper/pd042.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd053.avif",
				dark: "assets/images/DesktopWallpaper/pd054.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd055.avif",
				dark: "assets/images/DesktopWallpaper/pd056.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd057.avif",
				dark: "assets/images/DesktopWallpaper/pd058.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd001.avif",
				dark: "assets/images/DesktopWallpaper/pcd002.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd005.avif",
				dark: "assets/images/DesktopWallpaper/pcd006.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd007.avif",
				dark: "assets/images/DesktopWallpaper/pcd008.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd009.avif",
				dark: "assets/images/DesktopWallpaper/pcd010.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd011.avif",
				dark: "assets/images/DesktopWallpaper/pcd012.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd013.avif",
				dark: "assets/images/DesktopWallpaper/pcd014.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd015.avif",
				dark: "assets/images/DesktopWallpaper/pcd016.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd017.avif",
				dark: "assets/images/DesktopWallpaper/pcd018.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd019.avif",
				dark: "assets/images/DesktopWallpaper/pcd020.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd021.avif",
				dark: "assets/images/DesktopWallpaper/pcd022.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd023.avif",
				dark: "assets/images/DesktopWallpaper/pcd024.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd026.avif",
				dark: "assets/images/DesktopWallpaper/pcd025.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd027.avif",
				dark: "assets/images/DesktopWallpaper/pcd028.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd031.avif",
				dark: "assets/images/DesktopWallpaper/pcd032.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd033.avif",
				dark: "assets/images/DesktopWallpaper/pcd034.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd035.avif",
				dark: "assets/images/DesktopWallpaper/pcd036.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd039.avif",
				dark: "assets/images/DesktopWallpaper/pcd040.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd042.avif",
				dark: "assets/images/DesktopWallpaper/pcd041.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd043.avif",
				dark: "assets/images/DesktopWallpaper/pcd044.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd045.avif",
				dark: "assets/images/DesktopWallpaper/pcd046.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd047.avif",
				dark: "assets/images/DesktopWallpaper/pcd048.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd049.avif",
				dark: "assets/images/DesktopWallpaper/pcd050.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd051.avif",
				dark: "assets/images/DesktopWallpaper/pcd052.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd057.avif",
				dark: "assets/images/DesktopWallpaper/pcd058.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd059.avif",
				dark: "assets/images/DesktopWallpaper/pcd060.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd061.avif",
				dark: "assets/images/DesktopWallpaper/pcd062.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pcd063.avif",
				dark: "assets/images/DesktopWallpaper/pcd064.avif",
			},
			{
				light: "assets/images/DesktopWallpaper/pd011.avif",
				dark: "assets/images/DesktopWallpaper/pd012.avif",
				season: "spring",
			},
		],
		mobileThemePairs: [
			{
				light: "assets/images/MobileWallpaper/pm001.avif",
				dark: "assets/images/MobileWallpaper/pm002.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pm007.avif",
				dark: "assets/images/MobileWallpaper/pm008.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pm013.avif",
				dark: "assets/images/MobileWallpaper/pm014.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pm019.avif",
				dark: "assets/images/MobileWallpaper/pm020.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pm023.avif",
				dark: "assets/images/MobileWallpaper/pm024.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pm025.avif",
				dark: "assets/images/MobileWallpaper/pm026.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm001.avif",
				dark: "assets/images/MobileWallpaper/pcm002.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm005.avif",
				dark: "assets/images/MobileWallpaper/pcm006.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm007.avif",
				dark: "assets/images/MobileWallpaper/pcm008.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm009.avif",
				dark: "assets/images/MobileWallpaper/pcm010.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm011.avif",
				dark: "assets/images/MobileWallpaper/pcm012.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm013.avif",
				dark: "assets/images/MobileWallpaper/pcm014.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm015.avif",
				dark: "assets/images/MobileWallpaper/pcm016.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm017.avif",
				dark: "assets/images/MobileWallpaper/pcm018.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm019.avif",
				dark: "assets/images/MobileWallpaper/pcm020.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm021.avif",
				dark: "assets/images/MobileWallpaper/pcm022.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pcm028.avif",
				dark: "assets/images/MobileWallpaper/pcm027.avif",
			},
			{
				light: "assets/images/MobileWallpaper/pm009.avif",
				dark: "assets/images/MobileWallpaper/pm010.avif",
				season: "autumn",
			},
			{
				light: "assets/images/MobileWallpaper/pm017.avif",
				dark: "assets/images/MobileWallpaper/pm018.avif",
				season: "spring",
			},
		],
		// 背景视频播放地址
		// 支持单个视频路径（字符串）或多个视频循环（数组，参考上面壁纸配置）
		// 支持远程视频URL，本地视频请放在 public/assets/videos/ 目录下
		// playerUrl: "/assets/videos/firefly.mp4",
		// 主题原配视频（作者图床）批二下架；换成自己的视频时放开并改地址，同时把 playerEnable 改回 true
		// playerUrl: "https://bed.twoleaf.cn/file/1785658612716_firefly.mp4",
	},
	// 备用壁纸组：主题原配流萤壁纸（批四恢复入库，d3-d6 / m3-m6 一并启用凑满 6+6）
	// 设置面板「壁纸风格」可在 主组(田园) / 这组(流萤) 间切换，默认田园；
	// 图片躺在 <template> 里，不切到流萤就不会下载，不影响默认加载速度
	altSrc: {
		desktop: [
			"assets/images/DesktopWallpaper/d1.avif",
			"assets/images/DesktopWallpaper/d2.avif",
			"assets/images/DesktopWallpaper/d3.avif",
			"assets/images/DesktopWallpaper/d4.avif",
			"assets/images/DesktopWallpaper/d5.avif",
			"assets/images/DesktopWallpaper/d6.avif",
		],
		mobile: [
			"assets/images/MobileWallpaper/m1.avif",
			"assets/images/MobileWallpaper/m2.avif",
			"assets/images/MobileWallpaper/m3.avif",
			"assets/images/MobileWallpaper/m4.avif",
			"assets/images/MobileWallpaper/m5.avif",
			"assets/images/MobileWallpaper/m6.avif",
		],
	},
	// 横幅壁纸和全屏壁纸共享配置
	common: {
		// 壁纸遮罩暗度，让横幅文字显示更清晰，0-1之间，值越大越暗
		dimOpacity: 0.2,
		// 多视频播放模式："order" 顺序循环，"random" 随机切换（仅当 playerUrl 为数组时生效）
		playerMode: "random",
		// 主页横幅文字
		homeText: {
			// 是否启用主页横幅文字
			enable: true,
			// 主页横幅主标题
			title: "My Little Field",
			// 主页横幅主标题字体大小
			titleSize: "3rem",
			// 主页横幅副标题（打字机文案池）
			// 风格基调：「地里又冒了点新东西」——田园比喻 + 随手记录的口气，
			// 可爱但不作：短句、无感叹号、不堆网络梗；农活/写字两块穿插排列
			// 避免「想怎样就怎样」的任性口气：原「想种什么种什么」已换成「留一垄给意外」
			subtitle: [
				"留一垄给意外",
				"今年想种点没吃过的",
				"长歪了也是收成",
				"架子歪了，明天扶",
				"坑踩多了，地就熟了",
				"浇水中，勿扰",
				"下雨了，正好歇着",
				"收成这事儿，随缘",
				"果子熟了自己会掉下来",
				"南瓜又偷偷大了一圈",
				"晒够太阳才甜",
				"种子还在土里睡懒觉",
				"今天也浇了水",
				"今天的风适合发呆",
				"地里又冒了点新东西",
				"杂草也是作物",
				"叶子上有虫，分它一口",
				"蚯蚓在底下帮我翻土呢",
				"田埂上的草认得我了",
				"篱笆矮，随便进",
				"慢慢种，不赶工期",
				"地头蹲了一会儿，啥也没干",
				"土是湿的，今天不用浇",
				"荒着也是一种种法",
				"今晚有月亮，适合磨蹭",
				"露水没干，先不下地",
				"在写，别催",
				"最近写得慢，但没停",
				"今天也在瞎折腾",
				"想到什么写什么",
				"灵感和猫，都叫不来",
				"刚才想到一句，又忘了",
				"更新看心情",
				"写下来的才不会忘",
				"字丑，意思到了",
				"写岔了，就当施肥",
				"错别字回头再抓",
				"这里很安静",
				"随便逛逛，别客气",
				"别急着走，地边坐坐",
				"评论区留了块空地",
				"下篇还没想好",
				"存稿箱比粮仓还空",
				"这条也是凑数的",
				"最近在折腾新东西",
				"有些话放这里就好",
				"慢慢来，比较快",
				"睡前随手记一点",
				"写完这篇就去睡觉",
				"键盘还热着",
			],
			// 主页横幅副标题字体大小
			subtitleSize: "1.5rem",
			typewriter: {
				// 是否启用打字机效果
				// 打字机开启 → 循环显示所有副标题
				// 打字机关闭 → 每次刷新随机显示一条副标题
				enable: true,
				// 打字速度（毫秒/字）：中文手打的从容节奏，不追求慢到焦心
				speed: 150,
				// 删除速度（毫秒/字）：比打字略快，是回格的直觉
				deleteSpeed: 80,
				// 完全显示后的暂停时间（毫秒）：留足读完一句再回味一下的工夫
				pauseTime: 4000,
			},
			// 是否显示标题下方的链接图标
			linksEnable: true,
			// 首页横幅标题下方的链接图标（可选，支持 showName 显示文字）
			// 单一数据源：与侧栏身份卡、导航「链接」下拉共用 profileConfig.links ——
			// 加/改社交入口只需改 profileConfig.ts 的 links 数组，三处自动同步
			links: profileConfig.links,
		},
		// 壁纸轮播配置，横幅壁纸和全屏壁纸共享，仅在配置多张图片时生效
		carousel: {
			// 是否启用壁纸轮播；关闭时保持每次刷新随机显示一张
			// 批四打开：轮播默认转起来，访客侧菜单也能随时开关
			enable: false,
			// 轮播切换间隔（毫秒）
			interval: 5000,
			// 过渡效果: 'fade' 渐变 | 'zoom' 缩放 | 'slide' 滑动 | 'kenburns' 旋转木马
			transitionEffect: "fade",
		},
		// 水波纹动画效果配置，开启会影响页面性能，增加内存占用，请根据自己的喜好开启
		waves: {
			enable: {
				// 桌面端是否启用水波纹动画效果
				desktop: true,
				// 移动端是否启用水波纹动画效果
				mobile: true,
			},
		},
		// 渐变过渡效果配置，当水波纹关闭时自动启用，提供壁纸底部到背景色的平滑过渡
		gradient: {
			enable: {
				// 桌面端是否启用渐变过渡
				desktop: true,
				// 移动端是否启用渐变过渡
				mobile: true,
			},
			// 渐变高度
			height: "10%",
		},
	},
	// Banner模式特有配置
	banner: {
		// 图片位置
		// 支持所有CSS object-position值，如: 'top', 'center', 'bottom', 'left top', 'right bottom', '25% 75%', '10px 20px'..
		// 如果不知道怎么配置百分百之类的配置，推荐直接使用：'center'居中，'top'顶部居中，'bottom' 底部居中，'left'左侧居中，'right'右侧居中
		position: "0% 20%",
		// 文章横幅信息："description" 显示描述，"meta" 显示日期、字数和阅读时长
		postInfo: {
			mode: "description",
		},
		// 导航栏配置
		navbar: {
			// 导航栏透明模式："semi" 半透明，"semifull" 动态透明，"none" 纯色不透明
			transparentMode: "semifull",
			// 毛玻璃模糊度，0 即关闭导航栏的毛玻璃
			// 注意：导航栏子菜单与浮动面板始终保留毛玻璃，模糊度跟随此项但有最小值
			blur: 12,
		},
	},
	// 覆盖透明覆盖模式特有配置
	overlay: {
		// 层级，确保壁纸在背景层
		zIndex: -1,
		// 壁纸透明度
		opacity: 0.67,
		// 背景模糊度
		blur: 3.5,
		// 卡片透明度，0-1之间，值越小越透明
		cardOpacity: 0.79,
	},
	// 全屏壁纸模式特有配置
	// 壁纸模糊度(blur)、卡片透明度(cardOpacity)、层级(zIndex) 复用上方 overlay 模式的配置；
	// 背景透明度(opacity)不适用（全屏壁纸不透明）；导航栏透明模式由 fullscreen.navbar.transparentMode 控制，脱离 banner 的 navbar 配置
	fullscreen: {
		// 布局模式："classic" 经典文档流全屏壁纸，"hero" 固定全屏首屏壁纸
		layout: "hero",
		// 图片位置
		position: "center",
		// 全屏壁纸模式的导航栏配置
		navbar: {
			// 导航栏透明模式："semi" 半透明，"semifull" 动态透明（仅首页顶部透明、下滑玻璃化；非首页均跟卡片半透明）
			transparentMode: "semifull",
			// 导航栏毛玻璃模糊度，0 即关闭（玻璃态生效）
			blur: 12,
		},
		// 首页下滑时壁纸模糊渐变开关（从 0 渐变为 overlay.blur 的最大模糊）
		// 关闭后该设备上全屏壁纸保持清晰（首页与非首页都不模糊），设置面板的模糊度滑块也会隐藏
		blurRamp: {
			enable: {
				// 桌面端是否启用模糊渐变
				desktop: true,
				// 移动端是否启用模糊渐变
				mobile: true,
			},
		},
	},
};
