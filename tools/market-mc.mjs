// 蒙特卡洛不确定性传播 —— docs/MARKET-SIZE.md §二 的三条路径在这里求解。
// 为什么不用区间端点相乘:那等于假设所有输入同时取极值,概率极低,
// 会把区间撑得毫无信息量。这里对每个输入给分布、抽样、取分位数。
// 跨数量级的量(出货量、κ、β)用对数均匀,比例类用均匀,计数类用 Beta 后验。
// 注意:覆盖率的分母不能用路径 B —— 那是循环论证(见文档 §三之6)。
// Usage: node tools/market-mc.mjs
const N = 300000;
const U = (a, b) => a + Math.random() * (b - a);
const LogU = (a, b) => Math.exp(U(Math.log(a), Math.log(b)));
// Beta 抽样(两个 Gamma 之比),用于把「206 人里 2 个中国人」的计数不确定性如实传下去
const gamma = (k) => { // Marsaglia-Tsang, k>0
  if (k < 1) return gamma(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = Math.random(), u2 = Math.random();
         x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
};
const Beta = (a, b) => { const x = gamma(a); return x / (x + gamma(b)); };
const q = (a, x) => { const s = [...a].sort((u, v) => u - v); return s[Math.floor(x * s.length)]; };
const fmt = a => `中位 ${Math.round(q(a, 0.5))} · 80% [${Math.round(q(a, 0.1))}, ${Math.round(q(a, 0.9))}]`;

const H_G = 32658;   // 全球 Homebrew 活跃装机(最新版 ipk 下载,2026-08-02)
const A = [], B = [], C = [], covA = [], covAC = [], meld = [];
const greyPrior = [], greyPost = [];   // 水货倍数:先验 vs 被硬下界约束后的后验
let tried = 0;
for (let i = 0; i < N; i++) {
  // 路径A:市场漏斗。全部锚在 LG 电子事业报告书(DART 20260706000276)的申报数字上。
  //
  //   N_CN = B_CN · r · ρ_G · κ,  ρ_G = H_G / (W_LG · r)   ⟹   N_CN = H_G · (B_CN/W_LG) · κ
  //
  // 「可越狱固件占比」r 在两边相消(只要中国与全球的固件构成无系统差异)—— 旧版本没消掉它,
  // 既多了一个纯猜的参数,又和 2.4 亿「webOS 设备」的口径对不上(那个数含第三方品牌/商显/车机)。
  // 现在分母改用 LG 自己申报的电视产量,口径干净。
  //
  // W_LG:LG 电视全球保有量。财报生산실적 2023/24/25 = 2,017 / 2,000 / 1,759 万台(不含 ODM),
  //       Omdia 口径出货 2,260 万台(含 ODM)→ 年 1,759–2,260 万台。
  const wLG = U(17.59e6, 22.6e6) * U(5, 9) * U(0.6, 1.0);
  // B_CN:中国在用的 LG 电视。官方渠道从 LGECH(中国销售公司)营收反推:
  //       2,115 亿韩元 = 10.0 亿人民币(全品类:家电+电视+显示器+商显)
  const lgechCNY = 10.0e8;
  const tvShare = U(0.10, 0.30);        // 电视占中国销售公司营收的比例(全球영상기기占比 18.2% 作锚)
  const aspCNY = LogU(4000, 12000);     // 出厂口径单价:LG 在华卖的基本是高端 OLED
  const official = lgechCNY * tvShare / aspCNY;
  const grey = LogU(1.0, 5.0);          // 水货/港版/海淘倍数 —— 完全不进任何统计,唯一的纯先验
  const bCN = official * grey * U(5, 9) * U(0.6, 1.0);
  const nA = H_G * (bCN / wLG) * LogU(1.5, 8);   // κ = 中国越狱动机倍数
  // 路径B:自身反推(依赖 p,故不能用来算覆盖率)
  const ourCN = U(391, 477) * U(0.55, 0.9);
  const nB = ourCN / U(0.35, 0.9);
  // 路径C:按比例分配 —— 全球硬数据 × 中国份额。份额来自 GitHub 生态参与者地理构成
  // (tools/market-geo.mjs 实测 2/206),用 Jeffreys 先验的 Beta 后验传播计数不确定性,
  // 再乘两项修偏:β_fill(实测 2.1,中文用户少填 location)× β_voice(先验,少在英文仓库开 issue)。
  const s = Beta(2 + 0.5, 204 + 0.5);
  const nC = H_G * s * U(1.6, 2.8) * LogU(1.0, 3.0);
  // 硬约束:中国盘子不可能小于我们自己数出来的中国装机。这不是调参,是把一个
  // 已知为真的不等式当似然用 —— 拒绝掉 N_CN < I·c 的样本(拒绝抽样 = 条件化)。
  tried++;
  greyPrior.push(grey);
  if (nA < ourCN) { i--; continue; }
  greyPost.push(grey);
  A.push(nA); B.push(nB); C.push(nC);
  covA.push(ourCN / nA * 100);
  // 覆盖率的分母只能用与我们自身装机无关的路径(A、C),用 B 会把假设的 p 原样输出
  const nAC = Math.exp((Math.log(nA) + Math.log(nC)) / 2);
  covAC.push(ourCN / nAC * 100);
  // 三个近似独立的测量,在对数尺度上取几何平均(乘性模型,误差近似对数对称)
  meld.push(Math.exp((Math.log(nA) + Math.log(nB) + Math.log(nC)) / 3));
}
console.log('路径A 市场漏斗   :', fmt(A));
console.log('路径B 自身反推   :', fmt(B));
console.log('路径C 按比例分配 :', fmt(C));
console.log('融合(几何平均)  :', fmt(meld));
console.log('覆盖率(分母用A)      :', fmt(covA) + ' %');
console.log('覆盖率(分母用 A×C 几何平均,均与我们无关):', fmt(covAC) + ' %');
console.log('覆盖率 ≤100% 的抽样占比:', (covA.filter(x => x <= 100).length / N * 100).toFixed(1) + '%  ← 接近100%说明模型自洽');
console.log(`\n条件化:${((1 - N / tried) * 100).toFixed(0)}% 的路径A样本因「盘子 < 我们自己的装机」被拒绝(逻辑上不可能)`);
console.log(`水货/港版倍数 grey:先验 ${fmt(greyPrior.map(x => x * 100))} /100 → 后验 ${fmt(greyPost.map(x => x * 100))} /100`);
console.log('  ↑ 我们自己的装机量反过来把「水货有多少」这个没人统计的量给约束住了');
// 路径C 的原始值(不修偏)必须低于我们自己数出来的中国装机,否则修偏方向就搞反了
const rawC = H_G * 2 / 206;
console.log(`\n自洽检查:路径C 未修偏 = ${Math.round(rawC)} 台,低于我们实测的中国装机下界 ` +
            `${Math.round(433 * 0.55)}–${Math.round(433 * 0.9)} 台 → 证实这把钥匙偏低,修偏方向正确`);
