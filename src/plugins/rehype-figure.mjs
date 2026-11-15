import { visit } from "unist-util-visit";
import { shouldAddNoReferrer } from "../utils/image-utils.ts";

/**
 * 站内图片 rehype 插件：为需要反盗链的图片补 referrerpolicy。
 * 批30 起 alt 文案不再渲染成 figcaption（P1 去图片下 caption，全站文章页），
 * 有无 alt 都只更新节点属性、保持 img 原样输出。
 *
 * @returns {Function} A transformer function for the rehype plugin
 */
export default function rehypeFigure() {
	return (tree) => {
		visit(tree, "element", (node) => {
			// 只处理 img 元素
			if (node.tagName !== "img") {
				return;
			}

			// 跳过已由其它插件接管渲染的图片（例如 plantuml）
			const classRaw = node.properties?.className;
			const classNames = Array.isArray(classRaw)
				? classRaw
				: typeof classRaw === "string"
					? classRaw.split(/\s+/)
					: [];
			if (classNames.includes("plantuml-image")) {
				return;
			}

			const imgProps = { ...node.properties };

			// 添加 referrerpolicy（如果需要）解决 403 问题
			if (imgProps.src && shouldAddNoReferrer(imgProps.src)) {
				imgProps.referrerpolicy = "no-referrer";
			}

			// 无 alt / 有 alt 一律原样输出（不再包 figure/figcaption）
			node.properties = imgProps;
		});
	};
}
