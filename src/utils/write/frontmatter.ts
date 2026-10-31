import YAML from "yaml";

/**
 * /write 编辑器的 frontmatter 解析 / 序列化。
 *
 * 表单字段集与序列化顺序（任务文档 §2.3 冻结）：
 * title, published, updated, draft, description, image, tags, category,
 * pinned, author, series, seriesOrder, slug
 *
 * - 空值字段省略不写（draft 恒写、pinned 仅 true 时写、seriesOrder 仅在有值时写）。
 * - posts schema 里其余字段（lang / sourceLink / license* / comment / password* 等）
 *   不进表单，但解析时保留、序列化时原样带回，避免保存时静默丢字段。
 * - 日期按纯字符串（YYYY-MM-DD）处理；yaml 包 core schema 不会把未加引号的日期
 *   解析成 Date 对象，序列化时也不会给日期串加引号，与 new-post.js 生成的
 *   `published: 2026-10-25` 风格一致。
 */

export interface PostFrontmatter {
	title: string;
	published: string;
	updated: string;
	draft: boolean;
	description: string;
	image: string;
	tags: string[];
	category: string;
	pinned: boolean;
	author: string;
	series: string;
	seriesOrder: number | null;
	slug: string;
}

export interface ParsedPostFile {
	frontmatter: PostFrontmatter;
	body: string;
	/** 表单未覆盖的 schema 字段（lang 等），保存时原样带回 */
	extras: Record<string, unknown>;
}

/** 表单空态默认值（新建文章用） */
export function emptyFrontmatter(draft = true): PostFrontmatter {
	return {
		title: "",
		published: "",
		updated: "",
		draft,
		description: "",
		image: "",
		tags: [],
		category: "",
		pinned: false,
		author: "",
		series: "",
		seriesOrder: null,
		slug: "",
	};
}

const KNOWN_KEYS = new Set([
	"title",
	"published",
	"updated",
	"draft",
	"description",
	"image",
	"tags",
	"category",
	"pinned",
	"author",
	"series",
	"seriesOrder",
	"slug",
]);

/** YAML 值 → 日期字符串（容忍 Date / 带时间的 ISO 串） */
function toDateString(value: unknown): string {
	if (value == null) return "";
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value === "number") return "";
	const str = String(value).trim();
	if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
	return str;
}

function toNumberOrNull(value: unknown): number | null {
	if (value == null || value === "") return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * 解析整篇 markdown 文件文本。无 frontmatter 时按空 frontmatter 处理（不报错），
 * frontmatter 存在但 YAML 语法非法时抛错（错误信息面向用户）。
 */
export function parsePostFile(raw: string): ParsedPostFile {
	// BOM 会挡住 "---\n" 开头判断 → 整篇被当正文、frontmatter 全丢，先剥掉
	const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
	if (!text.startsWith("---\n")) {
		return { frontmatter: emptyFrontmatter(false), body: text, extras: {} };
	}
	// 结束分隔符必须是独立一行（\n--- 后紧跟 \n 或文件结束），跳过 "---x" 这类内容行
	let end = -1;
	for (let i = 3; ; ) {
		const hit = text.indexOf("\n---", i);
		if (hit === -1) break;
		const after = text[hit + 4];
		if (after === undefined || after === "\n") {
			end = hit;
			break;
		}
		i = hit + 1;
	}
	if (end === -1) {
		throw new Error("frontmatter 结束分隔符（---）缺失，请检查文件开头");
	}
	const fmText = text.slice(4, end);
	let raw2 = text.slice(end + 4); // 跳过 "\n---"
	if (raw2.startsWith("\n")) raw2 = raw2.slice(1);

	let data: Record<string, unknown>;
	try {
		data = YAML.parse(fmText) ?? {};
	} catch (error) {
		throw new Error(
			`frontmatter YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (typeof data !== "object" || Array.isArray(data)) {
		throw new Error("frontmatter 必须是键值对结构");
	}

	const extras: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (!KNOWN_KEYS.has(key)) extras[key] = value;
	}

	const tagsValue = data.tags;
	let tags: string[] = [];
	if (Array.isArray(tagsValue)) {
		tags = tagsValue.map((t) => String(t).trim()).filter(Boolean);
	} else if (typeof tagsValue === "string" && tagsValue.trim()) {
		tags = [tagsValue.trim()];
	}

	const frontmatter: PostFrontmatter = {
		title: data.title == null ? "" : String(data.title),
		published: toDateString(data.published),
		updated: toDateString(data.updated),
		draft: data.draft === true,
		description: data.description == null ? "" : String(data.description),
		image: data.image == null ? "" : String(data.image),
		tags,
		category: data.category == null ? "" : String(data.category ?? ""),
		pinned: data.pinned === true,
		author: data.author == null ? "" : String(data.author),
		series: data.series == null ? "" : String(data.series),
		seriesOrder: toNumberOrNull(data.seriesOrder),
		slug: data.slug == null ? "" : String(data.slug),
	};

	return { frontmatter, body: raw2, extras };
}

/**
 * 序列化整篇文件：固定字段顺序、空值省略、末尾恰好一个换行。
 * lineWidth: 0 关闭长行折行，避免长标题 / 长 tag 被折成多行。
 */
export function serializePostFile(
	fm: PostFrontmatter,
	extras: Record<string, unknown>,
	body: string,
): string {
	const ordered: Record<string, unknown> = {};
	ordered.title = fm.title;
	ordered.published = fm.published;
	if (fm.updated) ordered.updated = fm.updated;
	ordered.draft = fm.draft;
	if (fm.description) ordered.description = fm.description;
	if (fm.image) ordered.image = fm.image;
	if (fm.tags.length > 0) ordered.tags = fm.tags;
	if (fm.category) ordered.category = fm.category;
	if (fm.pinned) ordered.pinned = fm.pinned;
	if (fm.author) ordered.author = fm.author;
	if (fm.series) ordered.series = fm.series;
	if (fm.seriesOrder != null) ordered.seriesOrder = fm.seriesOrder;
	if (fm.slug) ordered.slug = fm.slug;

	for (const [key, value] of Object.entries(extras)) {
		ordered[key] = value;
	}

	const yamlText = YAML.stringify(ordered, { lineWidth: 0 });
	const normalizedBody = body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
	return `---\n${yamlText}---\n${normalizedBody}\n`;
}
