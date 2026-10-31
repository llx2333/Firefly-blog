/**
 * 「未保存修改」守卫登记表（swup 站内换页拦截用）。
 *
 * beforeunload 只管关页/刷新，站内 swup 换页走不到它；编辑器（/write 与文章页
 * 双编辑器）把各自的确认逻辑登记进来，swup visit:start 前统一询问
 * （见 utils/swup-transitions.ts 的 hooks.before）。
 *
 * guard 返回 true = 允许离开；false = 用户取消离开。
 */
type DirtyGuard = () => boolean;

const guards = new Set<DirtyGuard>();

/** 登记一个守卫，返回注销函数（组件清理时调用）。 */
export function registerDirtyGuard(guard: DirtyGuard): () => void {
	guards.add(guard);
	return () => {
		guards.delete(guard);
	};
}

/** 依次询问所有守卫；任一返回 false（用户取消）即拦下换页。 */
export function confirmAllDirty(): boolean {
	for (const guard of guards) {
		if (!guard()) return false;
	}
	return true;
}
