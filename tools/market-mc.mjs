// 蒙特卡洛不确定性传播 —— docs/MARKET-SIZE.md §二 的估计量在这里求解。
// 为什么不用区间端点相乘:那等于假设所有输入同时取极值,概率极低,
// 会把区间撑得毫无信息量。这里对每个输入给分布、抽样、取分位数。
// 跨数量级的量(出货量、κ)用对数均匀,比例类用均匀。
// 注意:覆盖率的分母必须用路径 A —— 用路径 B 是循环论证(见文档 §三)。
// Usage: node tools/market-mc.mjs
const N = 300000;
const U = (a,b) => a + Math.random()*(b-a);
const LogU = (a,b) => Math.exp(U(Math.log(a), Math.log(b)));
const q = (a,x) => { const s=[...a].sort((u,v)=>u-v); return s[Math.floor(x*s.length)]; };
const fmt = a => `中位 ${Math.round(q(a,0.5))} · 80% [${Math.round(q(a,0.1))}, ${Math.round(q(a,0.9))}]`;

const A=[], B=[], covA=[], meld=[];
for (let i=0;i<N;i++){
  // 路径A(与我们的装机量完全独立)
  const rhoG = U(32612, 32612*2.2) / (U(200e6,240e6) * U(0.45,0.75));
  const baseCN = LogU(10e4,30e4) * U(5,9) * U(0.6,1.0) * U(1.0,1.4);
  const nA = baseCN * rhoG * LogU(1.5,8);
  // 路径B(依赖 p)
  const ourCN = U(391,477) * U(0.55,0.9);
  const nB = ourCN / U(0.35,0.9);
  A.push(nA); B.push(nB);
  covA.push(ourCN / nA * 100);              // 覆盖率必须用A当分母,否则循环
  meld.push(Math.exp((Math.log(nA)+Math.log(nB))/2));  // 对数尺度几何平均:两个独立测量的融合
}
console.log('路径A 中国盘子:', fmt(A));
console.log('路径B 中国盘子:', fmt(B));
console.log('融合(几何平均):', fmt(meld));
console.log('覆盖率(分母用A,非循环):', fmt(covA).replace(/(\d+)(?= ·|,|\])/g,'$1').replace('中位','中位 ')+' %');
const capped = covA.filter(x=>x<=100).length/N;
console.log('覆盖率 ≤100% 的抽样占比:', (capped*100).toFixed(1)+'%  ← 低于100%说明模型自洽');
