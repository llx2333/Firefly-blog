import { type CollectionEntry, getCollection } from "astro:content";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { getCategoryUrl } from "@utils/url-utils";

// // Retrieve posts and sort them by publication date
async function getRawSortedPosts() {
	const allBlogPosts = await getCollection("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});

	const sorted = allBlogPosts.sort((a, b) => {
		// 首先按置顶状态排序，置顶文章在前
		if (a.data.pinned && !b.data.pinned) return -1;
		if (!a.data.pinned && b.data.pinned) return 1;

		// 如果置顶状态相同，则按发布日期排序
		const dateA = new Date(a.data.published);
		const dateB = new Date(b.data.published);
		return dateA > dateB ? -1 : 1;
	});
	return sorted;
}

export async function getSortedPosts(): Promise<CollectionEntry<"posts">[]> {
	const sorted = await getRawSortedPosts();

	for (let i = 1; i < sorted.length; i++) {
		sorted[i].data.nextSlug = sorted[i - 1].id;
		sorted[i].data.nextTitle = sorted[i - 1].data.title;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		sorted[i].data.prevSlug = sorted[i + 1].id;
		sorted[i].data.prevTitle = sorted[i + 1].data.title;
	}

	return sorted;
}
export type PostForList = {
	id: string;
	data: CollectionEntry<"posts">["data"];
};
export async function getSortedPostsList(): Promise<PostForList[]> {
	const sortedFullPosts = await getRawSortedPosts();

	// delete post.body
	const sortedPostsList = sortedFullPosts.map((post) => ({
		id: post.id,
		data: post.data,
	}));

	return sortedPostsList;
}

/**
 * 获取全部项目并按展示顺序排序
 * 排序规则：手动 order 降序（越大越靠前，未设置排最后）→ 发布时间降序 → 标题兜底
 * 注意：判断 order 是否设置必须用 !== undefined，否则 0 会被当作「未设置」排到最后
 */
export async function getSortedProjects(): Promise<
	CollectionEntry<"projects">[]
> {
	const allProjects = await getCollection("projects", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});

	return allProjects.sort((a, b) => {
		const ao = a.data.order;
		const bo = b.data.order;
		if (ao !== undefined && bo !== undefined) {
			if (ao !== bo) return bo - ao;
		} else if (ao === undefined && bo !== undefined) {
			return 1;
		} else if (ao !== undefined && bo === undefined) {
			return -1;
		}

		return (
			b.data.published.getTime() - a.data.published.getTime() ||
			a.data.title.localeCompare(b.data.title)
		);
	});
}

/**
 * 系列内排序：按 seriesOrder 升序，未设置者排最后；再按发布日期降序、标题兜底
 * 注意：判断 seriesOrder 是否设置必须用 !== undefined，否则 0 会被当作「未设置」排到最后
 */
function sortBySeriesOrder(a: PostForList, b: PostForList): number {
	const ao = a.data.seriesOrder;
	const bo = b.data.seriesOrder;
	if (ao !== undefined && bo !== undefined) {
		if (ao !== bo) return ao - bo;
	} else if (ao === undefined && bo !== undefined) {
		return 1;
	} else if (ao !== undefined && bo === undefined) {
		return -1;
	}
	// tiebreaker: 相同序号或都未设置时，按发布日期降序、标题兜底
	return (
		b.data.published.getTime() - a.data.published.getTime() ||
		a.data.title.localeCompare(b.data.title)
	);
}

/**
 * 获取当前文章所属系列的全部文章（按系列序号排序）
 * 文章未设置 series 时返回 null（文章页不渲染系列导航盒）
 */
export async function getSeriesPosts(
	currentPost: CollectionEntry<"posts">,
): Promise<{
	seriesName: string;
	posts: PostForList[];
	currentIndex: number;
} | null> {
	const seriesName = currentPost.data.series.trim();
	if (!seriesName) return null;

	const allPosts = await getSortedPostsList();
	const posts = allPosts.filter((p) => p.data.series.trim() === seriesName);
	posts.sort(sortBySeriesOrder);

	const currentIndex = posts.findIndex((p) => p.id === currentPost.id);
	return { seriesName, posts, currentIndex };
}

export type Series = { name: string; count: number; posts: PostForList[] };

/**
 * 获取全站所有系列（按文章中 series 字段分组，每组内部按系列序号排序）
 * 供 /series/ 索引页使用
 */
export async function getSeriesList(): Promise<Series[]> {
	const allPosts = await getSortedPostsList();

	const groupMap = new Map<string, PostForList[]>();
	for (const post of allPosts) {
		const name = post.data.series.trim();
		if (!name) continue;
		if (!groupMap.has(name)) groupMap.set(name, []);
		groupMap.get(name)?.push(post);
	}

	const seriesList: Series[] = [];
	for (const [name, posts] of groupMap) {
		posts.sort(sortBySeriesOrder);
		seriesList.push({ name, count: posts.length, posts });
	}

	seriesList.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
	return seriesList;
}
export type Tag = {
	name: string;
	count: number;
};

export async function getTagList(): Promise<Tag[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});

	const countMap: { [key: string]: number } = {};
	allBlogPosts.forEach((post: { data: { tags: string[] } }) => {
		post.data.tags.forEach((tag: string) => {
			if (!countMap[tag]) countMap[tag] = 0;
			countMap[tag]++;
		});
	});

	// sort tags
	const keys: string[] = Object.keys(countMap).sort((a, b) => {
		return a.toLowerCase().localeCompare(b.toLowerCase());
	});

	return keys.map((key) => ({ name: key, count: countMap[key] }));
}

export type Category = {
	name: string;
	count: number;
	url: string;
};

export async function getCategoryList(): Promise<Category[]> {
	const allBlogPosts = await getCollection<"posts">("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});
	const count: { [key: string]: number } = {};
	allBlogPosts.forEach((post: { data: { category: string | null } }) => {
		if (!post.data.category) {
			const ucKey = i18n(I18nKey.uncategorized);
			count[ucKey] = count[ucKey] ? count[ucKey] + 1 : 1;
			return;
		}

		const categoryName =
			typeof post.data.category === "string"
				? post.data.category.trim()
				: String(post.data.category).trim();

		count[categoryName] = count[categoryName] ? count[categoryName] + 1 : 1;
	});

	const lst = Object.keys(count).sort((a, b) => {
		return (
			count[b] - count[a] || a.toLowerCase().localeCompare(b.toLowerCase())
		);
	});

	const ret: Category[] = [];
	for (const c of lst) {
		ret.push({
			name: c,
			count: count[c],
			url: getCategoryUrl(c),
		});
	}
	return ret;
}
