// 自定义氛围特效引擎：单张全屏固定画布 + 多画笔（painter），主线程 rAF 驱动。
// 生命周期：固定覆盖层画布 / resize 节流 / visibilitychange 暂停 / 明暗主题
// 感知，粒子规模小（全部开启约 250 个），主线程直绘足够。萤火虫/夜空繁星
// 仅暗色、丁达尔仅亮色（引擎按 themeMix 跳过，面板按 meta.themes 禁用对应行）。
import { ambientEffectsConfig } from "../config/effectsConfig";
import type { AmbientEffectId } from "../types/effectsConfig";

// 樱花素材图（原樱花特效已下线；轻盈花瓣仍复用这张图）
const PETAL_IMAGE_SRC = "/assets/images/effects/sakura.png";

export type Env = {
	w: number; // CSS 像素宽
	h: number; // CSS 像素高
	t: number; // 累计秒
	themeMix: number; // 0 亮色 → 1 暗色（平滑过渡系数）
};

type Particle = Record<string, number>;

type Painter = {
	id: AmbientEffectId;
	zIndex: number;
	init: (w: number, h: number) => void;
	update: (dt: number, env: Env) => void;
	draw: (ctx: CanvasRenderingContext2D, env: Env) => void;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const TAU = Math.PI * 2;

// ===========================================================================
// 落叶飘落：低饱和秋叶，缓摆下落，翻面 + 主脉
// ===========================================================================
const LEAF_COLORS: [number, number, number][] = [
	[72, 32, 58], // 秋黄
	[95, 22, 48], // 橄榄
	[38, 38, 55], // 赭石
	[150, 14, 50], // 灰绿
];

function makeLeavesPainter(count: number): Painter {
	const leaves: Particle[] = [];
	function spawn(p: Particle, w: number, h: number, top: boolean) {
		p.x = rand(0, w);
		p.y = top ? rand(-h * 0.3, -20) : rand(0, h);
		p.size = rand(9, 17);
		p.vy = rand(28, 55);
		p.rot = rand(0, TAU);
		p.rotSpeed = rand(-0.9, 0.9);
		p.swayAmp = rand(14, 34);
		p.swayFreq = rand(0.5, 1.1);
		p.phase = rand(0, TAU);
		p.color = Math.floor(rand(0, LEAF_COLORS.length));
		p.flip = Math.random() < 0.5 ? 1 : -1;
		p.alpha = rand(0.62, 0.9);
	}
	return {
		id: "leaves",
		zIndex: 100,
		init(w, h) {
			leaves.length = 0;
			for (let i = 0; i < count; i++) {
				const p: Particle = {};
				spawn(p, w, h, false);
				leaves.push(p);
			}
		},
		update(dt, env) {
			for (const p of leaves) {
				p.y += p.vy * dt;
				p.rot += p.rotSpeed * dt;
				if (p.y > env.h + 30) spawn(p, env.w, env.h, true);
			}
		},
		draw(ctx, env) {
			for (const p of leaves) {
				const sway = Math.sin(env.t * p.swayFreq + p.phase) * p.swayAmp;
				const [hue, sat, lig] = LEAF_COLORS[p.color];
				const s = p.size;
				ctx.save();
				ctx.translate(p.x + sway, p.y);
				ctx.rotate(p.rot + sway * 0.01);
				ctx.scale(p.flip, 1);
				ctx.globalAlpha = p.alpha;
				ctx.fillStyle = `hsl(${hue} ${sat}% ${lig}%)`;
				ctx.beginPath();
				ctx.moveTo(0, -s);
				ctx.quadraticCurveTo(s * 0.72, -s * 0.2, 0, s);
				ctx.quadraticCurveTo(-s * 0.72, -s * 0.2, 0, -s);
				ctx.fill();
				ctx.globalAlpha = p.alpha * 0.5;
				ctx.strokeStyle = `hsl(${hue} ${sat}% ${Math.max(lig - 18, 12)}%)`;
				ctx.lineWidth = 0.8;
				ctx.beginPath();
				ctx.moveTo(0, -s * 0.75);
				ctx.quadraticCurveTo(s * 0.1, 0, 0, s * 0.75);
				ctx.stroke();
				ctx.restore();
			}
			ctx.globalAlpha = 1;
		},
	};
}

// ===========================================================================
// 萤火虫光点：暖黄绿光晕游移 + 呼吸闪烁；亮色主题平滑隐去（themeMix 门控）
// ===========================================================================
function makeFirefliesPainter(count: number): Painter {
	const flies: Particle[] = [];
	function spawn(p: Particle, w: number, h: number) {
		p.x = rand(0, w);
		p.y = rand(0, h);
		p.halo = rand(9, 16);
		p.speed = rand(6, 18);
		p.wanderA = rand(0.15, 0.45);
		p.wanderB = rand(0.15, 0.45);
		p.phase = rand(0, TAU);
		p.pulseFreq = rand(0.6, 1.6);
		p.alphaBase = rand(0.5, 0.95);
	}
	return {
		id: "fireflies",
		zIndex: 100,
		init(w, h) {
			flies.length = 0;
			for (let i = 0; i < count; i++) {
				const p: Particle = {};
				spawn(p, w, h);
				flies.push(p);
			}
		},
		update(dt, env) {
			for (const p of flies) {
				p.x +=
					Math.cos(env.t * p.wanderA + p.phase) * p.speed * dt +
					4 * dt;
				p.y += Math.sin(env.t * p.wanderB + p.phase * 1.7) * p.speed * dt;
				if (p.x > env.w + 20) p.x = -20;
				if (p.x < -20) p.x = env.w + 20;
				if (p.y > env.h + 20) p.y = -20;
				if (p.y < -20) p.y = env.h + 20;
			}
		},
		draw(ctx, env) {
			if (env.themeMix < 0.02) return; // 亮色主题完全隐去
			for (const p of flies) {
				const pulse =
					0.35 + 0.65 * (0.5 + 0.5 * Math.sin(env.t * p.pulseFreq + p.phase));
				const a = p.alphaBase * pulse * env.themeMix;
				if (a <= 0.01) continue;
				const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.halo);
				g.addColorStop(0, `rgba(228, 240, 150, ${a.toFixed(3)})`);
				g.addColorStop(0.4, `rgba(190, 220, 95, ${(a * 0.35).toFixed(3)})`);
				g.addColorStop(1, "rgba(190, 220, 95, 0)");
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.halo, 0, TAU);
				ctx.fill();
				ctx.fillStyle = `rgba(245, 250, 210, ${Math.min(a * 1.3, 1).toFixed(3)})`;
				ctx.beginPath();
				ctx.arc(p.x, p.y, 1.3, 0, TAU);
				ctx.fill();
			}
		},
	};
}

// ===========================================================================
// 光斑尘埃：大而柔的散景光斑，缓慢上浮 + 轻摆
// 暗色：暖奶油白（灯光下的浮尘）；亮色：鼠尾草绿灰（换色 + 降透明度）
// ===========================================================================
function makeBokehPainter(count: number): Painter {
	const dots: Particle[] = [];
	function spawn(p: Particle, w: number, h: number, bottom: boolean) {
		p.x = rand(0, w);
		p.y = bottom ? rand(h + 60, h + 220) : rand(0, h);
		p.r = rand(24, 88);
		p.vy = -rand(5, 14);
		p.swayAmp = rand(8, 26);
		p.swayFreq = rand(0.12, 0.3);
		p.phase = rand(0, TAU);
		p.alpha = rand(0.075, 0.14);
	}
	return {
		id: "bokeh",
		zIndex: 100,
		init(w, h) {
			dots.length = 0;
			for (let i = 0; i < count; i++) {
				const p: Particle = {};
				spawn(p, w, h, false);
				dots.push(p);
			}
		},
		update(dt, env) {
			for (const p of dots) {
				p.y += p.vy * dt;
				if (p.y < -p.r - 40) spawn(p, env.w, env.h, true);
			}
		},
		draw(ctx, env) {
			// 亮色用绿灰调，暗色用暖白调；亮色整体再压一档
			const gr = Math.round(248 + (198 - 248) * (1 - env.themeMix));
			const gg = Math.round(240 + (214 - 240) * (1 - env.themeMix));
			const gb = Math.round(224 + (196 - 224) * (1 - env.themeMix));
			const alphaScale = 1 - 0.35 * (1 - env.themeMix);
			for (const p of dots) {
				const sway = Math.sin(env.t * p.swayFreq + p.phase) * p.swayAmp;
				const a = p.alpha * alphaScale;
				const g = ctx.createRadialGradient(
					p.x + sway,
					p.y,
					0,
					p.x + sway,
					p.y,
					p.r,
				);
				// 有轮廓的圆盘形光斑，而非纯雾
				g.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${a.toFixed(3)})`);
				g.addColorStop(
					0.55,
					`rgba(${gr}, ${gg}, ${gb}, ${(a * 0.55).toFixed(3)})`,
				);
				g.addColorStop(
					0.85,
					`rgba(${gr}, ${gg}, ${gb}, ${(a * 0.15).toFixed(3)})`,
				);
				g.addColorStop(1, `rgba(${gr}, ${gg}, ${gb}, 0)`);
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.arc(p.x + sway, p.y, p.r, 0, TAU);
				ctx.fill();
			}
		},
	};
}

// ===========================================================================
// 轻盈花瓣：原生樱花素材的低密度版（数量减半、更小更慢更飘）
// 素材加载失败时回退为手绘柔粉花瓣
// ===========================================================================
function makePetalsPainter(count: number): Painter {
	const petals: Particle[] = [];
	let img: HTMLImageElement | null = null;
	let imgReady = false;
	function spawn(p: Particle, w: number, h: number, top: boolean) {
		p.x = rand(0, w);
		p.y = top ? rand(-h * 0.2, -20) : rand(0, h);
		p.s = rand(0.4, 0.65); // 樱花基准 40px 的倍数
		p.vy = rand(30, 55);
		p.vx = rand(-18, -6);
		p.rot = rand(0, TAU);
		p.rotSpeed = rand(-0.8, 0.8);
		p.swayAmp = rand(10, 26);
		p.swayFreq = rand(0.4, 0.8);
		p.phase = rand(0, TAU);
		p.alpha = rand(0.5, 0.8);
	}
	return {
		id: "petals",
		zIndex: 100,
		init(w, h) {
			petals.length = 0;
			for (let i = 0; i < count; i++) {
				const p: Particle = {};
				spawn(p, w, h, false);
				petals.push(p);
			}
			if (!img) {
				img = new Image();
				img.onload = () => {
					imgReady = true;
				};
				img.src = PETAL_IMAGE_SRC;
			}
		},
		update(dt, env) {
			for (const p of petals) {
				p.y += p.vy * dt;
				p.x += p.vx * dt;
				p.rot += p.rotSpeed * dt;
				if (p.y > env.h + 30 || p.x < -40) spawn(p, env.w, env.h, true);
			}
		},
		draw(ctx, env) {
			for (const p of petals) {
				const sway = Math.sin(env.t * p.swayFreq + p.phase) * p.swayAmp;
				ctx.save();
				ctx.translate(p.x + sway, p.y);
				ctx.rotate(p.rot);
				ctx.globalAlpha = p.alpha;
				const size = 40 * p.s;
				if (imgReady && img) {
					ctx.drawImage(img, -size / 2, -size / 2, size, size);
				} else {
					// 回退：柔粉椭圆花瓣
					ctx.fillStyle = "hsl(345 45% 82%)";
					ctx.beginPath();
					ctx.ellipse(0, 0, size * 0.32, size * 0.5, 0, 0, TAU);
					ctx.fill();
				}
				ctx.restore();
			}
			ctx.globalAlpha = 1;
		},
	};
}

// ===========================================================================
// 流动风痕：时变流场驱动的成阵风痕。风场 = 三组行波叠加的伪噪声角场
// （流场笔触的通用做法，参考 Agafonkin 的 flow-field demo 与 codepen 各
// flow-field pen，不引噪声库）；阵风定时器每隔几秒往同一条风带撒 10–16
// 条风痕，风痕沿场滑行、按距离采样拖出渐隐长尾，头前带两粒尘点。
// ===========================================================================
type WindStreak = {
	pts: { x: number; y: number }[];
	x: number;
	y: number;
	dir: number;
	speed: number;
	life: number;
	dur: number;
	delay: number;
	width: number;
	alpha: number;
};

function makeWindPainter(count: number): Painter {
	const TRAIL_STEP = 6; // 尾迹按距离采样（px），保证快慢风痕尾长相近
	const TRAIL_MAX = 18; // 尾迹最多点数（≈100px 长尾）
	const streaks: WindStreak[] = [];
	let gustTimer = 0;
	let gustBandY = 0;
	let gustBandH = 60;
	let gustDir = 1;

	// 伪噪声角场：三组不同频率/方向的行波叠加，随时间缓慢漂移
	function fieldAngle(x: number, y: number, t: number): number {
		return (
			Math.sin(x * 0.006 - t * 0.9 + y * 0.004) * 0.55 +
			Math.sin(y * 0.011 + t * 0.6) * 0.4 +
			Math.sin((x + y) * 0.003 + t * 0.35) * 0.5
		);
	}

	// 一阵风：同一条水平风带里撒出一批风痕（75% 向右，其余向左）
	function spawnBatch(w: number, h: number, warmup: boolean): void {
		gustBandY = rand(h * 0.1, h * 0.9);
		gustBandH = rand(30, 90);
		gustDir = Math.random() < 0.75 ? 1 : -1;
		const quota = Math.min(
			12 + Math.floor(rand(0, 8)),
			count - streaks.length,
		);
		for (let i = 0; i < quota; i++) {
			streaks.push({
				pts: [],
				x: warmup ? rand(0, w) : gustDir > 0 ? -30 : w + 30,
				y: gustBandY + rand(-0.5, 0.5) * gustBandH,
				dir: gustDir,
				speed: rand(70, 150),
				life: 0,
				dur: rand(2.2, 4.2),
				delay: warmup ? rand(0, 1.4) : rand(0, 0.5),
				width: rand(1.0, 2.0),
				alpha: rand(0.36, 0.55),
			});
		}
	}

	return {
		id: "wind",
		zIndex: 100,
		init(w, h) {
			streaks.length = 0;
		spawnBatch(w, h, true);
		// 阵风间隔 1.4-3.0s：间隔过长时画面长时间无风痕（视觉验收实测空窗 1-2s 太频繁）
		gustTimer = rand(1.4, 3.0);
		},
		update(dt, env) {
			gustTimer -= dt;
			if (gustTimer <= 0) {
				spawnBatch(env.w, env.h, false);
				gustTimer = rand(1.4, 3.0);
			}
			for (let i = streaks.length - 1; i >= 0; i--) {
				const s = streaks[i];
				if (s.delay > 0) {
					s.delay -= dt;
					continue;
				}
				s.life += dt;
				if (s.life >= s.dur) {
					streaks.splice(i, 1);
					continue;
				}
				// 反向风把 x 镜像进角场，流向整体翻转
				const a = fieldAngle(s.dir > 0 ? s.x : -s.x, s.y, env.t);
				s.x += Math.cos(a) * s.speed * dt * s.dir;
				s.y += Math.sin(a) * s.speed * dt;
				const last = s.pts[s.pts.length - 1];
				if (!last || Math.hypot(s.x - last.x, s.y - last.y) >= TRAIL_STEP) {
					s.pts.push({ x: s.x, y: s.y });
					if (s.pts.length > TRAIL_MAX) s.pts.shift();
				}
			}
		},
		draw(ctx, env) {
			const cr = Math.round(122 + (208 - 122) * env.themeMix);
			const cg = Math.round(134 + (220 - 134) * env.themeMix);
			const cb = Math.round(122 + (210 - 122) * env.themeMix);
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			for (const s of streaks) {
				if (s.delay > 0 || s.pts.length < 2) continue;
				// 淡入 0.4s / 淡出 0.6s 包络
				const fadeIn = Math.min(1, s.life / 0.4);
				const fadeOut = Math.min(1, Math.max(0, (s.dur - s.life) / 0.6));
				const a = s.alpha * Math.min(fadeIn, fadeOut);
				if (a <= 0.01) continue;
				// 全段宽软晕（空气感）+ 末 6 段细亮核，两层叠出渐隐长尾
				ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${(a * 0.3).toFixed(3)})`;
				ctx.lineWidth = s.width * 2.4;
				ctx.beginPath();
				ctx.moveTo(s.pts[0].x, s.pts[0].y);
				for (let i = 1; i < s.pts.length; i++) {
					ctx.lineTo(s.pts[i].x, s.pts[i].y);
				}
				ctx.stroke();
				const coreFrom = Math.max(0, s.pts.length - 7);
				ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${a.toFixed(3)})`;
				ctx.lineWidth = s.width * 0.9;
				ctx.beginPath();
				ctx.moveTo(s.pts[coreFrom].x, s.pts[coreFrom].y);
				for (let i = coreFrom + 1; i < s.pts.length; i++) {
					ctx.lineTo(s.pts[i].x, s.pts[i].y);
				}
				ctx.stroke();
				// 头前尘点（沿尾迹向后取，落点在头后方）
				for (let d = 1; d <= 2; d++) {
					const dp = s.pts[Math.max(0, s.pts.length - 1 - d * 3)];
					ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${(a * (0.5 - d * 0.15)).toFixed(3)})`;
					ctx.beginPath();
					ctx.arc(dp.x, dp.y + (d === 1 ? -2 : 2), 1.2 - d * 0.3, 0, TAU);
					ctx.fill();
				}
			}
		},
	};
}

// ===========================================================================
// 蝴蝶飞舞：俯视双翅随扑动开合（俯仰压扁成侧线），橙褐田园色，
// 缓慢转向 + 周期性突变方向，出界折返
// ===========================================================================
function makeButterfliesPainter(count: number): Painter {
	const flies: Particle[] = [];
	function spawn(p: Particle, w: number, h: number, top: boolean) {
		p.x = rand(0, w);
		p.y = top ? rand(-40, -10) : rand(0, h);
		p.size = rand(9, 15);
		p.dir = rand(0, TAU);
		p.speed = rand(24, 44);
		p.flapFreq = rand(7, 11);
		p.flapPhase = rand(0, TAU);
		p.hue = rand(18, 38);
		p.sat = rand(38, 55);
		p.lig = rand(52, 62);
		p.turnT = rand(1, 3);
	}
	return {
		id: "butterflies",
		zIndex: 100,
		init(w, h) {
			flies.length = 0;
			for (let i = 0; i < count; i++) {
				const p: Particle = {};
				spawn(p, w, h, false);
				flies.push(p);
			}
		},
		update(dt, env) {
			for (const p of flies) {
				p.turnT -= dt;
				if (p.turnT <= 0) {
					p.dir += rand(-1.2, 1.2);
					p.turnT = rand(1.5, 3.5);
				}
				p.x += Math.cos(p.dir) * p.speed * dt;
				p.y += Math.sin(p.dir) * p.speed * 0.6 * dt;
				// 出界折向画面中心
				if (p.x < -30 || p.x > env.w + 30) {
					p.dir = Math.cos(p.dir) > 0 ? Math.PI - rand(0, 1) : rand(0, 1);
				}
				if (p.y < -30 || p.y > env.h + 30) {
					p.dir = Math.sin(p.dir) > 0 ? -rand(0.2, 1.2) : Math.PI + rand(0, 1.2);
				}
			}
		},
		draw(ctx, env) {
			for (const p of flies) {
				const flapS = Math.max(0.18, Math.abs(Math.sin(env.t * p.flapFreq + p.flapPhase)));
				const s = p.size;
				const lig = p.lig + env.themeMix * 6 - 3;
				ctx.save();
				ctx.translate(p.x, p.y);
				ctx.rotate(p.dir + Math.PI / 2);
				ctx.globalAlpha = 0.85;
				for (const side of [-1, 1]) {
					ctx.save();
					ctx.scale(side * flapS, 1);
					ctx.fillStyle = `hsl(${p.hue} ${p.sat}% ${lig}%)`;
					ctx.beginPath();
					ctx.ellipse(s * 0.55, -s * 0.35, s * 0.62, s * 0.48, -0.35, 0, TAU);
					ctx.fill();
					ctx.fillStyle = `hsl(${p.hue} ${p.sat - 8}% ${lig - 8}%)`;
					ctx.beginPath();
					ctx.ellipse(s * 0.42, s * 0.4, s * 0.45, s * 0.34, 0.3, 0, TAU);
					ctx.fill();
					ctx.restore();
				}
				ctx.fillStyle = "hsl(30 25% 30%)";
				ctx.beginPath();
				ctx.ellipse(0, 0, s * 0.09, s * 0.55, 0, 0, TAU);
				ctx.fill();
				ctx.restore();
			}
			ctx.globalAlpha = 1;
		},
	};
}

// ===========================================================================
// 细雨绵绵：细而斜的雨丝快速落下，暗色淡青、亮色青灰
// ===========================================================================
function makeDrizzlePainter(count: number): Painter {
	const drops: Particle[] = [];
	function spawn(p: Particle, w: number, h: number, top: boolean) {
		p.x = rand(-w * 0.05, w * 1.1);
		p.y = top ? rand(-h * 0.25, -10) : rand(0, h);
		p.len = rand(12, 18);
		p.vy = rand(420, 560);
		p.vx = -p.vy * rand(0.12, 0.17);
		p.alpha = rand(0.2, 0.34);
	}
	return {
		id: "drizzle",
		zIndex: 100,
		init(w, h) {
			drops.length = 0;
			for (let i = 0; i < count; i++) {
				const p: Particle = {};
				spawn(p, w, h, false);
				drops.push(p);
			}
		},
		update(dt, env) {
			for (const p of drops) {
				p.y += p.vy * dt;
				p.x += p.vx * dt;
				if (p.y > env.h + 20 || p.x < -40) spawn(p, env.w, env.h, true);
			}
		},
		draw(ctx, env) {
			const cr = Math.round(175 + (90 - 175) * (1 - env.themeMix));
			const cg = Math.round(195 + (110 - 195) * (1 - env.themeMix));
			const cb = Math.round(210 + (128 - 210) * (1 - env.themeMix));
			ctx.lineWidth = 1;
			ctx.lineCap = "round";
			for (const p of drops) {
				const k = p.len / p.vy;
				ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${p.alpha.toFixed(3)})`;
				ctx.beginPath();
				ctx.moveTo(p.x, p.y);
				ctx.lineTo(p.x - p.vx * k, p.y - p.vy * k);
				ctx.stroke();
			}
		},
	};
}

// ===========================================================================
// 雪花纷飞：小白点缓落轻摆，亮色下稍降存在感
// ===========================================================================
function makeSnowPainter(count: number): Painter {
	const flakes: Particle[] = [];
	function spawn(p: Particle, w: number, h: number, top: boolean) {
		p.x = rand(0, w);
		p.y = top ? rand(-20, -5) : rand(0, h);
		p.r = rand(1.1, 2.6);
		p.vy = rand(22, 46);
		p.drift = rand(-6, 6);
		p.swayAmp = rand(8, 26);
		p.swayFreq = rand(0.3, 0.8);
		p.phase = rand(0, TAU);
		p.alpha = rand(0.45, 0.85);
	}
	return {
		id: "snow",
		zIndex: 100,
		init(w, h) {
			flakes.length = 0;
			for (let i = 0; i < count; i++) {
				const p: Particle = {};
				spawn(p, w, h, false);
				flakes.push(p);
			}
		},
		update(dt, env) {
			for (const p of flakes) {
				p.y += p.vy * dt;
				p.x += p.drift * dt;
				if (p.y > env.h + 6) spawn(p, env.w, env.h, true);
				if (p.x < -10) p.x = env.w + 8;
				if (p.x > env.w + 10) p.x = -8;
			}
		},
		draw(ctx, env) {
			const alphaScale = 1 - 0.25 * (1 - env.themeMix);
			for (const p of flakes) {
				const sway = Math.sin(env.t * p.swayFreq + p.phase) * p.swayAmp;
				ctx.fillStyle = `rgba(252, 253, 255, ${(p.alpha * alphaScale).toFixed(3)})`;
				ctx.beginPath();
				ctx.arc(p.x + sway, p.y, p.r, 0, TAU);
				ctx.fill();
			}
		},
	};
}

// ===========================================================================
// 夜空繁星：闪烁星场（星团 + 均匀散布，纵向顶部偏置）+ 少量亮星十字星芒
// + 偶发流星点缀，仅暗色主题（themeMix 门控）。旧实现只有 3 颗流星，
// 与「繁星」名实不符；现以静态星场为主体，流星降级为点缀。
// ===========================================================================
function makeStarsPainter(count: number): Painter {
	type Star = {
		x: number;
		y: number;
		r: number;
		base: number;
		freq: number;
		phase: number;
		bright: number; // 1 = 亮星（光晕 + 四向星芒）
		color: number;
	};
	type Meteor = {
		x: number;
		y: number;
		vx: number;
		vy: number;
		len: number;
		life: number;
		dur: number;
		delay: number;
	};
	const STAR_COLORS: [number, number, number][] = [
		[255, 255, 255],
		[255, 246, 220],
		[214, 228, 255],
	];
	const stars: Star[] = [];
	const meteors: Meteor[] = [];

	function buildStars(w: number, h: number): void {
		stars.length = 0;
		// 3–4 个星团，其余均匀散布（纵向顶部偏置：越靠上越容易出星）
		const clusters: { cx: number; cy: number; rr: number }[] = [];
		const nClusters = 3 + Math.floor(rand(0, 2));
		for (let i = 0; i < nClusters; i++) {
			clusters.push({
				cx: rand(0, w),
				cy: rand(h * 0.05, h * 0.55),
				rr: rand(w * 0.08, w * 0.2),
			});
		}
		const nBright = Math.max(4, Math.round(count * 0.06));
		const nClustered = Math.round(count * 0.42);
		for (let i = 0; i < count; i++) {
			let x: number;
			let y: number;
			if (i < nClustered) {
				const c = clusters[i % clusters.length];
				const g1 = (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
				const g2 = (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
				x = c.cx + g1 * c.rr;
				y = c.cy + g2 * c.rr * 0.6;
			} else {
				x = rand(0, w);
				y = rand(0, h) * rand(0.25, 1) * 0.92;
			}
			const bright = i < nBright ? 1 : 0;
			stars.push({
				x: Math.min(Math.max(x, 4), w - 4),
				y: Math.max(y, 4),
				r: bright ? rand(1.4, 2.2) : rand(0.4, 1.2),
				base: bright ? rand(0.75, 0.95) : rand(0.25, 0.7),
				freq: rand(0.15, 0.6),
				phase: rand(0, TAU),
				bright,
				color: Math.floor(rand(0, STAR_COLORS.length)),
			});
		}
	}

	function spawnMeteor(m: Meteor, w: number, h: number): void {
		m.x = rand(w * 0.05, w * 0.95);
		m.y = rand(-20, h * 0.35);
		const dir = Math.random() < 0.5 ? 1 : -1;
		const sp = rand(420, 640);
		m.vx = dir * sp * rand(0.75, 0.95);
		m.vy = sp * rand(0.3, 0.5);
		m.len = rand(90, 180);
		m.dur = rand(0.7, 1.2);
		m.life = 0;
		m.delay = rand(7, 18);
	}

	return {
		id: "stars",
		zIndex: 100,
		init(w, h) {
			buildStars(w, h);
			meteors.length = 0;
			for (let i = 0; i < 2; i++) {
				const m = { delay: 0 } as Meteor;
				spawnMeteor(m, w, h);
				m.delay = i === 0 ? rand(2, 6) : rand(6, 12);
				meteors.push(m);
			}
		},
		update(dt, env) {
			for (const m of meteors) {
				if (m.delay > 0) {
					m.delay -= dt;
					continue;
				}
				m.life += dt;
				m.x += m.vx * dt;
				m.y += m.vy * dt;
				if (m.life >= m.dur || m.y > env.h + 60) spawnMeteor(m, env.w, env.h);
			}
		},
		draw(ctx, env) {
			if (env.themeMix < 0.02) return; // 亮色主题完全隐去
			const mix = env.themeMix;
			for (const s of stars) {
				const tw = 0.55 + 0.45 * Math.sin(env.t * s.freq * TAU + s.phase);
				const a = (0.45 + 0.55 * tw) * s.base * mix;
				if (a <= 0.01) continue;
				const [r, g, b] = STAR_COLORS[s.color];
				if (s.bright) {
					// 光晕 + 四向衍射星芒（随闪烁微缩放）
					const gl = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
					gl.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(a * 0.5).toFixed(3)})`);
					gl.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
					ctx.fillStyle = gl;
					ctx.beginPath();
					ctx.arc(s.x, s.y, s.r * 4, 0, TAU);
					ctx.fill();
					const spike = s.r * 3.4 * (0.6 + 0.4 * tw);
					ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${(a * 0.55).toFixed(3)})`;
					ctx.lineWidth = 0.7;
					ctx.beginPath();
					ctx.moveTo(s.x - spike, s.y);
					ctx.lineTo(s.x + spike, s.y);
					ctx.moveTo(s.x, s.y - spike);
					ctx.lineTo(s.x, s.y + spike);
					ctx.stroke();
				}
				ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(a, 1).toFixed(3)})`;
				ctx.beginPath();
				ctx.arc(s.x, s.y, s.r, 0, TAU);
				ctx.fill();
			}
			// 流星点缀（渐变尾 + 亮头）
			for (const m of meteors) {
				if (m.delay > 0) continue;
				const p = m.life / m.dur;
				const a = Math.sin(Math.PI * p) * mix;
				const mag = Math.hypot(m.vx, m.vy);
				const ux = m.vx / mag;
				const uy = m.vy / mag;
				const tailX = m.x - ux * m.len;
				const tailY = m.y - uy * m.len;
				const g = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
				g.addColorStop(0, `rgba(255, 244, 200, ${a.toFixed(3)})`);
				g.addColorStop(1, "rgba(255, 244, 200, 0)");
				ctx.strokeStyle = g;
				ctx.lineWidth = 1.6;
				ctx.lineCap = "round";
				ctx.beginPath();
				ctx.moveTo(m.x, m.y);
				ctx.lineTo(tailX, tailY);
				ctx.stroke();
				ctx.fillStyle = `rgba(255, 250, 224, ${Math.min(a * 1.4, 1).toFixed(3)})`;
				ctx.beginPath();
				ctx.arc(m.x, m.y, 1.8, 0, TAU);
				ctx.fill();
			}
		},
	};
}

// ===========================================================================
// 蒲公英絮：真实种子形态——伞冠（一簇带倒刺的弯曲细丝 + 丝端珠点）、
// 细柄、纺锤形瘦果。钟摆式摇摆 + 全体共享的慢变阵风（各自灵敏度不同），
// 缓慢自旋，出界轮回。粒子字段只有 number，逐丝差异用确定性 hash 生成。
// ===========================================================================
function makeDandelionPainter(count: number): Painter {
	const seeds: Particle[] = [];

	// 全局阵风：多正弦叠加的慢变横向气流（px/s，多数时候为正向微风）
	function gust(t: number): number {
		return (
			(0.6 +
				0.4 * Math.sin(t * 0.13) +
				0.35 * Math.sin(t * 0.31 + 1.7) +
				0.2 * Math.sin(t * 0.53 + 4.1)) *
			16
		);
	}

	// 确定性伪随机（同一根丝每次重绘取同一值，细丝不会逐帧乱闪）
	function hashJitter(i: number, p: Particle, k: number): number {
		const v = Math.sin(i * 127.1 + p.phase * 13.7 + k * 311.7) * 43758.5453;
		return v - Math.floor(v);
	}

	function spawn(p: Particle, w: number, h: number, edge: boolean) {
		if (edge) {
			// 从四周轮回，避免凭空出现
			const side = Math.floor(rand(0, 4));
			if (side === 0) {
				p.x = rand(0, w);
				p.y = -60;
			} else if (side === 1) {
				p.x = w + 60;
				p.y = rand(0, h);
			} else if (side === 2) {
				p.x = rand(0, w);
				p.y = h + 60;
			} else {
				p.x = -60;
				p.y = rand(0, h);
			}
		} else {
			p.x = rand(0, w);
			p.y = rand(0, h);
		}
		p.size = rand(22, 34); // 伞冠半径基准（16-26 在全屏壁纸上存在感不足，批九R4视觉验收上调）
		p.vy = rand(-12, 8);
		p.drift = rand(-8, 12);
		p.swayAmp = rand(14, 30);
		p.swayFreq = rand(0.15, 0.4);
		p.phase = rand(0, TAU);
		p.rot = rand(0, TAU);
		p.spinSpeed = rand(-0.12, 0.12);
		p.rockAmp = rand(0.15, 0.32);
		p.rockFreq = rand(0.35, 0.7);
		p.rockPhase = rand(0, TAU);
		p.windK = rand(0.7, 1.3); // 对阵风的灵敏度
		p.fil = 11 + Math.floor(rand(0, 5)); // 伞冠细丝数
		p.alpha = rand(0.55, 0.85);
	}

	return {
		id: "dandelion",
		zIndex: 100,
		init(w, h) {
			seeds.length = 0;
			for (let i = 0; i < count; i++) {
				const p: Particle = {};
				spawn(p, w, h, false);
				seeds.push(p);
			}
		},
		update(dt, env) {
			for (const p of seeds) {
				p.y += p.vy * dt;
				p.x += (p.drift + gust(env.t) * p.windK) * dt;
				p.rot += p.spinSpeed * dt;
				if (
					p.y < -60 ||
					p.y > env.h + 60 ||
					p.x < -60 ||
					p.x > env.w + 60
				) {
					spawn(p, env.w, env.h, true);
				}
			}
		},
		draw(ctx, env) {
			const fr = Math.round(152 + (226 - 152) * env.themeMix);
			const fg = Math.round(160 + (231 - 160) * env.themeMix);
			const fb = Math.round(142 + (212 - 142) * env.themeMix);
			const ar = Math.round(140 + (200 - 140) * env.themeMix);
			const ag = Math.round(130 + (192 - 130) * env.themeMix);
			const ab = Math.round(100 + (160 - 100) * env.themeMix);
			for (const p of seeds) {
				const sway = Math.sin(env.t * p.swayFreq + p.phase) * p.swayAmp;
				const rock =
					Math.sin(env.t * p.rockFreq * TAU + p.rockPhase) * p.rockAmp;
				const s = p.size;
				const fil = Math.round(p.fil);
				ctx.save();
				ctx.translate(p.x + sway, p.y);
				ctx.rotate(p.rot + rock);
				// 伞冠细丝：冠心为轴的扇形（±0.95 rad），二次曲线弯出弧度，
				// 0.75r 处两根倒刺，丝端一粒珠点
				ctx.strokeStyle = `rgba(${fr}, ${fg}, ${fb}, ${(p.alpha * 0.85).toFixed(3)})`;
				ctx.lineWidth = 0.7;
				const hub = s * 0.12;
				const tips: { x: number; y: number }[] = [];
				for (let i = 0; i < fil; i++) {
					const ang = (i / (fil - 1) - 0.5) * 1.9;
					const dx = Math.sin(ang);
					const dy = -Math.cos(ang);
					const j1 = hashJitter(i, p, 1);
					const j2 = hashJitter(i, p, 2);
					const r1 = s * (0.9 + j1 * 0.15);
					const ex = dx * r1;
					const ey = dy * r1;
					const cx2 = dx * r1 * 0.5 - dy * (j2 - 0.5) * s * 0.35;
					const cy2 = dy * r1 * 0.5 + dx * (j2 - 0.5) * s * 0.35;
					ctx.beginPath();
					ctx.moveTo(dx * hub, dy * hub);
					ctx.quadraticCurveTo(cx2, cy2, ex, ey);
					// 二次曲线 0.75 处的点（倒刺根部）
					const bt = 0.75;
					const mt = 1 - bt;
					const px = mt * mt * dx * hub + 2 * mt * bt * cx2 + bt * bt * ex;
					const py = mt * mt * dy * hub + 2 * mt * bt * cy2 + bt * bt * ey;
					for (const da of [-0.38, 0.38]) {
						const c = Math.cos(da);
						const sn = Math.sin(da);
						ctx.moveTo(px, py);
						ctx.lineTo(
							px + (dx * c - dy * sn) * s * 0.16,
							py + (dx * sn + dy * c) * s * 0.16,
						);
					}
					ctx.stroke();
					tips.push({ x: ex, y: ey });
				}
				ctx.fillStyle = `rgba(${fr}, ${fg}, ${fb}, ${p.alpha.toFixed(3)})`;
				for (const tp of tips) {
					ctx.beginPath();
						ctx.arc(tp.x, tp.y, 0.9, 0, TAU);
					ctx.fill();
				}
				// 细柄 + 纺锤形瘦果
				ctx.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${p.alpha.toFixed(3)})`;
				ctx.lineWidth = 1.1;
				ctx.beginPath();
				ctx.moveTo(0, hub * 0.5);
				ctx.lineTo(0, s * 0.42);
				ctx.stroke();
				ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${p.alpha.toFixed(3)})`;
				ctx.beginPath();
				ctx.ellipse(0, s * 0.62, s * 0.09, s * 0.22, 0, 0, TAU);
				ctx.fill();
				ctx.restore();
			}
		},
	};
}

// ===========================================================================
// 丁达尔光柱：同一颗太阳收敛的林间光束 + 束内浮尘，仅亮色主题。
// 所有束的轴线汇聚到画面上方同一个太阳点；每束用 6 层嵌套软边叠出体积感，
// 各层独立缓慢横移（呼吸感）；顶部入光口一团辉光。体积光散射的
// radial-scatter 后处理（Cyanilux/Babylon）需逐像素采样或 20–60 次叠绘，
// 对常驻氛围层太重，仍用参数化直绘。
// ===========================================================================
type TyndallBeam = {
	xBot: number; // 底边锚点（轴线过太阳点与该点）
	wBot: number; // 底边宽度
	phase: number; // 强度呼吸相位
	breathFreq: number; // 强度呼吸频率
	alpha: number; // 基础alpha
	motes: { s: number; u: number; speed: number; tw: number; twFreq: number; r: number }[];
};

function makeTyndallPainter(count: number): Painter {
	const beams: TyndallBeam[] = [];
	// 全局太阳点（所有束汇聚于此），init 时定一次
	let sunX = 0;
	let sunY = 0;
	const LAYER_W = [1.0, 0.8, 0.6, 0.42, 0.26, 0.12];
	const LAYER_A = [0.1, 0.17, 0.28, 0.45, 0.68, 1.0];

	function buildBeam(b: TyndallBeam, w: number, fresh: boolean): void {
		b.xBot = rand(w * -0.1, w * 1.1);
		b.wBot = rand(80, 190);
		b.phase = rand(0, TAU);
		b.breathFreq = rand(0.08, 0.2);
		b.alpha = rand(0.11, 0.16); // 批九R4视觉验收：0.05-0.09 在亮壁纸上整束不可见，提至 ~1.8×
		b.motes = [];
		for (let i = 0; i < 14; i++) {
			b.motes.push({
				s: fresh ? rand(0, 1) : rand(-0.1, 0),
				u: rand(-0.45, 0.45),
				speed: rand(0.012, 0.035),
				tw: rand(0, TAU),
				twFreq: rand(0.5, 1.6),
				r: rand(0.8, 1.5),
			});
		}
	}

	return {
		id: "tyndall",
		zIndex: 100,
		init(w, h) {
			beams.length = 0;
			sunX = rand(w * -0.2, w * 1.2);
			sunY = -h * rand(0.5, 1.1);
			for (let i = 0; i < count; i++) {
				const b = {} as TyndallBeam;
				buildBeam(b, w, true);
				beams.push(b);
			}
		},
		update(dt, env) {
			for (const b of beams) {
				for (const m of b.motes) {
					m.s += m.speed * dt;
					if (m.s > 1.05) {
						m.s = rand(-0.12, -0.02);
						m.u = rand(-0.45, 0.45);
					}
				}
			}
			void env;
		},
		draw(ctx, env) {
			const factor = 1 - env.themeMix; // 亮色=1，暗色=0
			if (factor < 0.02) return;
			const cr = 255;
			const cg = 250;
			const cb = 232;
			const h = env.h;
			for (const b of beams) {
				const breath =
					0.6 + 0.4 * Math.sin(env.t * b.breathFreq * TAU + b.phase);
				const a = b.alpha * breath * factor;
				if (a <= 0.004) continue;
				// 轴线：太阳点 → 底边锚点；顶边入射点取 y=-20 处
				const x1 = b.xBot;
				const y1 = h + 20;
				const uTop = (-20 - sunY) / (y1 - sunY);
				const x0 = sunX + (x1 - sunX) * uTop;
				const y0 = -20;
				const wTop = b.wBot * 0.35; // 越靠太阳越窄（束从太阳发散）
				const len = Math.hypot(x1 - x0, y1 - y0);
				const px = -(y1 - y0) / len; // 轴线的垂直方向
				const py = (x1 - x0) / len;
				const grad = ctx.createLinearGradient(x0, y0, x1, y1);
				grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${(a * 1.9).toFixed(4)})`);
				grad.addColorStop(0.55, `rgba(${cr}, ${cg}, ${cb}, ${(a * 1.2).toFixed(4)})`);
				grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, ${(a * 0.35).toFixed(4)})`);
				// 六层嵌套软边，各层独立缓慢横移
				for (let i = 0; i < LAYER_W.length; i++) {
					const jit =
						Math.sin(env.t * 0.25 * TAU + i * 2.1 + b.phase) * b.wBot * 0.02;
					const halfTop = (wTop * LAYER_W[i]) / 2;
					const halfBot = (b.wBot * LAYER_W[i]) / 2;
					const ox = px * jit;
					const oy = py * jit;
					ctx.fillStyle = grad;
					ctx.globalAlpha = LAYER_A[i];
					ctx.beginPath();
					ctx.moveTo(x0 - px * halfTop + ox, y0 - py * halfTop + oy);
					ctx.lineTo(x0 + px * halfTop + ox, y0 + py * halfTop + oy);
					ctx.lineTo(x1 + px * halfBot + ox, y1 + py * halfBot + oy);
					ctx.lineTo(x1 - px * halfBot + ox, y1 - py * halfBot + oy);
					ctx.closePath();
					ctx.fill();
				}
				ctx.globalAlpha = 1;
				// 顶部入光口辉光
				const glowR = wTop * 1.2;
				const glow = ctx.createRadialGradient(x0, y0, 0, x0, y0, glowR);
				glow.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${Math.min(a * 1.8, 0.5).toFixed(4)})`);
				glow.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(x0, y0, glowR, 0, TAU);
				ctx.fill();
				// 束内浮尘：沿轴参数 s、横向束宽比例 u；外圈淡晕 + 内核双弧
				for (const m of b.motes) {
					if (m.s < 0 || m.s > 1) continue;
					const halfW = (wTop + (b.wBot - wTop) * m.s) / 2;
					const bx = x0 + (x1 - x0) * m.s;
					const by = y0 + (y1 - y0) * m.s;
					const mx = bx + px * m.u * halfW;
					const my = by + py * m.u * halfW;
					const tw = 0.55 + 0.45 * Math.sin(env.t * m.twFreq * TAU + m.tw);
					ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${(a * 2.6 * tw * 0.25).toFixed(4)})`;
					ctx.beginPath();
					ctx.arc(mx, my, m.r * 2.6, 0, TAU);
					ctx.fill();
					ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${(a * 2.6 * tw).toFixed(4)})`;
					ctx.beginPath();
					ctx.arc(mx, my, m.r, 0, TAU);
					ctx.fill();
				}
			}
		},
	};
}

// ===========================================================================
// 管理器：画布生命周期 + rAF 循环 + 主题/可见性/尺寸感知
// ===========================================================================
export class AmbientEffectsManager {
	isRunning = false;

	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private painters = new Map<AmbientEffectId, Painter>();
	private active = new Set<AmbientEffectId>();
	private rafId: number | null = null;
	private lastFrameTime = 0;
	private elapsed = 0;
	private themeMix = 0;
	private cssW = 0;
	private cssH = 0;
	private resizeRafId: number | null = null;
	private boundHandleResize: (() => void) | null = null;
	private boundHandleVisibility: (() => void) | null = null;

	constructor() {
		const factories: Record<AmbientEffectId, (count: number) => Painter> = {
			leaves: makeLeavesPainter,
			fireflies: makeFirefliesPainter,
			bokeh: makeBokehPainter,
			petals: makePetalsPainter,
			wind: makeWindPainter,
			butterflies: makeButterfliesPainter,
			drizzle: makeDrizzlePainter,
			snow: makeSnowPainter,
			stars: makeStarsPainter,
			dandelion: makeDandelionPainter,
			tyndall: makeTyndallPainter,
		};
		for (const id of Object.keys(factories) as AmbientEffectId[]) {
			this.painters.set(id, factories[id](ambientEffectsConfig[id].count));
		}
	}

	init(enabled: Record<AmbientEffectId, boolean>): void {
		// 不读 prefers-reduced-motion：访客在面板里显式打开某个特效就是明确想看动效，
		// 系统「减弱动态」偏好不应把它冻成一帧静态图（批九实测正是这个分支导致全冻结）。
		for (const id of Object.keys(enabled) as AmbientEffectId[]) {
			if (enabled[id]) this.active.add(id);
		}
		if (this.active.size === 0) return;
		this.ensureCanvas();
		for (const id of this.active) {
			this.painters.get(id)?.init(this.cssW, this.cssH);
		}
		this.startLoop();
	}

	setEffect(id: AmbientEffectId, enabled: boolean): void {
		if (enabled === this.active.has(id)) return;
		if (enabled) {
			this.active.add(id);
			this.ensureCanvas();
			this.painters.get(id)?.init(this.cssW, this.cssH);
			this.startLoop();
		} else {
			this.active.delete(id);
			// 全部关闭时必须把画布一并摘除——只停循环会把最后一帧定格在页面上（「关卡不掉」）；
			// 还剩其他特效时不用管，循环下一帧自然清屏重画。
			if (this.active.size === 0) this.destroyCanvas();
		}
	}

	stop(): void {
		this.stopLoop();
		this.active.clear();
		if (this.boundHandleResize) {
			window.removeEventListener("resize", this.boundHandleResize);
			this.boundHandleResize = null;
		}
		if (this.boundHandleVisibility) {
			document.removeEventListener(
				"visibilitychange",
				this.boundHandleVisibility,
			);
			this.boundHandleVisibility = null;
		}
		this.destroyCanvas();
	}

	getIsRunning(): boolean {
		return this.isRunning;
	}

	// -------------------------------------------------------------------------

	private ensureCanvas(): void {
		if (this.canvas) return;
		const canvas = document.createElement("canvas");
		canvas.id = "canvas_ambient";
		canvas.style.cssText =
			"position:fixed;left:0;top:0;pointer-events:none;transform:translateZ(0);z-index:100";
		document.body.appendChild(canvas);
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d");
		this.readViewportSize();

		if (!this.boundHandleResize) {
			this.boundHandleResize = () => this.scheduleResize();
			window.addEventListener("resize", this.boundHandleResize);
		}
		if (!this.boundHandleVisibility) {
			this.boundHandleVisibility = () => {
				if (document.hidden) {
					this.stopLoop();
				} else if (this.active.size > 0) {
					this.startLoop();
				}
			};
			document.addEventListener(
				"visibilitychange",
				this.boundHandleVisibility,
			);
		}
	}

	// 把画布从 DOM 摘掉（监听器保留，内部都有 canvas 判空，重开时 ensureCanvas 会重建）
	private destroyCanvas(): void {
		this.stopLoop();
		if (this.canvas) {
			this.canvas.remove();
			this.canvas = null;
			this.ctx = null;
		}
	}

	private readViewportSize(): void {
		if (!this.canvas) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.cssW = window.innerWidth;
		this.cssH = window.innerHeight;
		this.canvas.width = Math.round(this.cssW * dpr);
		this.canvas.height = Math.round(this.cssH * dpr);
		this.canvas.style.width = `${this.cssW}px`;
		this.canvas.style.height = `${this.cssH}px`;
		this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	private scheduleResize(): void {
		if (this.resizeRafId !== null) {
			cancelAnimationFrame(this.resizeRafId);
		}
		this.resizeRafId = requestAnimationFrame(() => {
			this.resizeRafId = null;
			this.readViewportSize();
			if (this.active.size === 0) return;
			for (const id of this.active) {
				this.painters.get(id)?.init(this.cssW, this.cssH);
			}
		});
	}

	private startLoop(): void {
		if (this.isRunning || this.active.size === 0) return;
		this.isRunning = true;
		this.lastFrameTime = performance.now();
		this.rafId = requestAnimationFrame(this.frame);
	}

	private stopLoop(): void {
		this.isRunning = false;
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	private readonly frame = (now: number): void => {
		if (!this.isRunning || !this.ctx) return;
		// dt 钳制：后台标签页恢复后不跳帧爆炸
		const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
		this.lastFrameTime = now;
		this.elapsed += dt;

		const themeTarget = document.documentElement.classList.contains("dark")
			? 1
			: 0;
		this.themeMix += (themeTarget - this.themeMix) * Math.min(1, dt * 4);

		const ctx = this.ctx;
		const env: Env = {
			w: this.cssW,
			h: this.cssH,
			t: this.elapsed,
			themeMix: this.themeMix,
		};
		ctx.clearRect(0, 0, this.cssW, this.cssH);
		for (const id of this.active) {
			const painter = this.painters.get(id);
			if (!painter) continue;
			painter.update(dt, env);
			painter.draw(ctx, env);
		}
		this.rafId = requestAnimationFrame(this.frame);
	};
}
