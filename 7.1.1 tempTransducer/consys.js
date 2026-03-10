import { Workflow } from './tools/Workflow.js';
import { CircuitSolver } from './tools/CircuitSolver.js';
import { PneumaticSolver } from './tools/PneumaticSolver.js';

import { Multimeter } from './components/Multimeter.js';
import { RealPT100 } from './components/RealPT100.js';
import { RealTC } from './components/RealTC.js';
import { WaterBath } from './components/WaterBath.js';







/**
 * ControlSystem - 控制系统仿真引擎
 * 负责组件管理、物理计算、自动/手动连线逻辑及渲染更新
 */
export class ControlSystem {
    constructor() {
        // 1. 画布基础设置
        this.container = document.getElementById('container');
        this.stage = new Konva.Stage({ container: 'container', width: window.innerWidth, height: window.innerHeight });
        this.layer = new Konva.Layer();
        this.lineLayer = new Konva.Layer();
        this.stage.add(this.layer, this.lineLayer);

        // 2. 组件和连线资源池
        this.comps = {};        // 组件实例集合
        this.conns = [];        // 所有连接统一存储为 {from, to, type}
        this.pipeNodes = [];    // 画布上的管路形状节点
        this.wireNodes = [];    // 画布上的电路形状节点

        // 3. 连线交互状态
        this.linkingState = null; // 当前正在连线的起点信息
        this.tempLine = null;     // 鼠标跟随虚线

        //4. 流程控制和电路求解
        this.stepsArray = [];  //存储所有流程的数组
        this.workflowComp = null;  //流程控制实例组件
        this.solver = null;  //电路求解器实例组件

        //5.基本初始化、撤销恢复初始化、交互初始化、流程控制初始化。
        this.init();
        this.initHistory();
        this.initStageEvents();
        this.initSteps();
    }

    // ==========================================
    // 第零部分：初始化与核心配置
    // ==========================================

    /**
     * 1. 系统初始化：创建组件并启动仿真循环
     */
    init() {
        // 1. 实例化组件，传入 this 以便组件能够调用 handlePortClick 和 redrawAll
        const componentConfigs = [

            { Class: Multimeter, id: 'multimeter', x: 650, y: 0 },
            { Class: WaterBath, id: 'temptest', x: 120, y: 660 },
            { Class: RealPT100, id: 'pt', x: 220, y: 60 },
            { Class: RealTC, id: 'tc', x: 220, y: 260 },
        ];

        componentConfigs.forEach(cfg => {
            this.comps[cfg.id] = new cfg.Class(cfg, this);
            this.layer.add(this.comps[cfg.id].group);
        });
        this.layer.draw();

        // 2. 实例化流程工具、电路求解工具
        this.workflowComp = new Workflow(this);
        this.voltageSolver = new CircuitSolver(this);
        this.pressSolver = new PneumaticSolver(this);

        // 3. 启动物理计算和动画循环
        this.anim = new Konva.Animation((frame) => this.updateSimulation(frame), this.layer);
        this.anim.start();
    }

    // 2. 历史状态初始化、声明onChange函数（处理两个按钮的状态）
    initHistory() {
        // history 管理：仅记录用户点击产生的连接/删除动作
        this.history = new HistoryManager();
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        this.history.onChange = () => {
            btnUndo.disabled = !(this.history.undos && this.history.undos.length > 0);
            btnRedo.disabled = !(this.history.redos && this.history.redos.length > 0);
        };
        this.history.onChange();
    }

    // 3. 连线交互的初始化、定义鼠标移动处理函数（画出虚线）
    initStageEvents() {
        // 鼠标移动时实时更新虚线终点坐标
        this.stage.on('mousemove', () => {
            if (!this.linkingState || !this.tempLine) return;
            const pos = this.stage.getPointerPosition();
            let startPos;
            if (this.linkingState.comp && this.linkingState.comp.getAbsPortPos) {
                startPos = this.linkingState.comp.getAbsPortPos(this.linkingState.portId);
            } else {
                const did = this.linkingState.portId.split('_')[0];
                startPos = this.comps[did]?.getAbsPortPos(this.linkingState.portId);
            }
            if (!startPos) return;
            this.tempLine.points([startPos.x, startPos.y, pos.x, pos.y]);
            this.tempLine.moveToBottom();
            this.layer.batchDraw();
        });
        // 右键或 ESC 取消当前连线操作
        window.addEventListener('contextmenu', (e) => { e.preventDefault(); this.resetLinking(); });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.resetLinking(); });
    }

    // 4. 流程初始化函数
    initSteps() {
        const conns = [
            // --- 电路部分 (Wire) ---
            // 万用表 (multimeter) 红表笔 -> PT100电阻左端。
            { from: 'multimeter_wire_v', to: 'pt_wire_l', type: 'wire' },
            // 万用表 (multimeter) 黑表笔 ->PT100电阻右端。
            { from: 'multimeter_wire_com', to: 'pt_wire_r', type: 'wire' },
            // 万用表 (multimeter) 黑表笔 ->PT100电阻终端。
            { from: 'multimeter_wire_v', to: 'pt_wire_t', type: 'wire' },

            // 万用表 (multimeter) 红表笔 -> 热电偶左端。
            { from: 'multimeter_wire_v', to: 'tc_wire_r', type: 'wire' },
            // 万用表 (multimeter) 黑表笔 ->热电偶右端。
            { from: 'multimeter_wire_com', to: 'tc_wire_l', type: 'wire' },

        ];
        this.stepsArray[0] = [
            // --- 第一部分：万用表初始化 ---
            {
                msg: "1：准备检测：将万用表旋钮拨至电阻档 (200Ω 档位)。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.multimeter.mode = 'RES200'; // 假设万用表有此方法
                    this.comps.multimeter._updateAngleByMode();
                },
                check: () => this.comps.multimeter.mode === 'RES200'
            },

            // --- 第二部分：PT100 线路检测 ---
            {
                msg: "2：测量3线制特征：连接万用表至 PT100 的两个同颜色端，验证电阻很小。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await this.addConnectionAnimated(conns[1]); // COM -> pt_wire_r
                    await this.addConnectionAnimated(conns[2]); // V -> pt_wire_t (注意：根据逻辑此处应为V/COM间电阻)
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[1]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[2]));
                    // 此时读数应接近 0
                    return c1 && c2 && this.comps.multimeter.value < 0.5;
                }
            },
            {
                msg: "3：测量PT100传感器不同颜色的两端，检测常温阻值 (约107.7Ω)。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    // 移除旧连线并添加新连线
                    this.removeConn(conns[2]);
                    await this.addConnectionAnimated(conns[0]); // V -> pt_wire_l
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => {
                    const hasRightConn = sys.conns.some(c => sys._connEqual(c, conns[1]));
                    const hasLeftConn = sys.conns.some(c => sys._connEqual(c, conns[0]));
                    return hasLeftConn && hasRightConn && Math.abs(this.comps.multimeter.value - 107.7) < 1;
                }
            },

            // --- 第三部分：模拟故障演练 ---
            {
                msg: "4：设置 PT100 开路故障，观察万用表显示溢出 (O.L)。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.pt.isOpen = true; // 设置开路故障
                    this.comps.pt.update(20);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => this.comps.multimeter.value > 1e6
            },
            {
                msg: "5：修复开路故障，确认万用表读数恢复正常。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.pt.isOpen = false; // 修复开路故障
                    this.comps.pt.update(20);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => {
                    const c1 = Math.abs(this.comps.multimeter.value - 107.7) < 1;
                    const c2 = this.comps.pt.isOpen === false;
                    return c1 && c2;
                }

            },
            {
                msg: "6：设置 PT100 短路故障，观察万用表读数归零。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.pt.isShort = true; // 设置短路故障
                    this.comps.pt.update(20);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => this.comps.multimeter.value < 0.2
            },
            {
                msg: "7：修复短路故障，确认读数恢复为当前环境阻值。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.pt.isShort = false; // 修复开路故障
                    this.comps.pt.update(20);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => {
                    const c1 = Math.abs(this.comps.multimeter.value - 107.7) < 1;
                    const c2 = this.comps.pt.isShort === false;
                    return c1 && c2;
                }
            },

            // --- 第四部分：动态实验 ---
            {
                msg: "8：操作：将 PT100 旋转 90 度并插入恒温水槽中。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    // 旋转
                    this.comps.pt.rotate(90);

                    // 计算插入水槽的中心位置
                    const waterNode = this.comps.temptest.waterRect;
                    const waterRect = waterNode.getClientRect();
                    const probeRect = this.comps.pt.probe.getClientRect();
                    const ptGroup = this.comps.pt.group; // 假设这是整个组件的 Konva Group

                    // 修正后的位移算法：当前位置 + (水槽中心坐标 - 探头中心坐标)
                    const dx = (waterRect.x + waterRect.width / 2) - (probeRect.x + probeRect.width / 2);
                    const dy = (waterRect.y + waterRect.height / 2) - (probeRect.y + probeRect.height / 2);

                    ptGroup.x(ptGroup.x() + dx);
                    ptGroup.y(ptGroup.y() + dy);

                    // 强制重绘
                    this.redrawAll();
                },
                check: () => {
                    const probeRect = this.comps.pt.probe.getClientRect();
                    const waterRect = this.comps.temptest.waterRect.getClientRect();

                    // AABB 碰撞检测逻辑修复
                    const isIntersecting = !(
                        probeRect.x > waterRect.x + waterRect.width ||
                        probeRect.x + probeRect.width < waterRect.x ||
                        probeRect.y > waterRect.y + waterRect.height ||
                        probeRect.y + probeRect.height < waterRect.y
                    );
                    return isIntersecting;
                }
            },
            {
                msg: "9：开启水槽加热至 50℃，观察随温度上升的阻值变化 (约 119.4Ω)。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.temptest.targetTemp = 50;
                    this.comps.temptest.toggle();
                    await new Promise(resolve => setTimeout(resolve, 15000));
                    // 提示：此处在实际模拟中可能需要等待水温升高的逻辑过程
                },
                check: () => {
                    const currentTemp = this.comps.temptest.currentTemp;
                    return Math.abs(currentTemp - 50) < 2 && Math.abs(this.comps.multimeter.value - 119.4) < 1;
                }
            }
        ];
        this.stepsArray[1] = [
            // --- 第一部分：热电偶通断检测 ---
            {
                msg: "1：准备检测：将万用表旋钮拨至二极管/蜂鸣器档，用于测试热电偶通断。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.multimeter.mode = 'DIODE';
                    this.comps.multimeter._updateAngleByMode();
                },
                check: () => this.comps.multimeter.mode === 'DIODE'
            },
            {
                msg: "2：连接万用表至热电偶左右两端，测量内部阻值（应小于 5Ω）。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    // 连接：红表笔 -> tc_wire_l, 黑表笔 -> tc_wire_r
                    await this.addConnectionAnimated(conns[3]);
                    await this.addConnectionAnimated(conns[4]);
                },
                check: () => {
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[3]));
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[4]));
                    // 热电偶导通电阻极小
                    return c1 && c2 && this.comps.multimeter.value < 5;
                }
            },

            // --- 第二部分：静态电压检测 ---
            {
                msg: "3：切换档位：将万用表拨至直流毫伏档 (DCmV)，此时常温下电压应为 0mV。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.multimeter.mode = 'DCVmv';
                    this.comps.multimeter._updateAngleByMode();
                },
                check: () => this.comps.multimeter.mode === 'DCVmv' && Math.abs(this.comps.multimeter.value) < 0.1
            },

            // --- 第三部分：热电效应动态实验 ---
            {
                msg: "4：操作：将热电偶旋转 90 度并插入恒温水槽中。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    // 旋转与位移逻辑 (复用之前修复的位移算法)
                    this.comps.tc.rotate(90);

                    const waterNode = this.comps.temptest.waterRect;
                    const waterRect = waterNode.getClientRect();
                    const probeRect = this.comps.tc.probe.getClientRect();
                    const tcGroup = this.comps.tc.group;

                    const dx = (waterRect.x + waterRect.width / 2) - (probeRect.x + probeRect.width / 2);
                    const dy = (waterRect.y + waterRect.height / 2) - (probeRect.y + probeRect.height / 2);

                    tcGroup.x(tcGroup.x() + dx);
                    tcGroup.y(tcGroup.y() + dy);

                    this.redrawAll();
                },
                check: () => {
                    const probeRect = this.comps.tc.probe.getClientRect();
                    const waterRect = this.comps.temptest.waterRect.getClientRect();
                    const isIntersecting = !(
                        probeRect.x > waterRect.x + waterRect.width ||
                        probeRect.x + probeRect.width < waterRect.x ||
                        probeRect.y > waterRect.y + waterRect.height ||
                        probeRect.y + probeRect.height < waterRect.y
                    );
                    return isIntersecting;
                }
            },
            {
                msg: "5：水槽加热至 50℃，观察热电偶产生的热电势（约 1.2mV）。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.temptest.targetTemp = 50;
                    // 确保水槽开启加热
                    if (!this.comps.temptest.isHeating) this.comps.temptest.toggle();

                    // 等待温度升高及读数稳定
                    await new Promise(resolve => setTimeout(resolve, 25000));
                },
                check: () => {
                    const currentTemp = this.comps.temptest.currentTemp;
                    console.log(currentTemp,this.comps.multimeter.value);
                    return Math.abs(currentTemp - 50) < 2 && Math.abs(this.comps.multimeter.value*1000 - 1.2) < 0.3;
                }
            },
            {
                msg: "6：继续加热至 70℃，观察电压随温度升高而增大（约 2.0mV）。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.temptest.targetTemp = 70;
                    await new Promise(resolve => setTimeout(resolve, 15000));
                },
                check: () => {
                    const currentTemp = this.comps.temptest.currentTemp;
                    console.log(currentTemp,this.comps.multimeter.value);
                    return Math.abs(currentTemp - 70) < 2 && Math.abs(this.comps.multimeter.value*1000 - 2.0) < 0.3;
                }
            }
        ];
    }

    // ==========================================
    // 第一部分：处理流程化任务
    // ==========================================
    // 1. 项目选择框调用的函数，用于切换 任务流程。
    switchWorkflow(taskValue) {
        if (!taskValue) {
            console.log("未选择任何任务，清空流程数据");
            this.workflowComp._workflow = [];
            this.workflowComp._workflowIdx = 0;

            // 如果面板已打开，刷新一下列表显示为空
            if (this.workflowComp._workflowPanelEl) {
                this.workflowComp.closeWorkflowPanel();
            }
            return;
        }

        console.log("切换至任务:", taskValue);

        // 根据具体任务 ID 加载对应的步骤数据
        // 你可以把这些数据存在一个对象里，例如 this.allTasksData
        this.workflowComp._workflow = this.stepsArray[taskValue];

        // 切换任务后，重置进度索引
        this.workflowComp._workflowIdx = 0;

        // 切换任务后，需要重新点击开始
        if (this.workflowComp._workflowPanelEl) {
            this.workflowComp.closeWorkflowPanel();
        }
    }

    // 2. 根据用户选择的方式，单步、完整、评估、演练调用流程工具的对应函数。
    openWorkflowPanel(mode) {
        if (mode === 'step') {
            this.workflowComp.stepByStep();
        }
        else {
            this.workflowComp.openWorkflowPanel(mode);
        }
    }
    /**
     * 3. 一键自动连线：将预设的逻辑关系注入连接池
     */
    applyAllPresets() {
        // 1. 定义预设连接关系
        this.conns = [
        ];
        console.log("气路与测量系统预设连接已完成。", this.conns);
        this.redrawAll();

    }

    // 4. 启动系统，控制开关、截止阀之类组件控制系统运行
    applyStartSystem() {


    }

    // 5. 故障设置最后调用的实际函数，与具体系统有关，用户部分一致。

    setFault(n) {
        // 假设这些组件实例存储在 this.comps 中
        const pt = this.comps['pt']; // 变送器

        switch (n) {

            case 1:
                // n=1: 设置PT100开路
                if (pt) {
                    pt.isOpen = true;
                    // console.log("故障：变送器开路（断路）");
                }
                break;
            case 2:
                // n=1: 设置PT100短路
                if (pt) {
                    pt.isShort = true;
                    // console.log("故障：变送器开路（断路）");
                }
                break;
            default:
                console.log("未知故障代码");
                break;
        }

    }


    // ==========================================
    // 第二部分：交互管理（手动连线控制）
    // ==========================================


    /**
     * 1. 处理端口点击事件：实现“起点-预览-终点”连线逻辑
     */
    handlePortClick(comp, portId, type) {
        if (!this.linkingState) {
            // 设定起点
            this.linkingState = { comp, portId, type };
            this.tempLine = new Konva.Line({
                stroke: type === 'wire' ? '#eb0d0d' : '#463aed',
                strokeWidth: type === 'wire' ? 2 : 12,
                opacity: 0.6, dash: [10, 5]
            });
            this.layer.add(this.tempLine);
        } else {
            // 设定终点
            if (this.linkingState.type === type) {
                const aPort = this.linkingState.portId;
                const bPort = portId;
                if (aPort === bPort) { this.resetLinking(); return; }

                const newConn = { from: aPort, to: bPort, type };


                // 1. 检查是否已经存在该连接（无论正反向），在统一的 this.conns 中查找
                const exists = this.conns.some(c => this._connEqual(c, newConn));
                if (exists) {
                    this.resetLinking();
                    return;
                }

                // 2. 修正后的管路冲突检查
                if (type === 'pipe') {
                    // 只有当新连接的端点 被“除了对方以外”的其他连接占用时，才算冲突
                    // 在船舶管路仿真中，通常一个接口只能接一根管子
                    const isPortBusy = (pid) => this.conns.filter(c => c.type === 'pipe').some(c => c.from === pid || c.to === pid);

                    if (isPortBusy(aPort)) {
                        alert(`端口 ${aPort} 已有管路连接`);
                        this.resetLinking();
                        return;
                    }
                    if (isPortBusy(bPort)) {
                        alert(`端口 ${bPort} 已有管路连接`);
                        this.resetLinking();
                        return;
                    }
                }

                // 3. 电路通常允许并联（一个端点接多根线），所以不对 wire 做 isPortBusy 检查
                this.addConnWithHistory(newConn);
            } else {
                alert("类型不匹配：管路不能连接到电路！");
            }
            this.resetLinking();
        }
    }
    // 辅助函数：比较两个连接是否等价（无顺序）
    _connEqual(a, b) {
        // 无向比较：类型相同且端点集合相等（正向或反向均视为相同连接）
        if (a.type !== b.type) return false;
        return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
    }

    // 辅助函数：生成连接的规范键（端点排序后）用于界面元素标记
    _connKeyCanonical(c) {
        // 无向规范键：按字符串顺序对端点排序以保证正反向具有相同键
        const a = c.from;
        const b = c.to;
        return a <= b ? `${a}-${b}` : `${b}-${a}`;
    }

    // 2. 连接虚线销毁函数。
    resetLinking() {
        // 1. 物理销毁 Konva 对象，释放内存并从图层移除
        if (this.tempLine) {
            this.tempLine.destroy();
            this.tempLine = null;
        }
        // 2. 清空状态位
        this.linkingState = null;
        // 3. 刷新画布
        this.layer.batchDraw();
    }

    // 3. 简单的连接历史操作（仅针对用户点击行为）
    addConnWithHistory(conn) {
        const sys = this;
        const action = {
            do() {
                if (!sys.conns.some(c => sys._connEqual(c, conn))) sys.conns.push(conn);
                sys.redrawAll();
            },
            undo() {
                const idx = sys.conns.findIndex(c => sys._connKeyCanonical(c) === sys._connKeyCanonical(conn) && c.type === conn.type);
                if (idx !== -1) sys.conns.splice(idx, 1);
                sys.redrawAll();
            }
        };
        this.history.do(action);
    }
    addConn(conn) {
        if (!this.conns.some(c => sys._connEqual(c, conn))) this.conns.push(conn);
        this.redrawAll();
    }

    // 4. 删除连线调用，前者可以恢复，后者不可恢复。
    removeConnWithHistory(conn) {
        const sys = this;
        const action = {
            do() {
                const idx = sys.conns.findIndex(c => sys._connKeyCanonical(c) === sys._connKeyCanonical(conn) && c.type === conn.type);
                if (idx !== -1) sys.conns.splice(idx, 1);
                sys.redrawAll();
            },
            undo() {
                if (!sys.conns.some(c => sys._connEqual(c, conn))) sys.conns.push(conn);
                sys.redrawAll();
            }
        };
        this.history.do(action);
    }
    removeConn(conn) {
        const idx = this.conns.findIndex(c => this._connKeyCanonical(c) === this._connKeyCanonical(conn) && c.type === conn.type);
        if (idx !== -1) this.conns.splice(idx, 1);
        this.redrawAll();
    }

    //5. 动画方式添加连线：3s 完成一次连线，结束后把连线加入 this.conns 并重绘，用户演示。
    addConnectionAnimated(conn) {
        return new Promise((resolve) => {
            const getPosByPort = (portId) => {
                const did = portId.split('_')[0];
                return this.comps[did]?.getAbsPortPos(portId);
            };

            const fromPos = getPosByPort(conn.from);
            const toPos = getPosByPort(conn.to);

            // --- 安全检查：如果坐标获取不到，直接完成，防止 Promise 永远挂起 ---
            if (!fromPos || !toPos) {
                console.error("Connection failed: Missing port coordinates", conn);
                this.conns.push(conn);
                this.solver.update(this.conns);
                this.redrawAll();
                return resolve();
            }

            const animLine = new Konva.Line({
                points: [fromPos.x, fromPos.y, fromPos.x, fromPos.y],
                stroke: conn.type === 'wire' ? '#e41c1c' : '#78e4c9',
                strokeWidth: conn.type === 'wire' ? 6 : 10,
                lineCap: 'round',
                lineJoin: 'round',
                shadowBlur: conn.type === 'pipe' ? 6 : 0,
                shadowColor: '#333',
                opacity: 0.95,
                listening: false // 提高性能，动画线不参与事件捕获
            });

            this.lineLayer.add(animLine);

            const duration = 3000; // 建议 1.2s，3s 对自动演示来说略久
            const start = performance.now();

            const animate = (now) => {
                const elapsed = now - start;
                const t = Math.min(1, elapsed / duration);

                // 缓动函数 (Ease-out)，让连线在接近终点时有一个减速感，更具质感
                const easeOut = 1 - Math.pow(1 - t, 3);

                const curX = fromPos.x + (toPos.x - fromPos.x) * easeOut;
                const curY = fromPos.y + (toPos.y - fromPos.y) * easeOut;

                animLine.points([fromPos.x, fromPos.y, curX, curY]);
                this.lineLayer.batchDraw();

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // --- 动画彻底结束后的清理与状态更新 ---
                    animLine.destroy();

                    // 确保不重复添加
                    const exists = this.conns.some(c => c.from === conn.from && c.to === conn.to);
                    if (!exists) {
                        this.conns.push(conn);
                    }

                    this.redrawAll();

                    // 关键点：在这里 resolve，外部的 await 才会继续
                    resolve();
                }
            };

            requestAnimationFrame(animate);
        });
    }

    // ==========================================
    // 第三部分：渲染引擎（连线绘制）
    // ==========================================

    /**
 * 统一重绘接口：当组件移动或连接池改变时调用
 */
    redrawAll() {
        this._renderGroup(this.conns.filter(c => c.type === 'pipe'), 'pipe');
        this._renderGroup(this.conns.filter(c => c.type === 'wire'), 'wire');
    }
    _renderGroup(conns, type) {
        const nodesRef = type === 'pipe' ? 'pipeNodes' : 'wireNodes';
        this[nodesRef].forEach(n => n.destroy());
        this[nodesRef] = [];

        const getPosByPort = (portId) => {
            const did = portId.split('_')[0];
            return this.comps[did]?.getAbsPortPos(portId);
        };

        conns.forEach(conn => {
            const p1 = getPosByPort(conn.from);
            const p2 = getPosByPort(conn.to);
            if (!p1 || !p2) return;

            let line;
            if (type === 'pipe') {
                // --- 1. 计算管路点集合 ---
                // 如果 conn.midPoint 存在，则管路由三点组成
                let pts = [p1.x, p1.y, p2.x, p2.y];
                if (conn.midPoint) {
                    pts = [p1.x, p1.y, conn.midPoint.x, conn.midPoint.y, p2.x, p2.y];
                }

                // --- 2. 绘制底层管道和流动层 ---
                line = new Konva.Line({
                    points: pts,
                    stroke: '#c4c7c8',
                    strokeWidth: 16,
                    lineCap: 'round',
                    lineJoin: 'round'
                });
                const flow = new Konva.Line({
                    points: pts,
                    stroke: '#130cdf',
                    strokeWidth: 4,
                    dash: [10, 20],
                    name: 'flow',
                    lineJoin: 'round'
                });

                // --- 3. 创建可拖动的中间点 (Handle) ---
                const handlePos = conn.midPoint || { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                const handle = new Konva.Circle({
                    x: handlePos.x,
                    y: handlePos.y,
                    radius: 6,
                    fill: '#f1c40f',
                    stroke: '#d35400',
                    strokeWidth: 2,
                    draggable: true,
                    visible: false // 默认隐藏，鼠标经过管路时显示
                });

                // 拖拽事件：更新数据并重绘
                handle.on('dragmove', () => {
                    conn.midPoint = { x: handle.x(), y: handle.y() };
                    // 实时更新当前线条预览，提高流畅度
                    const newPts = [p1.x, p1.y, handle.x(), handle.y(), p2.x, p2.y];
                    line.points(newPts);
                    flow.points(newPts);
                });

                handle.on('dragend', () => {
                    this.redrawAll(); // 确保所有关联层刷新
                });

                // 交互效果：鼠标悬停在管路上显示拖动手柄
                const showHandle = () => { handle.visible(true); this.lineLayer.batchDraw(); };
                const hideHandle = () => { if (!handle.isDragging()) handle.visible(false); this.lineLayer.batchDraw(); };

                line.on('mouseenter', showHandle);
                line.on('mouseleave', hideHandle);
                handle.on('mouseenter', showHandle);
                handle.on('mouseleave', hideHandle);

                // 双击删除逻辑
                const key = this._connKeyCanonical(conn);
                flow.setAttr('connKey', key);
                const removeHandler = () => {
                    const existing = this.conns.find(c => this._connKeyCanonical(c) === key && c.type === 'pipe');
                    if (existing) this.removeConnWithHistory(existing);
                };
                line.on('dblclick', removeHandler);

                this.lineLayer.add(line, flow, handle);
                this[nodesRef].push(line, flow, handle);

                line.moveToBottom();
                flow.moveToBottom();
            } else {
                // 绘制电路：三点贝塞尔曲线（start -> control -> end），对同一对组件的多条线做偏移以防重叠
                if (conn.from.includes('multimeter') || conn.to.includes('multimeter')) {
                    // 万用表特殊连线逻辑
                    let strokeColor;
                    // --- 核心修改：万用表表笔线增加中点以触发 tension ---
                    const midX = (p1.x + p2.x) / 2;
                    const midY = Math.max(p1.y, p2.y) + 20; // 模拟重力，让中点下垂 30 像素

                    // 重新构造点序列：[起点, 中点, 终点]
                    const linePoints = [p1.x, p1.y, midX, midY, p2.x, p2.y];
                    // 根据端子功能上色
                    if (conn.from.includes('com') || conn.to.includes('com')) {
                        strokeColor = '#006400'; // 墨绿色
                    } else if (conn.from.includes('wire_v') || conn.to.includes('wire_v') || conn.from.includes('wire_ma') || conn.to.includes('wire_ma')) {
                        strokeColor = '#FF4500'; // 火红色 (OrangeRed)
                    }
                    line = new Konva.Line({
                        points: linePoints,
                        stroke: strokeColor,
                        strokeWidth: 6,
                        lineCap: 'round',
                        lineJoin: 'round',
                        tension: 0.4, // 关键：lineTension设置此值大于0即变为贝塞尔曲线
                    });
                }
                else {
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    // 归一化的垂直向量
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const ux = -dy / len;
                    const uy = dx / len;

                    // 找到与当前连接相同组件对的所有电线（无顺序）
                    const devA = conn.from.split('_')[0];
                    const devB = conn.to.split('_')[0];
                    const siblings = this.conns.filter(c => c.type === 'wire' && (() => {
                        const ca = c.from.split('_')[0];
                        const cb = c.to.split('_')[0];
                        return (ca === devA && cb === devB) || (ca === devB && cb === devA);
                    })());
                    const idx = siblings.findIndex(c => this._connKeyCanonical(c) === this._connKeyCanonical(conn));
                    const total = siblings.length || 1;
                    const spacing = 18; // 垂直偏移间距
                    const longSpacing = 8; // 沿线微偏移，减少缠绕
                    // 使偏移在多条线时成对分布于两侧
                    const offset = (idx - (total - 1) / 2) * spacing;
                    const longOffset = (idx - (total - 1) / 2) * longSpacing;

                    const controlX = midX + ux * offset + (dx / len) * longOffset;
                    const controlY = midY + uy * offset + (dy / len) * longOffset;

                    // 使用二次控制点复制为两个控制点以兼容 Konva 的贝塞尔格式
                    const pts = [p1.x, p1.y, controlX, controlY, controlX, controlY, p2.x, p2.y];
                    let stroke;
                    if (conn.from.includes('wire_p') || conn.to.includes('wire_p') || conn.from.includes('wire_a')) stroke = '#e60c0c';
                    else stroke = '#544f4f';
                    line = new Konva.Line({
                        points: pts,
                        stroke: stroke, strokeWidth: 4, bezier: true
                    });

                }
                // 标记连接键并绑定双击删除事件
                const key = this._connKeyCanonical(conn);
                line.setAttr('connKey', key);
                line.setAttr('connType', type);
                line.on('dblclick', () => {
                    const existing = this.conns.find(c => this._connKeyCanonical(c) === key && c.type === type);
                    if (existing) {
                        this.removeConnWithHistory(existing);
                        // this.voltageSolver.update(this.conns);
                    }
                });
                this.lineLayer.add(line);
                this[nodesRef].push(line);
            }
            line.moveToBottom();
        });
        this.lineLayer.batchDraw();
    }

    // ==========================================
    // 第四部分：电路仿真、气路仿真、仪表显示
    // ==========================================

    //1. 提供给下属组件调用的回调函数，组件可根据端口电压决定自己的状态。
    getVoltageBetween(portIdA, portIdB) {
        return this.voltageSolver.getPD(portIdA, portIdB);
    }

    isPortConnected(pA, pB) {
        return this.voltageSolver.isPortConnected(pA, pB);
    }
    getPressAt(port) {

    }

    // ==========================================
    // 第五部分：回调函数，主循环
    // ==========================================
    // 1. 下属组件状态发生变化时调用的函数
    onComponentStateChange(dev) {

    }
    /**
     * 2. 仿真更新循环：
     */
    updateSimulation(frame) {

        //console.log("帧时间：", frame.timeDiff, frame.frameRate);
        this.pressSolver.solve();
        this.voltageSolver.update(this.conns);
    }





}

// 最小历史管理器：仅对用户交互的连线添加撤销/重做支持
class HistoryManager {
    constructor() {
        this.undos = [];
        this.redos = [];
        this.max = 80;
        this.onChange = () => { };
    }

    do(action) {
        try {
            action.do();
            this.undos.push(action);
            if (this.undos.length > this.max) this.undos.shift();
            this.redos = [];
            this.onChange();
        } catch (e) { console.error('History do error', e); }
    }

    undo() {
        const a = this.undos.pop();
        if (!a) return;
        try { a.undo(); this.redos.push(a); this.onChange(); } catch (e) { console.error('History undo error', e); }
    }

    redo() {
        const a = this.redos.pop();
        if (!a) return;
        try { a.do(); this.undos.push(a); this.onChange(); } catch (e) { console.error('History redo error', e); }
    }
}
