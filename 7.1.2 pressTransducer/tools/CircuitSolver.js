/**
 * 电路求解类 V4.0 - 集成仪表自动更新功能
 */
export class CircuitSolver {
    constructor(sys) {
        this.sys = sys;
        this.deltaTime = 0.0005; // 0.5ms 步长
        this.currentTime = 0;
        this.globalIterCount = 0;
        this.rawDevices = Object.values(sys.comps);
        this.portToCluster = new Map();
        this.nodeVoltages = new Map();
        this.clusters = [];
        this.clusterCount = 0;
        this.gndClusterIndices = new Set();
        this.vPosMap = new Map();
        // 可配置参数：用于诊断和数值稳定性保护
        this.debug = true;
    }
    update(conns) {
        // --- 关键：每次更新前重置所有中间计算状态 ---
        this.portToCluster.clear();
        this.nodeVoltages.clear();
        this.gndClusterIndices.clear();
        this.vPosMap.clear();
        this.clusters = [];

        this.connections = conns.filter(c => c.type === 'wire');

        this._buildTopology();
        this._solve();
        this.currentTime += this.deltaTime;
        this.globalIterCount++;
        this._updateInstruments();
    }
    /**
     * 1. 拓扑构建 (并查集 + 零电阻桥接)
     */
    _buildTopology() {
        const parent = {};
        const find = (i) => (parent[i] === undefined || parent[i] === i) ? i : (parent[i] = find(parent[i]));
        const union = (i, j) => {
            const rI = find(i), rJ = find(j);
            if (rI !== rJ) parent[rI] = rJ;
        };

        // 1. 预先收集所有可能存在的端口 (关键修复)
        const allPorts = new Set();

        // 从导线中获取端口
        this.connections.forEach(c => {
            allPorts.add(c.from);
            allPorts.add(c.to);
            union(c.from, c.to);
        });

        // 从所有设备中获取端口 (确保没连线的端口也能被识别)
        this.rawDevices.forEach(dev => {
            const ps = this._getDevicePorts(dev.id);
            ps.forEach(p => allPorts.add(p));

            // 2. 处理零电阻内部桥接 (保持原有逻辑)
            const id = dev.id;
            if (dev.type === 'switch' && !dev.isOpen) union(`${id}_wire_l`, `${id}_wire_r`);
            if (dev.type === 'relay' && dev.isEnergized) union(`${id}_wire_NO`, `${id}_wire_COM`);
            if (dev.type === 'ampmeter') union(`${id}_wire_p`, `${id}_wire_n`);
            if (dev.special === 'pt100') union(`${id}_wire_r`, `${id}_wire_t`);
            if (dev.type === 'multimeter' && dev.mode === 'MA') union(`${id}_wire_ma`, `${id}_wire_com`);
            if (dev.currentResistance < 0.001) {
                union(`${id}_wire_l`, `${id}_wire_r`);
            }
        });

        // 3. 构建 Cluster 映射
        const clusterIndex = new Map();
        let idx = 0;

        allPorts.forEach(p => {
            const root = find(p);
            if (!clusterIndex.has(root)) {
                clusterIndex.set(root, idx++);
            }
            this.portToCluster.set(p, clusterIndex.get(root));
        });
        this.clusterCount = idx;

        // 4. 生成最终的 clusters 集合
        // 这里的 id 来源于 parent，可能漏掉没有 union 过的孤立节点，所以改用 allPorts 遍历
        const clusterMap = {};
        allPorts.forEach(p => {
            const root = find(p);
            if (!clusterMap[root]) clusterMap[root] = new Set();
            clusterMap[root].add(p);
        });
        this.clusters = Object.values(clusterMap);
    }
    _getDevicePorts(id) {
        const sfx = ['_l', '_m', '_r', '_p', '_n', '_v', '_ma', '_com', '_COM', '_NO'];
        return sfx.map(s => `${id}_wire${s}`).filter(p => this.portToCluster.has(p));
    }
    /**
     * 2. 核心求解 (节点电压法)
     */
    _solve() {
        const currentTime = this.globalIterCount * this.deltaTime;
        // 1.识别专门的 GND 设备
        const gndDevs = this.rawDevices.filter(d => d.type === 'gnd');
        gndDevs.forEach(g => {
            const clusterIdx = this.portToCluster.get(`${g.id}_wire_gnd`);
            if (clusterIdx !== undefined) {
                this.gndClusterIndices.add(clusterIdx);
            }
        });
        //2.处理电源和PID设备、放大器、BJT
        const powerDevs = this.rawDevices.filter(d => d.type === 'source' || d.type === 'ac_source');
        const tcDevs = this.rawDevices.filter(d => d.special === 'tc');
        const pidDevs = this.rawDevices.filter(d => d.type === 'PID');
        const bjtDevs = this.rawDevices.filter(d => d.type === 'bjt'); // 获取所有三极管

        this.rawDevices.forEach(dev => {
            if (dev.type === 'source_3p') {
                // 分别注入 U, V, W 三路电压源
                ['u', 'v', 'w'].forEach(pKey => {
                    const cPhase = this.portToCluster.get(`${dev.id}_wire_${pKey}`);
                    const vNow = dev.getPhaseVoltage(pKey, currentTime);
                    this.vPosMap.set(cPhase, vNow);
                });
            }
        });

        // 3. 初始化所有运放为线性模式 (Linear Mode)
        const opAmps = this.rawDevices.filter(d => d.type === 'amplifier');
        if (!this._opAmpsInitialized) {
            opAmps.forEach(op => op.internalState = 'linear');
            this._opAmpsInitialized = true;
        }

        //4. 建立节点到cluster的映射，方便填充矩阵。
        const oscDevs = this.rawDevices.filter(d => d.type === 'oscilloscope');
        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < this.clusterCount; i++) {
            if (!this.gndClusterIndices.has(i) && !this.vPosMap.has(i)) nodeMap.set(i, mSize++);
        }

        if (mSize === 0) { this._assignKnown(); return; }
        // 5. 统计额外的电压源方程数量 (PID 的 pi1 配电端 和 PWM 输出端)
        let extraEqCount = 0;
        pidDevs.forEach(pid => {
            if (this.portToCluster.has(`${pid.id}_wire_pi1`)) extraEqCount++;
            if (pid.outModes.CH1 === 'PWM' && this.portToCluster.has(`${pid.id}_wire_po1`)) extraEqCount++;
            if (pid.outModes.CH2 === 'PWM' && this.portToCluster.has(`${pid.id}_wire_po2`)) extraEqCount++;
        });
        tcDevs.forEach(tc => {
            if (this.portToCluster.has(`${tc.id}_wire_r`) && this.portToCluster.has(`${tc.id}_wire_l`)) {
                extraEqCount++; // 每个热电偶占用一个电流变量方程
            }
        });
        const totalSize = mSize + extraEqCount + opAmps.length + oscDevs.length;
        let results = new Float64Array(totalSize);
        let maxIterations = 200; // 运放状态切换很快，通常2-3次就收敛


        // --- 核心迭代循环 ---
        for (let iter = 0; iter < maxIterations; iter++) {
            // 每次迭代必须重新初始化 G 和 B，因为运放状态会改变矩阵结构
            const G = Array.from({ length: totalSize }, () => new Float64Array(totalSize));
            const B = new Float64Array(totalSize);
            powerDevs.forEach(p => {
                const pId = `${p.id}_wire_p`, nId = `${p.id}_wire_n`;
                if (this.portToCluster.has(nId)) this.gndClusterIndices.add(this.portToCluster.get(nId));
                if (this.portToCluster.has(pId)) this.vPosMap.set(this.portToCluster.get(pId), p.getValue(currentTime));
            });
            // 1. 填充普通线性电阻
            this.rawDevices.forEach(dev => {
                if (['source', 'transmitter_2wire', 'PID'].includes(dev.type) || dev.currentResistance < 0.001) return;
                const c1 = this.portToCluster.get(`${dev.id}_wire_l`);
                const c2 = this.portToCluster.get(`${dev.id}_wire_r`);
                let devResistance = 1000000000;
                if (dev.currentResistance !== undefined) devResistance = dev.currentResistance;
                if (c1 !== undefined && c2 !== undefined) {
                    this._fillMatrix(G, B, nodeMap, c1, c2, 1 / devResistance);
                }
            });

            // 2. 【核心修复】变送器作为受控电阻注入
            this.rawDevices.filter(d => d.type === 'transmitter_2wire').forEach(dev => {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                if (cP === undefined || cN === undefined) return;

                // 获取当前压差（P减N）
                const lastV = dev._lastVDiff !== undefined ? dev._lastVDiff : 0;

                let dynamicG;

                // --- 关键修复：反向截止逻辑 ---
                if (lastV < 10) {
                    // 电压小于10V（包括负电压），变送器不工作
                    // 表现为极高电阻（1GΩ），电流接近0
                    dynamicG = 1 / 1e9;
                } else {
                    // 正常工作区间
                    const targetI = this._calcTransmitterCurrent(dev);
                    dynamicG = targetI / lastV;
                }

                // 阻尼处理，防止震荡
                if (dev._lastG === undefined) dev._lastG = dynamicG;
                dev._lastG = (dynamicG + dev._lastG) / 2;

                this._fillMatrix(G, B, nodeMap, cP, cN, dev._lastG);
            });

            // 3. 【新增】注入 PID 控制器 
            let currentVSourceIdx = mSize; // 额外方程起始索引       
            pidDevs.forEach(pid => {
                if (!pid.powerOn) {
                    pid.ch1Current = 0;
                    pid.ch2Current = 0;
                    return;
                }
                const p = `${pid.id}_wire_`;

                // 3.1 4-20mA 输入回路: pi1(24V馈电) 和 ni(250Ω内阻)
                const cPi1 = this.portToCluster.get(`${p}pi1`);
                const cNi1 = this.portToCluster.get(`${p}ni1`);
                if (cPi1 !== undefined) {
                    this._addVoltageSourceToMNA(G, B, nodeMap, cPi1, -1, 24.0, currentVSourceIdx++);
                }
                if (cNi1 !== undefined) {
                    this._fillMatrix(G, B, nodeMap, cNi1, -1, 1 / 250); // 接地电阻
                }

                // 3.2 4-20mA 输出 / PWM 输出 (共用端子 po, no)
                const cPo1 = this.portToCluster.get(`${p}po1`);
                const cNo1 = this.portToCluster.get(`${p}no1`);
                if (cPo1 !== undefined && cNo1 !== undefined) {
                    if (pid.outModes.CH1 === '4-20mA') {
                        this._addCurrentSourceToMNA(B, nodeMap, cPo1, cNo1, pid.output1mA / 1000);
                    } else if (pid.outModes.CH1 === 'PWM') {
                        const cPo1 = this.portToCluster.get(`${p}po1`);
                        const cNo1 = this.portToCluster.get(`${p}no1`);

                        if (cPo1 !== undefined && cNo1 !== undefined) {

                            pid.ch1VSourceIdx = currentVSourceIdx;
                            // 获取输入 VCC 的实时电压（或者写死 24）
                            const vcc = this.getVoltageAtPort(`${p}vcc`) || 24;
                            // 瞬时电压：开启时为 VCC，关闭时为 0
                            const vTarget = pid.heatInstantOn ? vcc : 0;

                            this._addVoltageSourceToMNA(G, B, nodeMap, cPo1, cNo1, vTarget, currentVSourceIdx++);
                        }
                    }
                }

                // 3.3 4-20mA 输出 / PWM 输出 (共用端子 po, no)
                const cPo2 = this.portToCluster.get(`${p}po2`);
                const cNo2 = this.portToCluster.get(`${p}no2`);
                if (cPo2 !== undefined && cNo2 !== undefined) {
                    if (pid.outModes.CH2 === '4-20mA') {
                        this._addCurrentSourceToMNA(B, nodeMap, cPo2, cNo2, pid.output2mA / 1000);
                    } else if (pid.outModes.CH2 === 'PWM') {
                        const cPo2 = this.portToCluster.get(`${p}po2`);
                        const cNo2 = this.portToCluster.get(`${p}no2`);
                        if (cPo2 !== undefined && cNo2 !== undefined) {
                            pid.ch2VSourceIdx = currentVSourceIdx;
                            const vcc = this.getVoltageAtPort(`${p}vcc`) || 24;
                            const vTarget = pid.coolInstantOn ? vcc : 0;

                            this._addVoltageSourceToMNA(G, B, nodeMap, cPo2, cNo2, vTarget, currentVSourceIdx++);
                        }
                    }
                }
            });
            // 在循环内部，填充 PID 之后，填充热电偶
            tcDevs.forEach(tc => {
                const cP = this.portToCluster.get(`${tc.id}_wire_r`); // 正极
                const cN = this.portToCluster.get(`${tc.id}_wire_l`); // 负极

                if (cP !== undefined && cN !== undefined) {
                    tc.vSourceIdx = currentVSourceIdx; // 记录电流索引以便后续回传
                    // 核心：Vp - Vn = tc.currentVoltage
                    this._addVoltageSourceToMNA(G, B, nodeMap, cP, cN, tc.currentVoltage, currentVSourceIdx++);
                }
            });
            // 4. 【关键修复】运放注入：必须在每次迭代根据 internalState 决定矩阵系数
            let opVIdx = currentVSourceIdx;
            opAmps.forEach(op => {
                const cP = this.portToCluster.get(`${op.id}_wire_p`);
                const cN = this.portToCluster.get(`${op.id}_wire_n`);
                const cOut = this.portToCluster.get(`${op.id}_wire_OUT`);

                if (cOut !== undefined) {
                    const outM = nodeMap.get(cOut);
                    // KCL项：在输出节点的方程里加上输出电流变量
                    if (outM !== undefined) G[outM][opVIdx] += 1;

                    if (op.internalState === 'linear') {
                        // 1*Vout - A*Vp + A*Vn = 0
                        if (outM !== undefined) G[opVIdx][outM] = 1;
                        const pM = nodeMap.get(cP), nM = nodeMap.get(cN);
                        if (pM !== undefined) G[opVIdx][pM] -= op.gain;
                        else if (this.vPosMap.has(cP)) B[opVIdx] += op.gain * this.vPosMap.get(cP);

                        if (nM !== undefined) G[opVIdx][nM] += op.gain;
                        else if (this.vPosMap.has(cN)) B[opVIdx] -= op.gain * this.vPosMap.get(cN);
                    } else {
                        // 饱和态：1*Vout = Vlimit
                        if (outM !== undefined) G[opVIdx][outM] = 1;
                        B[opVIdx] = (op.internalState === 'pos_sat') ? op.vPosLimit : op.vNegLimit;
                    }
                }
                op.currentIdx = opVIdx;
                opVIdx++;
            });
            // 5. 注入二极管 (Diode) 非线性伴随模型
            this.rawDevices.filter(d => d.type === 'diode').forEach(dev => {
                const cA = this.portToCluster.get(`${dev.id}_wire_l`); // 正极
                const cC = this.portToCluster.get(`${dev.id}_wire_r`); // 负极
                if (cA === undefined || cC === undefined) {
                    dev.physCurrent = 0;
                    return;
                }

                const vA = this.getVoltageFromResults(results, nodeMap, cA);
                const vC = this.getVoltageFromResults(results, nodeMap, cC);
                const vDiff = vA - vC;

                if (vDiff > dev.vForward) {
                    // 导通态：G = 1/rOn, 并联电流源 I = vForward/rOn
                    const gOn = 1 / (dev.rOn || 0.5);
                    const iEq = dev.vForward * gOn;
                    this._fillMatrix(G, B, nodeMap, cA, cC, gOn);
                    this._addCurrentSourceToMNA(B, nodeMap, cA, cC, iEq); // 电流从A流向C
                } else {
                    // 截止态
                    this._fillMatrix(G, B, nodeMap, cA, cC, 1 / (dev.rOff || 1e9));
                }
            });
            // 6. 注入 BJT 
            bjtDevs.forEach(dev => {
                const cB = this.portToCluster.get(`${dev.id}_wire_b`);
                const cC = this.portToCluster.get(`${dev.id}_wire_c`);
                const cE = this.portToCluster.get(`${dev.id}_wire_e`);
                // --- 核心保护：如果基极没接，或者 C/E 全没接，该器件不参与本轮矩阵填充 ---
                if (cB === undefined || (cC === undefined && cE === undefined)) {
                    return;
                }
                // 获取当前迭代的电压
                const vB = this.getVoltageFromResults(results, nodeMap, cB);
                const vC = this.getVoltageFromResults(results, nodeMap, cC);
                const vE = this.getVoltageFromResults(results, nodeMap, cE);
                if (cB !== undefined && cE !== undefined && cC === undefined) {
                    const vDiff = vB - vE;
                    if (vDiff > 0.7) {
                        // 导通态：G = 1/rOn, 并联电流源 I = vForward/rOn
                        const gOn = 2;
                        const iEq = 0.7 * gOn;
                        this._fillMatrix(G, B, nodeMap, cB, cE, gOn);
                        this._addCurrentSourceToMNA(B, nodeMap, cB, cE, iEq); // 电流从A流向C
                    } else {
                        // 截止态
                        this._fillMatrix(G, B, nodeMap, cB, cE, 1 / (1e9));
                    }
                } else if (cB !== undefined && cC !== undefined && cE === undefined) {
                    const vDiff = vB - vC;
                    if (vDiff > 0.7) {
                        // 导通态：G = 1/rOn, 并联电流源 I = vForward/rOn
                        const gOn = 2;
                        const iEq = 0.7 * gOn;
                        this._fillMatrix(G, B, nodeMap, cB, cC, gOn);
                        this._addCurrentSourceToMNA(B, nodeMap, cB, cC, iEq); // 电流从A流向C
                    } else {
                        // 截止态
                        this._fillMatrix(G, B, nodeMap, cB, cC, 1 / (1e9));
                    }
                } else {
                    const model = dev.getCompanionModel(vB, vC, vE) || { matrix: {}, currents: {} };
                    this._fillBJTMatrix(G, B, nodeMap, cC, cB, cE, model);
                }
                // 诊断：计算 vbe
                const vbe = vB - vE;
                const vce = vC - vE;
                if (this.debug) console.debug(`iter=${iter},${dev.id}: vB=${vB}, vC=${vC}, vE=${vE}, vbe=${vbe}, vce=${vce}`);

            });
            // 7. 注入电容/电感 模型
            this.rawDevices.filter(d => d.type === 'capacitor').forEach(dev => {
                const cL = this.portToCluster.get(`${dev.id}_wire_l`);
                const cR = this.portToCluster.get(`${dev.id}_wire_r`);

                // 获取模型：注意这里的 deltaTime 必须与仿真步长一致
                const { gEq, iEq } = dev.getCompanionModel(this.deltaTime);

                // 1. 注入等效电导 (像电阻一样)
                this._fillMatrix(G, B, nodeMap, cL, cR, gEq);

                // 2. 注入伴随电流源 (iEq)
                // 电流方向是从 L 流向 R，所以 L 减去 iEq，R 加上 iEq
                this._addCurrentSourceToMNA(B, nodeMap, cL, cR, iEq);
            });
            this.rawDevices.filter(d => d.type === 'inductor').forEach(dev => {
                const cL = this.portToCluster.get(`${dev.id}_wire_l`);
                const cR = this.portToCluster.get(`${dev.id}_wire_r`);

                // 获取模型：注意这里的 deltaTime 必须与仿真步长一致
                const { gEq, iEq } = dev.getCompanionModel(this.deltaTime);

                // 1. 注入等效电导 (像电阻一样)
                this._fillMatrix(G, B, nodeMap, cL, cR, gEq);

                // 2. 注入伴随电流源 (iEq)
                // 电流方向是从 L 流向 R，所以 L 减去 iEq，R 加上 iEq
                this._addCurrentSourceToMNA(B, nodeMap, cL, cR, iEq);
            });
            // 8. 注入示波器模型
            let oscVIdx = opVIdx;
            oscDevs.forEach(dev => {
                const cIn = this.portToCluster.get(`${dev.id}_wire_l`);
                const cOut = this.portToCluster.get(`${dev.id}_wire_r`);
                // 如果没有接线，则不注入矩阵逻辑
                if (cIn === undefined || cOut === undefined) return;
                // 电流通道在矩阵中表现为 0V 电压源（理想电流表）
                // 这会给矩阵增加一个超节点约束：V_in - V_out = 0
                this._addVoltageSourceToMNA(G, B, nodeMap, cIn, cOut, 0, oscVIdx);

                dev.currentIdx = oscVIdx;
                oscVIdx++;
            });

            // 注入 GMIN 防奇异
            for (let i = 0; i < totalSize; i++) G[i][i] += 1e-12;

            const nextResults = this._gauss(G, B);
            // 检查电压是否收敛 (L2范数或最大误差)
            let maxError = 0;
            for (let i = 0; i < totalSize; i++) {
                maxError = Math.max(maxError, Math.abs(nextResults[i] - results[i]));
            }
            // 核心：带限幅的阻尼更新
            nodeMap.forEach((mIdx, cIdx) => {
                const oldV = this.nodeVoltages.get(cIdx) || 0;
                const rawNewV = nextResults[mIdx];
                // 如果这个节点是受控源或已知源，跳过阻尼，直接赋值
                if (this.vPosMap.has(cIdx)) {
                    this.nodeVoltages.set(cIdx, rawNewV);
                    return;
                }
                // 1. 阻尼 (0.3 表示新解只占 30%)
                const damping = 0.3;
                let nextV = oldV + damping * (rawNewV - oldV);

                // 2. 位移限幅 (MAX_STEP = 0.1V ~ 0.5V)
                // 即使 rawNewV 算出了 -100V，本轮迭代它也只能下降 0.5V
                // 这给模型足够的时间在“平滑带”内找到平衡点
                const MAX_STEP = 0.5;
                let delta = nextV - oldV;
                if (Math.abs(delta) > MAX_STEP) {
                    nextV = oldV + MAX_STEP * Math.sign(delta);
                }

                this.nodeVoltages.set(cIdx, nextV);
                nextResults[mIdx] = nextV;
            });
            // 4. 检查状态切换 (修正版：引入输入压差判据)
            let stateChanged = false;
            opAmps.forEach(op => {
                const cP = this.portToCluster.get(`${op.id}_wire_p`);
                const cN = this.portToCluster.get(`${op.id}_wire_n`);
                const cOut = this.portToCluster.get(`${op.id}_wire_OUT`);

                // 获取当前迭代算出的实时电位
                const vP = this.getVoltageFromResults(results, nodeMap, cP);
                const vN = this.getVoltageFromResults(results, nodeMap, cN);
                const vOutRaw = this.getVoltageFromResults(results, nodeMap, cOut);

                let newState = op.internalState;

                if (op.internalState === 'linear') {
                    // 线性区判断：看输出是否超标
                    if (vOutRaw > op.vPosLimit) newState = 'pos_sat';
                    else if (vOutRaw < op.vNegLimit) newState = 'neg_sat';
                } else {
                    // 饱和区判断：必须看输入压差才能“逃离”饱和
                    // 只有当压差方向改变，且线性计算结果回到安全范围内时才切换回线性
                    const vDiff = vP - vN;
                    if (op.internalState === 'pos_sat' && vDiff < 0) {
                        newState = 'linear';
                    } else if (op.internalState === 'neg_sat' && vDiff > 0) {
                        newState = 'linear';
                    } else if (cP === undefined && cN === undefined || vDiff === 0) {

                        newState = 'linear';
                    }

                }
                if (op.internalState !== newState) {
                    op.internalState = newState;
                    stateChanged = true;
                }
            });
            // 5. 二极管切换
            this.rawDevices.filter(d => d.type === 'diode').forEach(dev => {
                const vA = this.getVoltageFromResults(results, nodeMap, this.portToCluster.get(`${dev.id}_wire_l`));
                const vC = this.getVoltageFromResults(results, nodeMap, this.portToCluster.get(`${dev.id}_wire_r`));
                const isNowOn = (vA - vC) > dev.vForward;
                if (dev._lastOnState !== isNowOn) { dev._lastOnState = isNowOn; stateChanged = true; }
            });


            results = nextResults;

            if (!stateChanged && maxError < 1e-6) break;
        }

        this._assignKnown();

        // --- 1. 电阻/电位器等双端线性元件电流预存 ---
        this.rawDevices.filter(d => (d.type === 'resistor') && d.currentResistance >= 0.001).forEach(dev => {
            const portL = `${dev.id}_wire_l`;
            const portR = `${dev.id}_wire_r`;

            const vL = this.nodeVoltages.get(this.portToCluster.get(portL)) || 0;
            const vR = this.nodeVoltages.get(this.portToCluster.get(portR)) || 0;

            // 规定一个标准方向：从 left 流向 right 为正
            dev.physCurrent = (vL - vR) / dev.currentResistance;
        });
        // 2. 【关键】变送器计算并缓存当前帧的压差，供下一帧使用
        this.rawDevices.filter(d => d.type === 'transmitter_2wire').forEach(dev => {
            const pV = this.getVoltageAtPort(`${dev.id}_wire_p`);
            const nV = this.getVoltageAtPort(`${dev.id}_wire_n`);
            dev._lastVDiff = pV - nV; // 存储压差
        });

        // ---3.PID 回传电流数据 ---
        pidDevs.forEach(pid => {
            if (pid.ch1VSourceIdx !== undefined) pid.ch1Current = results[pid.ch1VSourceIdx];
            if (pid.ch2VSourceIdx !== undefined) pid.ch2Current = results[pid.ch2VSourceIdx];
        });
        // ---4.运放 回传电流数据 ---
        opAmps.forEach(op => {
            if (op.currentIdx !== undefined) op.outCurrent = results[op.currentIdx];
        });
        // 5. _solve() 循环彻底结束，电压已同步到 this.nodeVoltages，存储二极管电流
        this.rawDevices.filter(d => d.type === 'diode').forEach(dev => {
            const cA = this.portToCluster.get(`${dev.id}_wire_l`);
            const cC = this.portToCluster.get(`${dev.id}_wire_r`);
            const vA = this.nodeVoltages.get(cA) || 0;
            const vC = this.nodeVoltages.get(cC) || 0;
            const vDiff = vA - vC;

            // 必须镜像填充矩阵时的逻辑
            const vForward = dev.vForward || 0.68; // 确保默认值一致
            const rOn = dev.rOn || 0.1;
            const gOn = 1 / rOn;

            if (vDiff > vForward) {
                // 导通态：I = (V - V_forward) / rOn
                dev.physCurrent = gOn * (vDiff - vForward);
            } else {
                // 截止态：I = V / rOff
                dev.physCurrent = 0;
            }
        });
        // 6.三极管存储电流
        this.rawDevices.filter(d => d.type === 'bjt').forEach(dev => {
            const cB = this.portToCluster.get(`${dev.id}_wire_b`);
            const cC = this.portToCluster.get(`${dev.id}_wire_c`);
            const cE = this.portToCluster.get(`${dev.id}_wire_e`);
            const vB = this.nodeVoltages.get(cB) || 0;
            const vC = this.nodeVoltages.get(cC) || 0;
            const vE = this.nodeVoltages.get(cE) || 0;

            dev.physCurrents = { b: 0, c: 0, e: 0 };

            // 1. 获取伴随模型参数
            const model = dev.getCompanionModel(vB, vC, vE);
            const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;

            // 2. 判别拓扑模式（镜像注入逻辑）
            if (cB !== undefined && cE !== undefined && (cC === undefined || cC === cB)) {
                // B-E 模式
                const vDiff = (vB - vE) * pol;
                const Ib = (vDiff > 0.7) ? 2 * (vDiff - 0.7) : 0;
                dev.physCurrents.b = Ib * pol;
                dev.physCurrents.e = -dev.physCurrents.b;
            } else if (cB !== undefined && cC !== undefined && (cE === undefined || cE === cB)) {
                // B-C 模式
                const vDiff = (vB - vC) * pol;
                const Ib = (vDiff > 0.7) ? 2 * (vDiff - 0.7) : 0;
                dev.physCurrents.b = Ib * pol;
                dev.physCurrents.c = -dev.physCurrents.b;
            } else {
                // 标准模式：Ib = (gBE * vbeLocal + iBE) * pol
                const vbeLocal = (vB - vE) * pol;
                const vceLocal = (vC - vE) * pol;

                const Ib = pol * (gBE * vbeLocal + iBE);
                // Ic = 放大电流 + 饱和对冲电流
                const Ic = (beta * Ib) + pol * (gCE_sat * (vceLocal - V_SAT));

                dev.physCurrents.b = Ib;
                dev.physCurrents.c = Ic;
                dev.physCurrents.e = -(Ib + Ic);
            }
        });
        // 7. 求解定格阶段重要：在这一步完成后，更新所有含时元件的历史状态
        this.rawDevices.forEach(dev => {
            if (dev.type === 'capacitor') {
                const cL = this.portToCluster.get(`${dev.id}_wire_l`);
                const cR = this.portToCluster.get(`${dev.id}_wire_r`);
                const vL = this.nodeVoltages.get(cL) || 0;
                const vR = this.nodeVoltages.get(cR) || 0;

                // 1. 计算物理电流存入缓存（供仪表盘显示）
                dev.calculatePhysicalCurrent(vL, vR, this.deltaTime);

                // 2. 将当前电压存入 vLast，供下一毫秒使用
                dev.updateState(vL, vR);
            }
        });
        this.rawDevices.forEach(dev => {
            if (dev.type === 'inductor') {
                const cL = this.portToCluster.get(`${dev.id}_wire_l`);
                const cR = this.portToCluster.get(`${dev.id}_wire_r`);
                const vL = this.nodeVoltages.get(cL) || 0;
                const vR = this.nodeVoltages.get(cR) || 0;

                // 1. 计算物理电流存入缓存（供仪表盘显示）
                dev.calculatePhysicalCurrent(vL, vR, this.deltaTime);

                // 2. 将当前电压存入 vLast，供下一毫秒使用
                dev.updateState();
                console.log(dev.type, dev.physCurrent, vL, vR);
            }
        });
        // 8. 更新示波器电压和电流
        this.rawDevices.forEach(dev => {
            if (dev.type === 'oscilloscope') {
                // 1. 获取电压通道压差
                if (dev.currentIdx !== undefined) dev.physCurrent = results[dev.currentIdx];
                // 3. 更新示波器波形
                // dev.updateTrace(vDiff, iVal, this.globalIterCount);
            }
        });

    }
    getVoltageFromResults(results, nodeMap, clusterIdx) {
        if (clusterIdx === undefined) return 0;
        if (this.gndClusterIndices.has(clusterIdx)) return 0;
        if (this.vPosMap.has(clusterIdx)) return this.vPosMap.get(clusterIdx);
        const mIdx = nodeMap.get(clusterIdx);
        return mIdx !== undefined ? results[mIdx] : 0;
    }

    _fillMatrix(G, B, nodeMap, c1, c2, g) {
        if (c1 === undefined || c2 === undefined) return; // 安全检查
        const get = (c) => {
            if (this.gndClusterIndices.has(c)) return { t: 'g' };
            if (this.vPosMap.has(c)) return { t: 'v', v: this.vPosMap.get(c) };
            const idx = nodeMap.get(c);
            if (idx === undefined) return { t: 'none' }; // 关键修复：处理孤立节点
            return { t: 'u', i: idx };
        };
        const n1 = get(c1), n2 = get(c2);
        if (n1.t === 'u') {
            G[n1.i][n1.i] += g;
            if (n2.t === 'u') G[n1.i][n2.i] -= g;
            else if (n2.t === 'v') B[n1.i] += g * n2.v;
        }
        if (n2.t === 'u') {
            G[n2.i][n2.i] += g;
            if (n1.t === 'u') G[n2.i][n1.i] -= g;
            else if (n1.t === 'v') B[n2.i] += g * n1.v;
        }
    }

    _fillBJTMatrix(G, B, nodeMap, cC, cB, cE, model) {
        const idx = { c: nodeMap.get(cC), b: nodeMap.get(cB), e: nodeMap.get(cE) };
        const { gBE, iBE, beta, gCE_sat, pol, V_SAT } = model.internal;
        const addG = (r, c, val) => { if (r !== undefined && c !== undefined) G[r][c] += val; };

        // 1. BE 结注入 (控制端)
        addG(idx.b, idx.b, gBE); addG(idx.b, idx.e, -gBE);
        addG(idx.e, idx.b, -gBE); addG(idx.e, idx.e, gBE);
        if (idx.b !== undefined) B[idx.b] -= pol * iBE;
        if (idx.e !== undefined) B[idx.e] += pol * iBE;

        // 2. 受控源 (放大项)
        // Ic = beta * (gBE * Vbe + iBE)
        const transG = beta * gBE;
        addG(idx.c, idx.b, transG * pol);
        addG(idx.c, idx.e, -transG * pol);
        addG(idx.e, idx.b, -transG * pol);
        addG(idx.e, idx.e, transG * pol);

        const iControl = beta * iBE;
        if (idx.c !== undefined) B[idx.c] -= pol * iControl;
        if (idx.e !== undefined) B[idx.e] += pol * iControl;

        // 3. 饱和/钳位项
        if (gCE_sat > 0) {
            addG(idx.c, idx.c, gCE_sat);
            addG(idx.c, idx.e, -gCE_sat);
            addG(idx.e, idx.c, -gCE_sat);
            addG(idx.e, idx.e, gCE_sat);

            const iSatComp = V_SAT * gCE_sat * pol;
            if (idx.c !== undefined) B[idx.c] += iSatComp;
            if (idx.e !== undefined) B[idx.e] -= iSatComp;
        }
    }
    _assignKnown() {
        this.gndClusterIndices.forEach(idx => this.nodeVoltages.set(idx, 0));
        this.vPosMap.forEach((v, idx) => this.nodeVoltages.set(idx, v));
    }
    _gauss(A, b) {
        const n = b.length;
        for (let i = 0; i < n; i++) {
            let pivot = A[i][i];
            if (Math.abs(pivot) < 1e-18) continue;
            for (let j = i + 1; j < n; j++) {
                const f = A[j][i] / pivot;
                b[j] -= f * b[i];
                for (let k = i; k < n; k++) A[j][k] -= f * A[i][k];
            }
        }
        const x = new Float64Array(n);
        for (let i = n - 1; i >= 0; i--) {
            let s = 0;
            for (let j = i + 1; j < n; j++) s += A[i][j] * x[j];
            x[i] = (b[i] - s) / A[i][i];
        }
        return x;
    }
    /**
     * 在 MNA 矩阵中添加电压源: V(c1) - V(c2) = voltage
     * 如果 c2 为 -1，则表示相对于 GND
     */
    _addVoltageSourceToMNA(G, B, nodeMap, c1, c2, voltage, vIdx) {
        const i = this.gndClusterIndices.has(c1) ? -1 : (this.vPosMap.has(c1) ? -2 : nodeMap.get(c1));
        const j = (c2 === -1 || this.gndClusterIndices.has(c2)) ? -1 : (this.vPosMap.has(c2) ? -2 : nodeMap.get(c2));

        // 填充结果向量
        let adjustedV = voltage;
        if (this.vPosMap.has(c1)) adjustedV -= this.vPosMap.get(c1);
        if (this.vPosMap.has(c2)) adjustedV += this.vPosMap.get(c2);
        B[vIdx] = adjustedV;

        // 填充 KCL 约束
        if (i >= 0) {
            G[vIdx][i] = 1;
            G[i][vIdx] = 1;
        }
        if (j >= 0) {
            G[vIdx][j] = -1;
            G[j][vIdx] = -1;
        }
    }

    /**
     * 在 MNA 矩阵中添加电流源: 从 cPos 流向 cNeg
     */
    _addCurrentSourceToMNA(B, nodeMap, cPos, cNeg, current) {
        const i = nodeMap.get(cPos);
        const j = nodeMap.get(cNeg);
        if (i !== undefined) B[i] += current;
        if (j !== undefined) B[j] -= current;
    }
    /**
    * 3. 更新仪表状态
    */
    _updateInstruments() {
        this.rawDevices.forEach(dev => {
            // 1. 电流表逻辑 (支持 ampmeter 和万用表 MA 档)
            if (dev.type === 'ampmeter' || (dev.type === 'multimeter' && dev.mode === 'MA')) {
                const pId = dev.type === 'ampmeter' ? `${dev.id}_wire_p` : `${dev.id}_wire_ma`;
                const nId = dev.type === 'ampmeter' ? `${dev.id}_wire_n` : `${dev.id}_wire_com`;
                const pIndex = this.portToCluster.get(pId);
                const nIndex = this.portToCluster.get(nId);
                if (pIndex === undefined || nIndex === undefined) {
                    dev.update(0);
                } else {
                    const current = this._calculateBranchCurrent(dev);
                    dev.update(current * 1000); // 调用组件内部的 update 方法刷新 UI
                }
            }

            // 2. 万用表逻辑
            if (dev.type === 'multimeter') {
                const mode = dev.mode || 'OFF';

                // 电压档
                if (mode.startsWith('DCV')) {
                    let diff = 0;
                    if (this.portToCluster.get(`${dev.id}_wire_v`) !== undefined && this.portToCluster.get(`${dev.id}_wire_com`) !== undefined) diff = this.getPD(`${dev.id}_wire_v`, `${dev.id}_wire_com`);
                    dev.update(diff);
                }
                // 电阻档 (利用你写的 _getEquivalentResistance)
                else if (mode.startsWith('RES')) {
                    const comNode = `${dev.id}_wire_com`;
                    const vNode = `${dev.id}_wire_v`;


                    // 寻找节点所属的集群
                    const comCluster = this.clusters.find(c => c.has(comNode));
                    const vCluster = this.clusters.find(c => c.has(vNode));

                    let R = Infinity;
                    if (comCluster && vCluster && Math.abs(this.getPD(vNode, comNode)) < 0.1) {
                        R = this._getEquivalentResistance(comCluster, vCluster, this.clusters);
                    }

                    // 如果是 Infinity，传递一个特定的大值代表 OL (Overload)
                    dev.update(R === Infinity ? 10000000 : R);
                } else if (mode === 'DIODE') { // 1. 忽略大小写
                    const vNode = `${dev.id}_wire_v`;
                    const comNode = `${dev.id}_wire_com`;

                    const vClusterIdx = this.portToCluster.get(vNode);
                    const comClusterIdx = this.portToCluster.get(comNode);

                    // 调试 Log：放在判断外，看是否进入了该分支，以及节点是否成功映射
                    console.log("进入 Diode 模式, 节点索引:", { vClusterIdx, comClusterIdx });

                    let R = Infinity;

                    // 只有表笔都接上了才进行计算
                    if (vClusterIdx !== undefined && comClusterIdx !== undefined) {
                        // 将索引转换为具体的 Cluster (Set)
                        const vCluster = this.clusters[vClusterIdx];
                        const comCluster = this.clusters[comClusterIdx];

                        // 2. 寻找直连二极管
                        const diode = this.rawDevices.find(d => {
                            if (d.type !== 'diode') return false;
                            const dA = this.portToCluster.get(`${d.id}_wire_l`);
                            const dC = this.portToCluster.get(`${d.id}_wire_r`);
                            return (vClusterIdx === dA && comClusterIdx === dC);
                        });

                        if (diode) {
                            console.log("检测到正向二极管");
                            R = 0.6868;
                        } else {
                            // 3. 蜂鸣器/通路检测逻辑
                            // 这里的判断条件 getPD < 0.1 是为了确保电路无源
                            if (Math.abs(this.getPD(vNode, comNode)) < 0.1) {
                                // 注意：_getEquivalentResistance 需要的是 Cluster 对象
                                R = this._getEquivalentResistance(vCluster, comCluster, this.clusters);
                            }
                        }
                    }

                    // 4. 更新显示 (处理 Infinity 为 "O.L" 字符串或特定大值)
                    dev.update(R === Infinity ? 10000000 : R);
                }
                // 其他模式清零
                else if (mode === 'C') {
                    const vNode = `${dev.id}_wire_v`;
                    const comNode = `${dev.id}_wire_com`;

                    const vClusterIdx = this.portToCluster.get(vNode);
                    const comClusterIdx = this.portToCluster.get(comNode);

                    let C = 0;

                    if (vClusterIdx !== undefined && comClusterIdx !== undefined) {
                        // find 应该返回设备对象或 undefined
                        const targetCap = this.rawDevices.find(d => {
                            if (d.type !== 'capacitor') return false;

                            const dL = this.portToCluster.get(`${d.id}_wire_l`);
                            const dR = this.portToCluster.get(`${d.id}_wire_r`);

                            // 判断电容是否跨接在两表笔之间
                            return (vClusterIdx === dL && comClusterIdx === dR) ||
                                (vClusterIdx === dR && comClusterIdx === dL);
                        });

                        console.log("检测到的电容设备:", targetCap);

                        if (targetCap) {
                            // 获取电容值，注意单位换算（如果是 uF 或 nF，建议在这里处理）
                            C = targetCap.capacitance * 1000000;
                        }
                    }

                    // 更新显示
                    dev.update(C);
                }
                else if (mode.startsWith('ACV')) {
                    const vNode = `${dev.id}_wire_v`;
                    const comNode = `${dev.id}_wire_com`;
                    const vDiff = this.getPD(vNode, comNode);

                    // 每 20ms (假设 deltaTime 是 1ms，即 20 步) 重置一次采样
                    // 这样每个周期都会重新寻找真实的峰值
                    if (this.globalIterCount % 20 === 0) {
                        dev._displayRMS = (dev._maxV || 0) / 1.414;
                        dev._maxV = 0; // 清空，准备记录下一个周期的峰值
                    }

                    dev._maxV = Math.max(dev._maxV || 0, Math.abs(vDiff));

                    // 只有在有值时才更新，防止显示抖动
                    if (dev._displayRMS !== undefined) {
                        dev.update(dev._displayRMS);
                    }
                }
                else {
                    dev.update(0);
                }
            }
            if (dev.type === 'transmitter_2wire') {
                const cP = this.portToCluster.get(`${dev.id}_wire_p`);
                const cN = this.portToCluster.get(`${dev.id}_wire_n`);
                dev.update({ powered: dev._lastVDiff > 10 && cP !== undefined && cN !== undefined && dev.isOpened === false, transCurrent: this._calcTransmitterCurrent(dev) * 1000 });
            }

            if (dev.type === 'PID') {
                const inI = Math.abs(this.getVoltageAtPort(`${dev.id}_wire_ni1`) / 250);
                dev.update(inI * 1000);
            }
        });
        // 2. 更新示波器电压和电流
        this.rawDevices.forEach(dev => {
            if (dev.type === 'oscilloscope') {
                // 1. 获取电压通道压差
                const cVH = this.portToCluster.get(`${dev.id}_wire_p`);
                const cVL = this.portToCluster.get(`${dev.id}_wire_n`);
                const vDiff = (this.nodeVoltages.get(cVH) || 0) - (this.nodeVoltages.get(cVL) || 0);

                // 2. 获取电流通道电流
                // 这里的电流直接从 MNA 结果 results 的额外变量列读取（即 0V 电源产生的电流）
                const iVal = dev.physCurrent || 0;
                // 3. 更新示波器波形
                dev.updateTrace(vDiff, iVal, this.globalIterCount);
            }
        });
    }

    //辅助1：用于计算电流表/万用表电流档显示电流
    _calculateBranchCurrent(dev) { // 传入电流表设备对象
        let portP = `${dev.id}_wire_p`;
        let portN = `${dev.id}_wire_n`;
        if (dev.type === 'multimeter') {
            portP = `${dev.id}_wire_ma`;
            portN = `${dev.id}_wire_com`;
        }

        // 搜索时屏蔽掉当前的 dev.id
        const pFuncDevs = this._getConnectedFunctionalDevices(portP, dev.id);
        const nFuncDevs = this._getConnectedFunctionalDevices(portN, dev.id);

        const pHasSource = pFuncDevs.some(d => d.device.type === 'source' || d.extPort === `${d.device.id}_wire_pi1` || d.device.type === 'gnd');
        // const pHasSource = pFuncDevs.some(d => d.device.type === 'source' || d.extPort === `${d.device.id}_wire_pi1` || d.extPort === `${d.device.id}_wire_OUT` || d.device.type === 'gnd');
        // if (this.debug) console.log(pFuncDevs, nFuncDevs, pHasSource);

        // 依然采用你的避开电源逻辑
        if (pHasSource) {
            let iInN = 0;
            nFuncDevs.forEach(item => {
                iInN += this._getPhysicalFlowIntoPort(item.device, item.extPort);
            });
            // 物理流向：如果电流从 N 端流出（iInN 为负），读数为正
            return -iInN;
        } else {
            let iInP = 0;
            pFuncDevs.forEach(item => {
                iInP += this._getPhysicalFlowIntoPort(item.device, item.extPort);
            });
            return iInP;
        }
    }
    /**
     * 辅助2：物理流向判定：计算电流从 extPort “流入” meterPort 的数值
     */
    _getPhysicalFlowIntoPort(dev, extPort) {

        // 情况 1： 针对电阻类
        if (dev.type === 'resistor' || dev.type === 'capacitor' || dev.type === 'inductor') {
            const totalCurrent = dev.physCurrent || 0;
            // 如果查询的是左端口，流入为正 (vL > vR 时 current 为正)
            // 如果查询的是右端口，流入为正 (vR > vL 时 current 为负，所以取反)
            return extPort.endsWith('_l') ? -totalCurrent : totalCurrent;
        }

        // 情况 2：变送器 (2线制)
        if (dev.type === 'transmitter_2wire') {
            const i = (dev._lastVDiff > 10) ? (dev._lastVDiff * (dev._lastG || 0)) : 0;
            // 变送器电流永远从自身的 P 流向 N
            // 如果仪表接在变送器的 N 端，说明电流从变送器流出 -> 进入仪表 (流入)
            if (extPort.endsWith('_n')) return i;
            // 如果仪表接在变送器的 P 端，说明电流进入变送器 -> 离开仪表 (流出)
            if (extPort.endsWith('_p')) return -i;
        }
        // 情况 3. PID 控制器逻辑
        if (dev.type === 'PID') {
            if (extPort.endsWith('_po1') || extPort.endsWith('_no1')) {
                if (dev.outModes.CH1 === '4-20mA') {
                    // 1. 增加开路检测：检查 po1 和 no1 是否在同一个有效回路中
                    const cPo1 = this.portToCluster.get(`${dev.id}_wire_po1`);
                    const cNo1 = this.portToCluster.get(`${dev.id}_wire_no1`);

                    // 利用你已有的 _getEquivalentResistance 方法探测两者之间的电阻
                    const req = this._getEquivalentResistance(
                        this.clusters.find(c => c.has(`${dev.id}_wire_po1`)),
                        this.clusters.find(c => c.has(`${dev.id}_wire_no1`)),
                        this.clusters
                    );

                    // 2. 如果电阻是 Infinity (或远大于正常工业负载，如 > 100kΩ)，说明没连上
                    if (cPo1 === undefined || cNo1 === undefined || req > 100000) return 0;

                    // 3. 只有回路导通，才返回设定电流
                    const i = dev.output1mA / 1000;
                    return extPort.endsWith('_po1') ? i : -i;
                } else if (dev.outModes.CH1 === 'PWM') {
                    //1. 获取两个端口对应的 Cluster
                    const cPo1 = this.portToCluster.get(`${dev.id}_wire_po1`);
                    const cNo1 = this.portToCluster.get(`${dev.id}_wire_no1`);

                    if (cPo1 === undefined || cNo1 === undefined) return 0;



                    // 2. 定义流向：po1 流出为负，no1 流入为正
                    const i = dev.ch1Current || 0;
                    return extPort.endsWith('_po1') ? -i : i;
                }
            }
            if (extPort.endsWith('_po2') || extPort.endsWith('_no2')) {
                if (dev.outModes.CH2 === '4-20mA') {
                    // 1. 增加开路检测：检查 po1 和 no1 是否在同一个有效回路中
                    const cPo2 = this.portToCluster.get(`${dev.id}_wire_po2`);
                    const cNo2 = this.portToCluster.get(`${dev.id}_wire_no2`);

                    // 利用你已有的 _getEquivalentResistance 方法探测两者之间的电阻
                    const req = this._getEquivalentResistance(
                        this.clusters.find(c => c.has(`${dev.id}_wire_po2`)),
                        this.clusters.find(c => c.has(`${dev.id}_wire_no2`)),
                        this.clusters
                    );

                    // 2. 如果电阻是 Infinity (或远大于正常工业负载，如 > 100kΩ)，说明没连上
                    if (cPo2 === undefined || cNo2 === undefined || req > 100000) return 0;

                    // 3. 只有回路导通，才返回设定电流
                    const i = dev.output2mA / 1000;
                    return extPort.endsWith('_po2') ? i : -i;
                } else if (dev.outModes.CH2 === 'PWM') {
                    // 1. 获取两个端口对应的 Cluster
                    const cPo2 = this.portToCluster.get(`${dev.id}_wire_po2`);
                    const cNo2 = this.portToCluster.get(`${dev.id}_wire_no2`);

                    if (cPo2 === undefined || cNo2 === undefined) return 0;

                    const i = dev.ch2Current || 0;
                    return extPort.endsWith('_po2') ? -i : i;
                }
            }
            // PID 输入端 ni
            // if (extPort.endsWith('_ni1')) return (0 - vExt) / 250;
            // --- pi1 馈电端逻辑 ---
            // pi1 是 24V 输出端，电流永远流出 PID (即流向外部)
            if (extPort.endsWith('_pi1') || extPort.endsWith('_ni1')) {
                // 这里是关键：pi1 的电流应该等于 ni1 (输入端) 的电流
                // 因为 pi1 给变送器供电，变送器电流最后回到 ni1
                const vNi = this.getVoltageAtPort(`${dev.id}_wire_ni1`);
                const iLoop = vNi / 250;
                return -iLoop; // 物理流向：从 pi1 流出，所以是负值
            }
        }
        // 情况 4. 运放各端电流        
        if (dev.type === 'amplifier') {
            // 1. 输入端 (P 和 N)：理想运放输入阻抗无穷大，电流为 0
            if (extPort.endsWith('_p') || extPort.endsWith('_n')) {
                return 0;
            }

            // 2. 输出端 (OUT)：直接返回矩阵解出的电流变量
            if (extPort.endsWith('_OUT')) {
                // 注意：在 MNA 中，解出的电压源电流方向通常是“流出”为正或“流入”为正，
                // 取决于你填充矩阵时的符号。
                // 根据你 _solve 里的逻辑：G[outM][opVIdx] += 1
                // 这通常意味着解出的 results[op.currentIdx] 是从 OUT 节点流向外部的电流。
                return -dev.outCurrent || 0;
            }
        }
        // --- 情况5：二极管部分 ---
        if (dev.type === 'diode') {
            const cA = this.portToCluster.get(`${dev.id}_wire_l`); // 正极
            const cC = this.portToCluster.get(`${dev.id}_wire_r`); // 负极
            if (cA === undefined || cC === undefined) {
                dev.physCurrent = 0;
                return 0;
            }
            const current = dev.physCurrent || 0;
            // 这里的极性需根据你的仪表盘习惯定义：通常从 Anode 流入为正
            return extPort.endsWith('_l') ? -current : current;
        }
        // --- 情况6：三级管部分 ---
        if (dev.type === 'bjt') {
            // 如果没有计算过电流，返回 0
            if (!dev.physCurrents) return 0;

            if (extPort.endsWith('_b')) return -dev.physCurrents.b;
            if (extPort.endsWith('_c')) return -dev.physCurrents.c;
            if (extPort.endsWith('_e')) return -dev.physCurrents.e;
        }

        return 0;
    }

    /**
     * 辅助3：寻找与电流表端口“物理意义上”直接挂载的所有功能设备
     */
    _getConnectedFunctionalDevices(meterPort, meterId) { // 传入当前电流表 ID
        const found = [];
        const visitedPorts = new Set();
        const queue = [meterPort];
        const processedZeroResDevs = new Set();

        while (queue.length > 0) {
            const curr = queue.shift();
            if (visitedPorts.has(curr)) continue;
            visitedPorts.add(curr);

            // 1. 导线链条追踪
            this.connections.forEach(conn => {
                let nextPort = null;
                if (conn.from === curr) nextPort = conn.to;
                else if (conn.to === curr) nextPort = conn.from;
                if (nextPort) queue.push(nextPort);
            });

            // 2. 穿透零电阻设备
            const devId = curr.split('_wire_')[0];
            const dev = this.rawDevices.find(d => d.id === devId);

            if (dev) {
                // --- 核心修复：禁止穿透正在进行测量的这个表 ---
                if (dev.id === meterId) {
                    // 如果搜到了自己的端口，记录下来但不允许从这个端口爬到另一个端口
                    continue;
                }

                // 识别功能性设备（终点）
                if (dev.currentResistance >= 0.001 || dev.type === 'source' || dev.type === 'transmitter_2wire' || dev.type === 'PID' || dev.type === 'diode' || dev.type === 'bjt' || dev.type === 'amplifier') {
                    found.push({ device: dev, extPort: curr });
                }

                // 穿透其它零电阻设备（如开关、其它电流表、继电器）
                if (!processedZeroResDevs.has(dev.id)) {
                    if (this._isZeroResistanceDevice(dev)) {
                        processedZeroResDevs.add(dev.id);
                        this._getDevicePorts(dev.id).forEach(p => queue.push(p));
                    }
                }
            }
        }
        return found;
    }

    /**
     * 辅助：判定是否为“零电阻”直通设备
     */
    _isZeroResistanceDevice(dev) {
        // 电流表两端
        if (dev.type === 'ampmeter' || (dev.type === 'multimeter' && dev.mode === 'MA')) return true;
        // 闭合的开关
        if (dev.type === 'switch' && !dev.isOpen) return true;
        // 闭合的继电器触点 (根据你的业务逻辑添加)
        if (dev.type === 'relay' && dev.isEnergized) return true;
        // 其他极小电阻
        if (dev.currentResistance < 0.001 && dev.type !== 'source') return true;

        return false;
    }

    // --- 工具方法 ---
    //辅助4：用于变送器电流测量，压控电流源也可放在这一部分。
    _calcTransmitterCurrent(dev) {

        if (dev.isOpened === true) return 0;
        if (dev.special === 'temp') {
            const cL = this.portToCluster.get(`${dev.id}_wire_l`);
            const cM = this.portToCluster.get(`${dev.id}_wire_m`);
            const cR = this.portToCluster.get(`${dev.id}_wire_r`);

            // 1. 硬件故障判断：优先级最高，直接返回固定特征电流
            if (cL === undefined || cM === undefined || cR === undefined) return 0.0216; // 未接线
            if (cM !== cR) return 0.0216; // PT100 感温元件开路
            if (cM === cL && cM === cR) return 0.0036; // PT100 短路

            // 2. 正常寻找匹配的 PT100 电阻
            let R = 10000000;
            this.rawDevices.filter(d => d.type === 'resistor').forEach(r => {
                const rL = this.portToCluster.get(`${r.id}_wire_l`);
                const rR = this.portToCluster.get(`${r.id}_wire_r`);
                if ((rL === cL && rR === cR) || (rL === cR && rR === cL)) {
                    R = r.currentResistance;
                }
            });

            // 3. 计算电流 (4-20mA 对应 0-100度)
            // 假设 R=100Ω 是 0度 (4mA)，R=138.51Ω 是 100度 (20mA)
            const iRaw = 16 * (R - 100) / 38.51 + 4;
            const iFix = (iRaw * dev.spanAdj + dev.zeroAdj) / 1000;

            // 4. 饱和限制：即使温度超标，电流也只在 3.8mA - 20.5mA 之间波动
            // 只有发生上面第1步的“断路”才会跳到 21.6mA
            return Math.max(0.0038, Math.min(0.0205, iFix));
        } else if (dev.special === 'press') {
            const percent = Math.max(0, Math.min(1, (dev.press - dev.min) / (dev.max - dev.min)));
            const iRaw = 16 * percent + 4;
            const iFix = (iRaw * dev.spanAdj + dev.zeroAdj) / 1000;
            return Math.max(0.0038, Math.min(0.0205, iFix));
        }

    }
    //辅助5：两个用于电压测量。
    getVoltageAtPort(pId) {
        const cIdx = this.portToCluster.get(pId);
        return cIdx !== undefined ? (this.nodeVoltages.get(cIdx) || 0) : 0;
    }
    getPD(pA, pB) {
        const aIdx = this.portToCluster.get(pA);
        const bIdx = this.portToCluster.get(pB);
        if (aIdx === undefined || bIdx === undefined) return 0;
        return this.getVoltageAtPort(pA) - this.getVoltageAtPort(pB);
    }

    isPortConnected(pA, pB) {
        const idxA = this.portToCluster.get(pA);
        const idxB = this.portToCluster.get(pB);
        return (idxA !== undefined && idxB !== undefined && idxA === idxB);
    }

    //辅助6：用于电阻档测量。
    /* 改进方案：利用矩阵“试探法” (The Matrix Injection Method)不要手动去数路径，而是模拟万用表测量电阻的过程：在 A 节点注入 $1\text{A}$ 电流。将 B 节点设定为 GND ($0\text{V}$)。求解此时 A 节点的电压 $V_A$。根据欧姆定律 $R = V / I$，因为 $I=1$，所以 $R = V_A$。这种方法无论中间串了 3 个、10 个还是并联了复杂的电桥，都能算得准。 */
    _getEquivalentResistance(startCluster, endCluster, allClusters) {
        const startIdx = allClusters.indexOf(startCluster);
        const endIdx = allClusters.indexOf(endCluster);

        if (startIdx === -1 || endIdx === -1) return Infinity;
        if (startIdx === endIdx) return 0;

        // 1. 准备一个临时的节点地图（排除 B 节点，因为 B 是我们要设定的参考地）
        const nodeMap = new Map();
        let mSize = 0;
        for (let i = 0; i < allClusters.length; i++) {
            if (i !== endIdx) {
                nodeMap.set(i, mSize++);
            }
        }

        const G = Array.from({ length: mSize }, () => new Float64Array(mSize));
        const B = new Float64Array(mSize);

        // 2. 填充所有电阻电导
        for (let i = 0; i < allClusters.length; i++) {
            for (let j = i + 1; j < allClusters.length; j++) {
                const res = this._getParallelResistanceBetweenClusters(allClusters[i], allClusters[j]);
                if (res.count > 0 && res.totalR !== Infinity) {
                    const g = 1 / res.totalR;
                    // 这里的逻辑类似 _fillMatrix，但针对 endIdx 为地的情况
                    const n1 = nodeMap.has(i) ? { t: 'u', i: nodeMap.get(i) } : { t: 'g' };
                    const n2 = nodeMap.has(j) ? { t: 'u', i: nodeMap.get(j) } : { t: 'g' };

                    if (n1.t === 'u') {
                        G[n1.i][n1.i] += g;
                        if (n2.t === 'u') G[n1.i][n2.i] -= g;
                    }
                    if (n2.t === 'u') {
                        G[n2.i][n2.i] += g;
                        if (n1.t === 'u') G[n2.i][n1.i] -= g;
                    }
                }
            }
        }

        // 3. 在 A 节点注入 1A 电流
        const aNodeIdx = nodeMap.get(startIdx);
        if (aNodeIdx === undefined) return Infinity; // A 到 B 完全不通
        B[aNodeIdx] = 1.0;

        // 4. 注入 GMIN 保证非奇异矩阵（防止悬空）
        for (let i = 0; i < mSize; i++) G[i][i] += 1e-15;

        // 5. 求解电压
        try {
            const results = this._gauss(G, B);
            const vA = results[aNodeIdx];

            // 如果算出来电压太大，说明电阻极大或断路
            return (vA > 1e9) ? Infinity : vA;
        } catch (e) {
            return Infinity;
        }
    }
    /**
    * 辅助计算两个等电位集群之间的总并联电阻
    * @param {Set} clusterA 节点集合 A
    * @param {Set} clusterB 节点集合 B
    * @returns {Object} { totalR: 数值, count: 电阻个数 }
    */
    _getParallelResistanceBetweenClusters(clusterA, clusterB) {
        let inverseRSum = 0;
        let resistorCount = 0;
        let hasZeroResistor = false;

        if (clusterA === clusterB) {
            return { totalR: 0, count: 0 };
        }
        this.rawDevices.forEach(dev => {
            // --- 逻辑 A：处理普通二端电阻 ---
            if (dev.type === 'resistor') {
                const p0InA = clusterA.has(`${dev.id}_wire_l`);

                let p1InB = clusterB.has(`${dev.id}_wire_r`);
                if (dev.special === 'pt100') p1InB = clusterB.has(`${dev.id}_wire_r`) || clusterB.has(`${dev.id}_wire_t`);
                const p0InB = clusterB.has(`${dev.id}_wire_l`);
                let p1InA = clusterA.has(`${dev.id}_wire_r`);
                if (dev.special === 'pt100') p1InA = clusterA.has(`${dev.id}_wire_r`) || clusterA.has(`${dev.id}_wire_t`);

                if ((p0InA && p1InB) || (p0InB && p1InA)) {
                    let r = dev.currentResistance;
                    if (r === undefined) r = 1e9;
                    if (r < 0.001) hasZeroResistor = true;
                    else inverseRSum += (1 / r);
                    resistorCount++;
                }
            }
        });
        // 逻辑处理
        if (hasZeroResistor) return { totalR: 0, count: resistorCount }; // 只要有一个0电阻并联，总电阻就是0
        if (resistorCount === 0) return { totalR: Infinity, count: 0 }; // 无连接，开路

        return {
            totalR: 1 / inverseRSum,
            count: resistorCount
        };
    }

}