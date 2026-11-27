import type { MusicPlayerConfig } from "../types/musicConfig";

// 音乐播放器配置
export const musicPlayerConfig: MusicPlayerConfig = {
	// 是否在导航栏显示音乐播放器入口
	showInNavbar: true,

	// 是否在侧边栏显示音乐播放器组件
	showInSidebar: false,

	// 使用方式："meting" 使用 Meting API，"local" 使用本地音乐列表
	mode: "local",

	// 默认音量 (0-1)
	volume: 0.7,

	// 播放模式：'list'=列表循环, 'one'=单曲循环, 'random'=随机播放
	playMode: "list",

	// 是否显启用歌词
	showLyrics: false,

	// Meting API 配置
	meting: {
		// Meting API 地址
		// 默认使用官方 API，也可以使用自定义 API
		api: "https://api.i-meto.com/meting/api?server=:server&type=:type&id=:id&r=:r",
		// 音乐平台：netease=网易云音乐, tencent=QQ音乐, kugou=酷狗音乐, xiami=虾米音乐, baidu=百度音乐
		server: "netease",
		// 类型：song=单曲, playlist=歌单, album=专辑, search=搜索, artist=艺术家
		type: "playlist",
		// 歌单/专辑/单曲 ID 或搜索关键词
		id: "10046455237",
		// 认证 token（可选）
		auth: "",
		// 备用 API 配置（当主 API 失败时使用）
		fallbackApis: [
			"https://api.injahow.cn/meting/?server=:server&type=:type&id=:id",
			"https://api.moeyao.cn/meting/?server=:server&type=:type&id=:id",
		],
	},

	// 本地音乐配置（当 mode 为 'local' 时使用）
	// 1. 支持传入歌词文件的路径
	// lrc: "/assets/music/lrc/使一颗心免于哀伤-哼唱.lrc",
	// 2. 或者直接填入歌词字符串内容
	// lrc: "[00:00.00]歌词内容...",
	local: {
		playlist: [
			{
				name: "使一颗心免于哀伤",
				artist: "知更鸟 / HOYO-MiX / Chevy",
				url: "/assets/music/使一颗心免于哀伤-哼唱.mp3",
				cover: "/assets/music/cover/109951169585655912.webp",
				lrc: "",
			},
			{
				name: "The Way I Still Love You",
				artist: "ALisa",
				url: "/assets/music/ALisa - The Way I Still Love You.mp3",
			},
			{
				name: "流行的云",
				artist: "ALisa,五月的钢琴",
				url: "/assets/music/ALisa,五月的钢琴-流行的云.mp3",
			},
			{
				name: "和煦的糖果风",
				artist: "Candy_Wind",
				url: "/assets/music/Candy_Wind - 和煦的糖果风.mp3",
			},
			{
				name: "那个夏天",
				artist: "Clear Sky",
				url: "/assets/music/Clear Sky - 那个夏天.mp3",
			},
			{
				name: "Beach Bonfire",
				artist: "CMJ",
				url: "/assets/music/CMJ - Beach Bonfire.mp3",
			},
			{
				name: "Kilig",
				artist: "CMJ",
				url: "/assets/music/CMJ - Kilig.mp3",
			},
			{
				name: "夏日物语",
				artist: "CMJ",
				url: "/assets/music/CMJ - 夏日物语.mp3",
			},
			{
				name: "满目星河",
				artist: "CMJ",
				url: "/assets/music/CMJ - 满目星河.mp3",
			},
			{
				name: "除了春天爱情和樱花(是心动啊)",
				artist: "CMJ",
				url: "/assets/music/CMJ - 除了春天爱情和樱花(是心动啊).mp3",
			},
			{
				name: "关于星星的秘密",
				artist: "CMJ,好多纯音乐",
				url: "/assets/music/CMJ,好多纯音乐-关于星星的秘密.mp3",
			},
			{
				name: "Disappear in Light (feat. Equal Stones)",
				artist: "Endless Melancholy",
				url: "/assets/music/Endless Melancholy Equal Stones - Disappear in Light(feat. Equal Stones).mp3",
			},
			{
				name: "晨曦",
				artist: "Hattori李腾",
				url: "/assets/music/Hattori李腾 - 晨曦.mp3",
			},
			{
				name: "another perspective",
				artist: "Idealism, Lassi Kotamäki",
				url: "/assets/music/Idealism Lassi Kotamäki - another perspective.mp3",
			},
			{
				name: "Puddles",
				artist: "Jordy Chandra, Jay-Lounge",
				url: "/assets/music/Jordy Chandra Jay-Lounge - Puddles.mp3",
			},
			{
				name: "Gettin Sleepy",
				artist: "Kaleo",
				url: "/assets/music/Kaleo - Gettin Sleepy.mp3",
			},
			{
				name: "纯纯的夏天",
				artist: "LIKPIA",
				url: "/assets/music/LIKPIA - 纯纯的夏天.mp3",
			},
			{
				name: "Wind With Clouds",
				artist: "Little End",
				url: "/assets/music/Little End-Wind With Clouds.mp3",
			},
			{
				name: "Bittersweet Chocolate",
				artist: "mr. hong",
				url: "/assets/music/mr. hong - Bittersweet Chocolate.mp3",
			},
			{
				name: "A Moment to Remember",
				artist: "Nom Tunes",
				url: "/assets/music/Nom Tunes - A Moment to Remember.mp3",
			},
			{
				name: "I Love the Rain",
				artist: "Nom Tunes",
				url: "/assets/music/Nom Tunes - I Love the Rain.mp3",
			},
			{
				name: "Haru Haru",
				artist: "Piano Dreamers",
				url: "/assets/music/Piano Dreamers-Haru Haru.mp3",
			},
			{
				name: "The truth that you leave",
				artist: "Pianoboy高至豪",
				url: "/assets/music/Pianoboy高至豪 - The truth that you leave.mp3",
			},
			{
				name: "Sacred Play SecretPlace_雨夜",
				artist: "Wiz-H",
				url: "/assets/music/Wiz-H - Sacred Play SecretPlace_雨夜.mp3",
			},
			{
				name: "open",
				artist: "yutaka hirasaka",
				url: "/assets/music/yutaka hirasaka - open.mp3",
			},
			{
				name: "三葉のテーマ（『君の名は。』より） (Piano Ver.)",
				artist: "Piano Echoes",
				url: "/assets/music/三葉のテーマ（『君の名は。』より） (Piano Ver.)@Piano Echoes.mp3",
			},
			{
				name: "Wind says",
				artist: "夏KLE",
				url: "/assets/music/夏KLE - Wind says.mp3",
			},
			{
				name: "夏夜萤火",
				artist: "酥糖Yuki",
				url: "/assets/music/夏夜萤火 - 酥糖Yuki.mp3",
			},
			{
				name: "明日、夕暮れまで",
				artist: "妹尾武",
				url: "/assets/music/妹尾武-明日、夕暮れまで.mp3",
			},
			{
				name: "微光",
				artist: "时空储蓄罐",
				url: "/assets/music/微光@时空储蓄罐.mp3",
			},
			{
				name: "微风拂过你的脸",
				artist: "hea2t",
				url: "/assets/music/微风拂过你的脸 - hea2t.mp3",
			},
			{
				name: "时光旅途（纯音乐版）",
				artist: "CMJ",
				url: "/assets/music/时光旅途（纯音乐版） - CMJ.mp3",
			},
			{
				name: "阵雨",
				artist: "时空储蓄罐",
				url: "/assets/music/时空储蓄罐 - 阵雨.mp3",
			},
			{
				name: "等星星溺海",
				artist: "月色已晚",
				url: "/assets/music/月色已晚 - 等星星溺海.mp3",
			},
			{
				name: "海边的曼彻斯特",
				artist: "森水垚",
				url: "/assets/music/森水垚 - 海边的曼彻斯特.mp3",
			},
			{
				name: "水星湖",
				artist: "羽肿",
				url: "/assets/music/水星湖 - 羽肿.mp3",
			},
			{
				name: "海风拂枕『治愈』",
				artist: "王利民",
				url: "/assets/music/王利民 - 海风拂枕『治愈』.mp3",
			},
			{
				name: "Rain After Summer",
				artist: "羽肿",
				url: "/assets/music/羽肿 - Rain After Summer.mp3",
			},
			{
				name: "若你困于无风之地",
				artist: "MOCKER44",
				url: "/assets/music/若你困于无风之地 - MOCKER44..mp3",
			},
			{
				name: "远书",
				artist: "忘乡",
				url: "/assets/music/远书@忘乡.mp3",
			},
		],
	},
};
