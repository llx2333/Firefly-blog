<script lang="ts">
/**
 * 主题化日期字段：原生 <input type="date"> 的日历弹层由浏览器自己绘制、不继承站点 CSS，
 * 暗色下图标发黑、弹层是系统白底，和站点风格完全割裂，所以改成自绘面板。
 * 对外契约与原生一致：value 是 "YYYY-MM-DD" 字符串，空串表示未选。
 */
import { tick } from "svelte";
import { todayDateString } from "@/utils/write/slug";

interface Props {
	id: string;
	value?: string;
	placeholder?: string;
	inputClass?: string;
}

let {
	id,
	value = $bindable(""),
	placeholder = "YYYY/MM/DD",
	inputClass = "",
}: Props = $props();

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

// 网格运算一律用当天正午做锚点：跨夏令时地区午夜可能不存在，会算错一天
function noon(year: number, month: number, day: number): Date {
	return new Date(year, month, day, 12, 0, 0, 0);
}

function toISO(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function toDisplay(iso: string): string {
	return iso.replace(/-/g, "/");
}

/** 手输解析：接受 2026-10-26 / 2026/10/26 / 2026.10.26；非法返回 null，空串返回 "" */
function parseTyped(raw: string): string | null {
	const text = raw.trim();
	if (!text) return "";
	const matched = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
	if (!matched) return null;
	const [year, month, day] = [
		Number(matched[1]),
		Number(matched[2]),
		Number(matched[3]),
	];
	const date = noon(year, month - 1, day);
	// 回读校验：挡住 2026-02-31 这类会被 Date 自动进位的日期
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null;
	}
	return toISO(date);
}

/** 挂到 body：弹窗本身有 overflow-y-auto，绝对定位面板会被裁切 */
function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		},
	};
}

let open = $state(false);
let text = $state(value ? toDisplay(value) : "");
let view = $state(noon(new Date().getFullYear(), new Date().getMonth(), 1));
let panelStyle = $state("");
let wrapper = $state<HTMLDivElement | null>(null);
let triggerEl = $state<HTMLButtonElement | null>(null);
let panelEl = $state<HTMLDivElement | null>(null);

// 外部改值（如「设为现在」）时同步显示文本
$effect(() => {
	const next = value;
	text = next ? toDisplay(next) : "";
});

$effect(() => {
	if (!open) return;
	const frame = requestAnimationFrame(position);
	const onScroll = () => position();
	const onResize = () => position();
	const onPointerDown = (event: PointerEvent) => {
		const target = event.target as Node;
		if (panelEl?.contains(target) || wrapper?.contains(target)) return;
		open = false;
	};
	// 捕获阶段拦下 Esc：否则冒泡到弹窗外层的 keydown 会把整个新建文章窗一起关掉
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.stopPropagation();
		event.preventDefault();
		open = false;
		triggerEl?.focus();
	};
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", onResize);
	document.addEventListener("pointerdown", onPointerDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	return () => {
		cancelAnimationFrame(frame);
		window.removeEventListener("scroll", onScroll, true);
		window.removeEventListener("resize", onResize);
		document.removeEventListener("pointerdown", onPointerDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
	};
});

const todayISO = $derived(todayDateString());

const cells = $derived.by(() => {
	const first = noon(view.getFullYear(), view.getMonth(), 1);
	const offset = (first.getDay() + 6) % 7; // 周一开头
	const list: { iso: string; day: number; outside: boolean }[] = [];
	for (let i = 0; i < 42; i++) {
		const date = noon(view.getFullYear(), view.getMonth(), 1 - offset + i);
		list.push({
			iso: toISO(date),
			day: date.getDate(),
			outside: date.getMonth() !== view.getMonth(),
		});
	}
	return list;
});

const monthLabel = $derived(
	`${view.getFullYear()}年${view.getMonth() + 1}月`,
);

function position() {
	const rect = wrapper?.getBoundingClientRect();
	if (!rect) return;
	const width = 276;
	const height = panelEl?.offsetHeight ?? 322;
	const gap = 6;
	const margin = 8;
	const maxLeft = Math.max(margin, window.innerWidth - width - margin);
	const left = Math.min(Math.max(margin, rect.left), maxLeft);
	let top = rect.bottom + gap;
	if (top + height > window.innerHeight - margin) {
		top = Math.max(margin, rect.top - height - gap);
	}
	panelStyle = `left:${left}px; top:${top}px; width:${width}px;`;
}

function commitTyped() {
	const parsed = parseTyped(text);
	if (parsed === null) {
		text = value ? toDisplay(value) : "";
		return;
	}
	value = parsed;
	text = parsed ? toDisplay(parsed) : "";
}

async function togglePanel() {
	if (open) {
		open = false;
		return;
	}
	const base = value
		? noon(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1)
		: noon(new Date().getFullYear(), new Date().getMonth(), 1);
	view = base;
	open = true;
	await tick();
	position();
}

function shiftMonth(delta: number) {
	view = noon(view.getFullYear(), view.getMonth() + delta, 1);
}

function pick(iso: string) {
	value = iso;
	text = toDisplay(iso);
	open = false;
	triggerEl?.focus();
}
</script>

<div class="relative w-full min-w-0" bind:this={wrapper}>
	<input
		{id}
		type="text"
		inputmode="numeric"
		autocomplete="off"
		spellcheck={false}
		class="{inputClass} pr-10"
		{placeholder}
		bind:value={text}
		onblur={commitTyped}
		onkeydown={(event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				commitTyped();
			}
		}}
	>
	<button
		type="button"
		class="dp-trigger absolute top-1/2 right-1 -translate-y-1/2"
		aria-label="选择日期"
		aria-haspopup="dialog"
		aria-expanded={open}
		bind:this={triggerEl}
		onclick={() => void togglePanel()}
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="currentColor"
				d="M5 22q-.825 0-1.412-.587T3 20V6q0-.825.588-1.412T5 4h1V3q0-.425.288-.712T7 2t.713.288T8 3v1h8V3q0-.425.288-.712T17 2t.713.288T18 3v1h1q.825 0 1.413.588T21 6v14q0 .825-.587 1.413T19 22zm0-2h14V10H5zM5 8h14V6H5zm0 0V6zm7 6q-.425 0-.712-.288T11 13t.288-.712T12 12t.713.288T13 13t-.288.713T12 14m-4.712-.288Q7 13.426 7 13t.288-.712T8 12t.713.288T9 13t-.288.713T8 14t-.712-.288M16 14q-.425 0-.712-.288T15 13t.288-.712T16 12t.713.288T17 13t-.288.713T16 14m-4 4q-.425 0-.712-.288T11 17t.288-.712T12 16t.713.288T13 17t-.288.713T12 18m-4.712-.288Q7 17.426 7 17t.288-.712T8 16t.713.288T9 17t-.288.713T8 18t-.712-.288M16 18q-.425 0-.712-.288T15 17t.288-.712T16 16t.713.288T17 17t-.288.713T16 18"
			></path>
		</svg>
	</button>
</div>

{#if open}
	<div
		class="dp-panel write-surface"
		style={panelStyle}
		role="dialog"
		aria-label="选择日期"
		bind:this={panelEl}
		use:portal
	>
		<div class="dp-head">
			<button type="button" class="dp-nav" aria-label="上个月" onclick={() => shiftMonth(-1)}>
				<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
					<path
						fill="currentColor"
						d="m10.8 12l3.9 3.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275l-4.6-4.6q-.15-.15-.212-.325T8.425 12t.063-.375t.212-.325l4.6-4.6q.275-.275.7-.275t.7.275t.275.7t-.275.7z"
					></path>
				</svg>
			</button>
			<div class="dp-title">{monthLabel}</div>
			<button type="button" class="dp-nav" aria-label="下个月" onclick={() => shiftMonth(1)}>
				<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
					<path
						fill="currentColor"
						d="M12.6 12L8.7 8.1q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.6 4.6q.15.15.213.325t.062.375t-.062.375t-.213.325l-4.6 4.6q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7z"
					></path>
				</svg>
			</button>
		</div>
		<div class="dp-grid">
			{#each WEEKDAYS as weekday (weekday)}
				<div class="dp-weekday">{weekday}</div>
			{/each}
			{#each cells as cell (cell.iso)}
				<button
					type="button"
					class="dp-day"
					class:is-outside={cell.outside}
					class:is-today={cell.iso === todayISO}
					class:is-selected={cell.iso === value}
					onclick={() => pick(cell.iso)}
				>
					{cell.day}
				</button>
			{/each}
		</div>
		<div class="dp-foot">
			<button type="button" class="dp-action" onclick={() => pick("")}>清除</button>
			<button type="button" class="dp-action dp-action-strong" onclick={() => pick(todayISO)}>今天</button>
		</div>
	</div>
{/if}
