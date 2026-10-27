import { getSortedPosts } from "@/utils/content-utils";

export async function GET(): Promise<Response> {
	const posts = await getSortedPosts();

	const allPostsData = posts
		.map((post) => ({
			id: post.id,
			title: post.data.title,
			description: post.data.description,
			published: post.data.published.getTime(),
			category: post.data.category || "",
			password: !!post.data.password,
			// 相关文章客户端计算用（RelatedPostsList）：标签重合数 + 草稿过滤
			tags: post.data.tags.map((t) => t.trim()).filter(Boolean),
			draft: !!post.data.draft,
			// 系列客户端渲染用（SeriesPostsList）：系列名 + 排序序号
			series: post.data.series.trim(),
			seriesOrder: post.data.seriesOrder ?? null,
		}))
		// 日历按纯日期排序，忽略置顶
		.sort((a, b) => b.published - a.published);

	return new Response(JSON.stringify(allPostsData));
}
