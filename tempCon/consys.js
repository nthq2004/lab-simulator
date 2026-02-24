import { PT100 } from './components/PT100.js';
import { PIDController } from './components/PID.js';
import { Transmitter } from './components/Transmitter.js';
import { Monitor } from './components/Monitor.js';
import { DCPower } from './components/DCPower.js';
import { AmpMeter } from './components/AmpMeter.js';
import { Multimeter } from './components/Multimeter.js';
import { TempMeter } from './components/TempMeter.js';
import { Relay } from './components/Relay.js';
import { CoolingFan } from './components/Fan.js';
import { Heater } from './components/Heater.js';
import Oven from './components/Oven.js';

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

/**
 * ControlSystem - 船舶高温淡水冷却系统仿真引擎
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

        // 2. 系统仿真状态
        this.state = {
            realT: 20,      // 实际温度
            fault: {},       // 
            mA: 4           // 变送器电流 (4-20mA)
        };
        this.state.fault = {
            transmitter: null, // 'OPEN' (PT100开路), 'SHORT' (PT100短路), 'LOOP_BREAK' (变送器输出回路开路), null (正常)
            ovenTemp: false,  // true (HH报警/水温异常)
            pidOutput1: false,  // true (PID输出回路1故障)
            pidOutput2: false,  // true (PID输出回路2故障)            
            communication: false // true (RS485通信故障)
        };

        // 3. 资源池
        this.comps = {};        // 组件实例集合
        this.conns = [];        // 所有连接统一存储为 {from, to, type}
        this.pipeNodes = [];    // 画布上的管路形状节点
        this.wireNodes = [];    // 画布上的电路形状节点
        this.thermalBuffer = new Array(20).fill(20);  // 10个周期的延迟缓冲区
        // 4. 交互状态
        this.linkingState = null; // 当前正在连线的起点信息
        this.tempLine = null;     // 鼠标跟随虚线
        this._workflowIdx = 0;    // 指出当前流程进行到第几步
        this._isStepRunning = false;  //单步运行时，防止多次点击，只有当前步骤完成，单击才有效
        this.stepsArray = [];  //存储所有流程的数组

        this.pwmTimer = 0;
        this.PWM_PERIOD = 5;

        this.init();
        this.initHistory();
        this.initStageEvents();
        this.initSteps();
    }

    // ==========================================
    // 第零部分：初始化与核心配置
    // ==========================================

    /**
     * 系统初始化：创建组件并启动仿真循环
     */
    init() {
        const componentConfigs = [
            { Class: PT100, id: 'pt', x: 415, y: 535 },
            { Class: TempMeter, id: 'tempmeter', x: 460, y: 670 },
            { Class: Transmitter, id: 'trans', x: 230, y: 300 },
            { Class: Relay, id: 'plusrelay', x: 550, y: 380 },
            { Class: Heater, id: 'heater', x: 560, y: 550 },
            { Class: Relay, id: 'minusrelay', x: 770, y: 380 },
            { Class: CoolingFan, id: 'fan', x: 760, y: 550 },
            { Class: PIDController, id: 'pid', x: 550, y: 20 },
            { Class: DCPower, id: 'dcpower', x: 950, y: 60 },
            { Class: Monitor, id: 'monitor', x: 970, y: 300 },
            { Class: AmpMeter, id: 'ampmeter', x: 350, y: 150 },
            { Class: Multimeter, id: 'multimeter', x: 0, y: 420 },
        ];

        // 创建烘箱容器（将特定组件放入烘箱内部）
        const ovenX = 370;
        const ovenY = 530;
        this.comps.oven = new Oven({ id: 'oven', x: ovenX, y: ovenY, W: 580, H: 300, title: '烘箱' }, this);
        this.layer.add(this.comps.oven.group);

        // 实例化组件，传入 this 以便组件能够调用 handlePortClick 和 redrawAll
        componentConfigs.forEach(cfg => {
            this.comps[cfg.id] = new cfg.Class(cfg, this);

            // 若为烘箱内组件，则改为加入烘箱组，并将位置设为相对烘箱左上角偏移
            if (['pt', 'tempmeter', 'heater', 'fan'].includes(cfg.id)) {
                const relX = cfg.x - ovenX;
                const relY = cfg.y - ovenY;
                this.comps.oven.addInside(this.comps[cfg.id], relX, relY);
            } else {
                this.layer.add(this.comps[cfg.id].group);
            }
        });

        this.layer.draw();

        // 启动物理计算和动画循环 (约 60fps)
        this.anim = new Konva.Animation((frame) => this.updateSimulation(frame), this.layer);
        this.anim.start();
    }

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

    initSteps() {
        const conns = [
            { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'pt_wire_l', to: 'trans_wire_l', type: 'wire' },
            { from: 'pt_wire_r', to: 'trans_wire_m', type: 'wire' },
            { from: 'pt_wire_r', to: 'trans_wire_r', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'trans_wire_p', type: 'wire' },
            { from: 'trans_wire_n', to: 'pid_wire_ni1', type: 'wire' },
            { from: 'pid_wire_no1', to: 'plusrelay_wire_r', type: 'wire' },
            { from: 'pid_wire_po1', to: 'plusrelay_wire_l', type: 'wire' },
            { from: 'plusrelay_wire_COM', to: 'heater_wire_l', type: 'wire' },
            { from: 'plusrelay_wire_NO', to: 'heater_wire_r', type: 'wire' },
            { from: 'pid_wire_no2', to: 'minusrelay_wire_r', type: 'wire' },
            { from: 'pid_wire_po2', to: 'minusrelay_wire_l', type: 'wire' },
            { from: 'minusrelay_wire_COM', to: 'fan_wire_l', type: 'wire' },
            { from: 'minusrelay_wire_NO', to: 'fan_wire_r', type: 'wire' },
            { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' },
            { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }
        ];
        this.stepsArray[0] = [
            //系统起动过程演练
            {
                msg: "1：连接PID控制器-->直流24V电源。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await this.addConnectionAnimated(conns[0]);
                    await this.addConnectionAnimated(conns[1]);
                    this.comps.monitor.btnMuteFunc();
                    this.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c0 = sys.conns.some(c => sys._connEqual(c, conns[0]));
                    const c1 = sys.conns.some(c => sys._connEqual(c, conns[1]));
                    return c0 && c1;
                }
            },
            {
                msg: "2：连接烘箱PT100传感器 --> 温度变送器-->PID控制器4-20mA输入端。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await this.addConnectionAnimated(conns[2]);
                    await this.addConnectionAnimated(conns[3]);
                    await this.addConnectionAnimated(conns[4]);
                    await this.addConnectionAnimated(conns[5]);
                    await this.addConnectionAnimated(conns[6]);
                    await this.addConnectionAnimated(conns[7]);

                },
                check: () => {

                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[2]));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conns[3]));
                    const c4 = sys.conns.some(c => sys._connEqual(c, conns[4]));
                    const c5 = sys.conns.some(c => sys._connEqual(c, conns[5]));
                    const c6 = sys.conns.some(c => sys._connEqual(c, conns[6]));
                    const c7 = sys.conns.some(c => sys._connEqual(c, conns[7]));
                    return c2 && c3 && c4 && c5 && c6 && c7;
                }
            },
            {
                msg: "3：连接PID控制器第1路输出-->加继电器 --> 烘箱加热器。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await this.addConnectionAnimated(conns[8]);
                    await this.addConnectionAnimated(conns[9]);
                    await this.addConnectionAnimated(conns[10]);
                    await this.addConnectionAnimated(conns[11]);
                },
                check: () => {
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[8]));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conns[9]));
                    const c4 = sys.conns.some(c => sys._connEqual(c, conns[10]));
                    const c5 = sys.conns.some(c => sys._connEqual(c, conns[11]));
                    return c2 && c3 && c4 && c5;
                }
            },
            {
                msg: "4：连接PID控制器第2路输出-->减继电器 --> 烘箱散热风扇。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await this.addConnectionAnimated(conns[12]);
                    await this.addConnectionAnimated(conns[13]);
                    await this.addConnectionAnimated(conns[14]);
                    await this.addConnectionAnimated(conns[15]);
                },
                check: () => {
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[12]));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conns[13]));
                    const c4 = sys.conns.some(c => sys._connEqual(c, conns[14]));
                    const c5 = sys.conns.some(c => sys._connEqual(c, conns[15]));
                    return c2 && c3 && c4 && c5;
                }
            },
            {
                msg: "5：连接PID控制器-->监控主机RS485通信端子。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await this.addConnectionAnimated(conns[16]);
                    await this.addConnectionAnimated(conns[17]);
                },
                check: () => {
                    const c2 = sys.conns.some(c => sys._connEqual(c, conns[16]));
                    const c3 = sys.conns.some(c => sys._connEqual(c, conns[17]));
                    return c2 && c3;
                }
            },
            {
                msg: "6：开启电源，确认PID控制处于手动状态，输出为50%，中位不输出。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    this.comps.dcpower.isOn = true;
                    this.comps.dcpower.update();
                    this.comps.pid.mode = "MAN";
                    this.comps.pid.OUT = 50;
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    this.comps.monitor.btnMuteFunc();
                    this.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = this.comps.dcpower.isOn === true;
                    const c2 = this.comps.pid.mode === "MAN";
                    const c3 = Math.abs(this.comps.pid.OUT - 50) < 2;
                    return c1 && c2 && c3;
                }
            },

            // --- 电气接线部分 ---
            {
                msg: "7：将烘箱加热器和散热风扇的控制模式转为遥控。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    this.comps.fan.mode = "remote";
                    this.comps.fan._updateSelectorUI();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    this.comps.heater.mode = "remote";
                    this.comps.heater._updateSelectorUI();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    this.comps.monitor.btnMuteFunc();
                    this.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = this.comps.fan.mode === "remote";
                    const c2 = this.comps.heater.mode === "remote";
                    return c1 && c2;
                }
            },
            {
                msg: "8：将PID控制器转为自动模式，系统开始工作，直到PV与SV差值小于10度。确保系统已经消音、消闪，故障复位。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    this.comps.pid.mode = "AUTO";
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => {
                    const c1 = this.comps.pid.mode === "AUTO";
                    const c2 = this.comps.monitor.activeAlarms.every(
                        a => a.muted === true && a.confirmed === true);
                    return c1 && c2;
                }
            }

        ];
        this.stepsArray[1] = [
            // --- 阶跃响应 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    this.applyAllPresets();
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.applyStartSystem();
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    this.comps.monitor.btnMuteFunc();
                    this.comps.monitor.btnAckFunc();
                },
                check: () => {
                    const c1 = this.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(this.comps.pid.PV - this.comps.pid.SV) < 10;
                    const c3 = !this.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = this.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：将设定值调到80度，观察加继电器、加热器的动作。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.pid.SV = 80;
                    await new Promise(resolve => setTimeout(resolve, 30000));
                },
                check: () => Math.abs(this.comps.pid.SV - 80) < 2
            },
            {
                msg: "3：将设定值调到50度，观察减继电器、散热风扇的动作。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.pid.SV = 50;
                    await new Promise(resolve => setTimeout(resolve, 30000));
                },
                check: () => Math.abs(this.comps.pid.SV - 50) < 2
            }
        ];
        this.stepsArray[2] = [
            // --- 温度变送器开路故障响应 ---
            {
                msg: "1：确保系统已经正常运行，PID控制器自动模式，PV与SV偏差小于10度，报警已消声、消闪。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    this.applyAllPresets();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    this.applyStartSystem();
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.monitor.btnMuteFunc();
                    this.comps.monitor.btnAckFunc();
                    await new Promise(resolve => setTimeout(resolve, 30000));

                },
                check: () => {
                    const c1 = this.comps.pid.mode === "AUTO";
                    const c2 = Math.abs(this.comps.pid.PV - this.comps.pid.SV) < 10;
                    const c3 = !this.comps.monitor.activeAlarms.some(
                        a => a.muted === false);
                    const c4 = this.comps.dcpower.isOn;
                    return c1 && c2 && c3 && c4;
                }
            },
            {
                msg: "2：触发温度变送器输出回路断路故障。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.trans.isOpened = true;
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: () => this.comps.trans.isOpened === true
            },
            {
                msg: "3：查看报警监视面板，进行消音、消闪。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.comps.monitor.btnMuteFunc();
                    this.comps.monitor.btnAckFunc();
                    await new Promise(resolve => setTimeout(resolve, 3000));
                },
                check: async function () {
                    // 1. 先等待 6s 确保仿真引擎的温度升高并触发了报警逻辑
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    const monitor = this.comps.monitor;
                    const alarms = monitor.activeAlarms;

                    // 3. 只有当存在报警，且所有报警都消音了，才返回 true
                    return alarms.every(a => a.muted === true);
                }

            },
            {
                msg: "4：描述现象：PID温度显示LLLL，因为电流为0，低于量程下限4mA。默认的处理方式：PID控制器认为温度偏低，以最大加热功率输出，最终系统温度超高。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 15000));
                },
                check: async () => {
                    await new Promise(resolve => setTimeout(resolve, 15000));
                    const c1 = this.state.realT >= 95;
                    return c1;
                }
            },
            {
                msg: "5：清除故障，描述现象：实际温度超高，以最大散热功率输出，迅速降温。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    this.comps.trans.isOpened = false;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    this.comps.monitor.btnMuteFunc();
                    this.comps.monitor.btnAckFunc();
                },
                check: async function () {
                    // 1. 先等待 6s 确保仿真引擎的温度升高并触发了报警逻辑
                    await new Promise(resolve => setTimeout(resolve, 10000));

                    const monitor = this.comps.monitor;
                    const alarms = monitor.activeAlarms;

                    // 3. 只有当存在报警，且所有报警都消音了，才返回 true
                    return alarms.every(a => a.muted === true) && this.comps.trans.isOpened === false;;
                }

            }

        ];
    }

    switchWorkflow(taskValue) {
        if (!taskValue) {
            console.log("未选择任何任务，清空流程数据");
            this._workflow = [];
            this._workflowIdx = 0;

            // 如果面板已打开，刷新一下列表显示为空
            if (this._workflowPanelEl) {
                this.closeWorkflowPanel();
            }
            return;
        }

        console.log("切换至任务:", taskValue);

        // 根据具体任务 ID 加载对应的步骤数据
        // 你可以把这些数据存在一个对象里，例如 this.allTasksData
        this._workflow = this.stepsArray[taskValue];

        // 切换任务后，重置进度索引
        this._workflowIdx = 0;

        // 切换任务后，需要重新点击开始
        if (this._workflowPanelEl) {
            this.closeWorkflowPanel();
        }
    }

    /**
     * 一键自动连线：将预设的逻辑关系注入连接池
     */
    applyAllPresets() {
        // 清空当前连接，防止重复注入
        // 使用合成端口 id（deviceid_type_portid），连接为无向：{ from, to, type }
        this.conns = [
            { from: 'pid_wire_vcc', to: 'dcpower_wire_p', type: 'wire' },
            { from: 'pid_wire_gnd', to: 'dcpower_wire_n', type: 'wire' },
            { from: 'pt_wire_l', to: 'trans_wire_l', type: 'wire' },
            { from: 'pt_wire_r', to: 'trans_wire_m', type: 'wire' },
            { from: 'pt_wire_r', to: 'trans_wire_r', type: 'wire' },
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            { from: 'ampmeter_wire_n', to: 'trans_wire_p', type: 'wire' },
            { from: 'trans_wire_n', to: 'pid_wire_ni1', type: 'wire' },
            { from: 'pid_wire_no1', to: 'plusrelay_wire_r', type: 'wire' },
            { from: 'pid_wire_po1', to: 'plusrelay_wire_l', type: 'wire' },
            { from: 'plusrelay_wire_COM', to: 'heater_wire_l', type: 'wire' },
            { from: 'plusrelay_wire_NO', to: 'heater_wire_r', type: 'wire' },
            { from: 'pid_wire_no2', to: 'minusrelay_wire_r', type: 'wire' },
            { from: 'pid_wire_po2', to: 'minusrelay_wire_l', type: 'wire' },
            { from: 'minusrelay_wire_COM', to: 'fan_wire_l', type: 'wire' },
            { from: 'minusrelay_wire_NO', to: 'fan_wire_r', type: 'wire' },
            { from: 'pid_wire_b1', to: 'monitor_wire_b1', type: 'wire' },
            { from: 'pid_wire_a1', to: 'monitor_wire_a1', type: 'wire' }
        ];
        this.redrawAll();
        this.comps.dcpower.isOn = true;
        this.comps.dcpower.update();
    }

    applyStartSystem() {

        this.comps.pid.mode = "AUTO";
        this.comps.heater.mode = "remote";
        this.comps.heater._updateSelectorUI();
        this.comps.fan.mode = "remote";
        this.comps.fan._updateSelectorUI();
    }

    setFault(n) {
        // 假设这些组件实例存储在 this.comps 中
        const transmitter = this.comps['trans']; // 变送器

        switch (n) {

            case 1:
                // n=3: 设置变送器开路
                // 逻辑：变送器自身断电或内部断路，黑屏，输出电流为0，显示LLLL。
                if (transmitter) {
                    transmitter.isOpened = true;
                    console.log("故障：变送器开路（断路）");
                }
                break;
            default:
                console.log("未知故障代码");
                break;
        }

    }

    /**
     * 第一部分，通用流程面板
     * @param {Array} steps - 传入的步骤数组 (包含 msg, act, check)
     * @param {string} mode - 模式选择: 'show'(演示), 'train'(操练), 'eval'(评估)
     */
    openWorkflowPanel(mode) {
        if (this._workflowPanelEl) return;
        this._wfMode = mode;
        this._workflowIdx = 0;

        const panel = document.createElement('div');
        // ... 样式保持你提供的风格，仅调整内部逻辑 ...
        panel.id = 'workflow-panel';
        Object.assign(panel.style, {
            position: 'absolute', top: '0', right: '0', width: '340px', height: '100vh',
            background: '#cdcbcb', boxShadow: '-6px 0 18px rgba(0,0,0,0.2)', zIndex: 9998,
            padding: '12px', boxSizing: 'border-box', fontFamily: 'Arial, sans-serif'
        });

        panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong id="wfTitle">操作流程 - ${mode === 'show' ? '自动演示' : (mode === 'step' ? '单步演示' : (mode === 'eval' ? '评估' : '操练'))}</strong>
            <button id="wfClose" style="padding:4px 8px">关闭</button>
        </div>
        <div id="wfList" style="overflow:auto;height:calc(100% - 128px);padding-right:6px; background:#f0f0f0; border-radius:4px"></div>
        <div id="wfFooter" style="margin-top:12px; padding:10px; text-align:center; border-top:1px solid #999; display:none"></div>
    `;

        this.container.appendChild(panel);
        this._workflowPanelEl = panel;

        // 初始渲染列表
        this.resetWorkflow();

        // 关闭逻辑
        panel.querySelector('#wfClose').onclick = () => this.closeWorkflowPanel();

        // 根据模式启动不同的处理器
        if (mode === 'show') {
            this._runAutoDemo(); // 演示模式：自动执行
        }
        else if (mode === 'eval' || mode === 'train') {
            this._startWorkflowWatcher(); // 操练/评估模式：循环检测
        }
    }

    _renderWorkflowList() {
        if (!this._workflowPanelEl) return;
        const wfList = this._workflowPanelEl.querySelector('#wfList');
        wfList.innerHTML = '';

        this._workflow.forEach((step, idx) => {
            // 评估模式下，不显示当前Idx之后的步骤
            if (this._wfMode === 'eval' && idx >= this._workflowIdx) return;

            const item = document.createElement('div');
            item.style.padding = '10px';
            item.style.borderBottom = '1px solid #ccc';
            item.style.transition = 'all 0.3s';

            if (idx < this._workflowIdx) {
                // 已完成步骤
                item.style.background = '#e2f0e2';
                item.style.color = '#777';
                if (this._wfMode === 'eval') {
                    item.innerHTML = `✅ ${step.msg}`;
                } else {
                    item.style.textDecoration = 'line-through';
                    item.innerHTML = `✔ ${step.msg}`;
                }
            } else if (idx === this._workflowIdx) {
                // 当前进行步骤
                item.style.background = '#dbdae0';
                item.style.color = '#2d862d';
                item.style.fontWeight = 'bold';
                item.style.borderLeft = '4px solid #2d862d';
                item.innerHTML = `▶ ${step.msg}`;
            } else {
                // 等待步骤 (仅演示和操练可见)
                item.style.background = '#fff';
                item.style.color = '#333';
                item.innerHTML = `&nbsp;&nbsp;${step.msg}`;
            }
            wfList.appendChild(item);
            // --- 核心改动：自动滚动 ---
            if (idx === this._workflowIdx) {
                // 使用 requestAnimationFrame 确保在元素渲染完成后计算位置
                requestAnimationFrame(() => {
                    item.scrollIntoView({
                        behavior: 'smooth', // 平滑滚动
                        block: 'nearest'    // 滚动到最近的边缘，避免剧烈跳动
                    });
                });
            }
        });

        this._updateFooter();
    }

    // 全自动演示：循环调用单步演示
    async _runAutoDemo() {
        this._isAutoPlaying = true; // 标记正在全自动运行
        for (let i = this._workflowIdx; i < this._workflow.length; i++) {
            if (!this._workflowPanelEl || !this._isAutoPlaying) break;

            // 执行当前这一步
            await this._executeSingleStep(i);
            this._workflowIdx++;
            this._renderWorkflowList();

            // 自动模式下的每步间隔（给用户阅读时间）
            if (i < this._workflow.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        this._isAutoPlaying = false;
    }
    // 假设这是“下一步”按钮的操作
    stepByStep(steps) {
        // 1. 如果动画正在运行，直接拦截
        if (this._isStepRunning) return;

        // 2. 检查面板是否存在，如果不存在，先调用开启面板的方法
        if (!this._workflowPanelEl) {
            console.log("面板未建立，正在初始化...");
            this.openWorkflowPanel(steps, 'step'); // 假设这是你打开面板的方法，模式设为演示
            // 初始化后通常需要一小段渲染时间，直接返回，让用户第二次点击开始第一步
            // 或者在 openWorkflowPanel 内部完成后自动触发下一步
            return;
        }

        // 3. 检查是否已经全部演示完，如果完了，点击可以重置
        if (this._workflowIdx >= this._workflow.length) {
            console.log("演示已结束，重置进度");
            this.resetWorkflow(); // 重置索引和连线
            return;
        }

        // 4. 执行单步演示
        this._nextStepDemo();
    }
    // 单步演示：点击按钮调用此函数
    async _nextStepDemo() {
        // 状态锁，防止暴力点击
        this._isStepRunning = true;

        try {
            const step = this._workflow[this._workflowIdx];

            // 渲染列表（高亮当前即将执行的步骤）
            this._renderWorkflowList();

            // 执行动作并等待（内部已包含 addConnectionAnimated 的 Promise）
            if (step && step.act) {
                await step.act.call(this);
            }

            // 动作完成后，索引递增
            this._workflowIdx++;

            // 再次渲染（此时原步骤会变成“已完成”样式，并自动滚动）
            this._renderWorkflowList();
            this.redrawAll();

        } catch (err) {
            console.error("单步演示出错:", err);
        } finally {
            // 无论成功失败，最后都要解锁
            this._isStepRunning = false;
        }
    }

    // 核心执行私有函数：负责具体的渲染和动画
    async _executeSingleStep(idx) {
        this._workflowIdx = idx;
        this._renderWorkflowList();

        // 1. 预留一小段观察时间
        await new Promise(resolve => setTimeout(resolve, 500));

        // 2. 执行动作
        const step = this._workflow[idx];
        if (step.act) {
            // 等待动画彻底完成
            await step.act.call(this);
        }

        this.redrawAll();
    }
    resetWorkflow() {
        this._workflowIdx = 0;
        this.conns = []; // 清空所有连线
        this.state.pumpOn = false; // 重置设备状态
        this.state.engOn = false;

        this.comps.dcpower.isOn = false;
        this.comps.dcpower.update();

        this.redrawAll();
        if (this._workflowPanelEl) this._renderWorkflowList();
    }
    _startWorkflowWatcher() {
        // 停止之前的监听
        this._isWatcherRunning = true;

        const watch = async () => {
            // 检查是否结束或面板已关闭
            if (!this._isWatcherRunning || !this._workflowPanelEl || this._workflowIdx >= this._workflow.length) {
                return;
            }

            const step = this._workflow[this._workflowIdx];

            if (step.check) {
                // --- 关键点：等待异步 check 的结果 ---
                // 这里会等待 check() 内部的 6s 延时结束
                const isPassed = await step.check.call(this);

                if (isPassed) {
                    this._workflowIdx++;
                    this._renderWorkflowList();

                    // 触发自动滚动
                    const wfList = this._workflowPanelEl.querySelector('#wfList');
                    if (wfList) {
                        wfList.scrollTo({
                            top: wfList.scrollHeight,
                            behavior: 'smooth'
                        });
                    }
                }
            }

            // 无论是否通过，等待 1 秒后进行下一次轮询
            setTimeout(watch, 1000);
        };

        watch();
    }

    // 别忘了在关闭面板或切换任务时停止监听
    _stopWorkflowWatcher() {
        this._isWatcherRunning = false;
    }
    _updateFooter() {
        const footer = this._workflowPanelEl.querySelector('#wfFooter');
        footer.style.display = 'block';

        if (this._workflowIdx >= this._workflow.length) {
            footer.style.background = '#d4edda';
            footer.style.color = '#155724';
            footer.innerHTML = this._wfMode === 'train'
                ? '🏁 演练完成！'
                : (this._wfMode === 'eval' ? '🏆 评估合格！' : '📺 演示完成');
        } else {
            footer.style.background = '#fff3cd';
            footer.style.color = '#856404';
            footer.innerHTML = `进度: ${this._workflowIdx + 1} / ${this._workflow.length}`;
        }
    }
    closeWorkflowPanel() {
        if (!this._workflowPanelEl) return;
        this._stopWorkflowWatcher();
        try { this.container.removeChild(this._workflowPanelEl); } catch (e) { }
        this._workflowPanelEl = null;
    }
    // ==========================================
    // 第二部分：交互管理（手动连线控制）
    // ==========================================

    /**
     * 处理端口点击事件：实现“起点-预览-终点”连线逻辑
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
    // 比较两个连接是否等价（无顺序）
    _connEqual(a, b) {
        // 无向比较：类型相同且端点集合相等（正向或反向均视为相同连接）
        if (a.type !== b.type) return false;
        return (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
    }

    // 生成连接的规范键（端点排序后）用于界面元素标记
    _connKeyCanonical(c) {
        // 无向规范键：按字符串顺序对端点排序以保证正反向具有相同键
        const a = c.from;
        const b = c.to;
        return a <= b ? `${a}-${b}` : `${b}-${a}`;
    }

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

    resetLinking() {
        this.linkingState = null;
        if (this.tempLine) { this.tempLine.destroy(); this.tempLine = null; }
        this.layer.draw();
    }

    // 简单的连接历史操作（仅针对用户点击行为）
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


    // ==========================================
    // 第三部分：渲染引擎（连线绘制）
    // ==========================================



    //窗口大小改变时，调整舞台大小
    resize() {
        this.stage.width(this.container.offsetWidth);
        this.stage.height(this.container.offsetHeight);
        this.redrawAll();
    }

    // 动画方式添加连线：3s 完成一次连线，结束后把连线加入 this.conns 并重绘
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

    addConn(conn) {
        if (!this.conns.some(c => sys._connEqual(c, conn))) this.conns.push(conn);
        this.redrawAll();
    }

    removeConn(conn) {
        const idx = this.conns.findIndex(c => this._connKeyCanonical(c) === this._connKeyCanonical(conn) && c.type === conn.type);
        if (idx !== -1) this.conns.splice(idx, 1);
        this.redrawAll();
    }

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
                    if (existing) this.removeConnWithHistory(existing);
                });
                this.lineLayer.add(line);
                this[nodesRef].push(line);
            }
            line.moveToBottom();
        });
        this.lineLayer.batchDraw();
    }

    // ==========================================
    // 第四部分：电路仿真、仪表显示
    // ==========================================

    // ---------- 电路相关辅助函数 ----------
    /**
     * 辅助A：生成初始物理连接集群
     */
    _getElectricalClusters(wireConns) {
        const parent = {};
        const find = (i) => {
            if (parent[i] === undefined) return (parent[i] = i);
            return parent[i] === i ? i : (parent[i] = find(parent[i]));
        };
        const union = (i, j) => {
            const rootI = find(i), rootJ = find(j);
            if (rootI !== rootJ) parent[rootI] = rootJ;
        };

        wireConns.forEach(c => union(c.from, c.to));

        const clusterMap = {};
        Object.keys(parent).forEach(id => {
            const root = find(id);
            if (!clusterMap[root]) clusterMap[root] = new Set();
            clusterMap[root].add(id);
        });
        return Object.values(clusterMap);
    }

    /**
     * 辅助B：合并零电阻设备：电流表的进出线、mA档、闭合的开关、0电阻
     */
    _bridgeZeroResistanceDevices(clusters) {
        const bridge = (id1, id2) => {
            const i1 = clusters.findIndex(c => c.has(id1));
            const i2 = clusters.findIndex(c => c.has(id2));
            if (i1 !== -1 && i2 !== -1 && i1 !== i2) {
                clusters[i1].forEach(id => clusters[i2].add(id));
                clusters.splice(i1, 1);
            }
        };

        Object.values(this.comps).forEach(dev => {
            const id = dev.group.id();
            // 开关逻辑：只有不处于 isOpen 状态时才桥接
            if (dev.type === 'switch' && !dev.isOpen) bridge(`${id}_wire_l`, `${id}_wire_r`);
            if (dev.type === 'relay' && dev.isEnergized) bridge(`${id}_wire_NO`, `${id}_wire_COM`);
            // 电流表和万用表mA档逻辑
            if (id === 'ampmeter') bridge('ampmeter_wire_p', 'ampmeter_wire_n');
            if (id === 'multimeter' && dev.mode === 'MA') bridge('multimeter_wire_ma', 'multimeter_wire_com');
            if (dev.type === 'resistor' && dev.currentResistance < 1) bridge(`${id}_wire_l`, `${id}_wire_r`);//0电阻
        });
    }
    /**
     * 辅助 C：设置集群电位
     */
    _setClusterVoltage(clusters, termVoltMap, termId, volt) {
        const cluster = clusters.find(c => c.has(termId));
        if (cluster) {
            cluster.forEach(id => termVoltMap[id] = volt);
        } else {
            termVoltMap[termId] = volt;
        }
    }

    /**
    * 辅助 D：计算两个等电位集群之间的总并联电阻
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

        // 遍历所有设备，寻找跨接在 A 和 B 之间的电阻
        Object.values(this.comps).forEach(dev => {
            if (dev.type === 'resistor' || dev.type === 'relay') {
                const portL = `${dev.group.id()}_wire_l`;
                const portR = `${dev.group.id()}_wire_r`;

                // 检查电阻是否跨接在两个集群之间
                const isConnected = (clusterA.has(portL) && clusterB.has(portR)) ||
                    (clusterA.has(portR) && clusterB.has(portL));

                if (isConnected) {
                    const r = dev.currentResistance;

                    if (r === 0) {
                        hasZeroResistor = true;
                    } else if (r > 0) {
                        inverseRSum += (1 / r);
                    }
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

    /**
     * 辅助 E：计算复杂网络（含串并联）中两个集群间的总电阻(只支持一个中间节点，最多两个串联)
     * 基于节点电压法的简化实现或路径折算
     */
    _getEquivalentResistance(startCluster, endCluster, allClusters) {
        // 1. 将传入的 Cluster 对象转换为索引
        const startIdx = allClusters.indexOf(startCluster);
        const endIdx = allClusters.indexOf(endCluster);

        // 防御性检查：确保传入的集群在数组中存在
        if (startIdx === -1 || endIdx === -1) {
            console.warn("未能在集群列表中找到指定的起点或终点集群");
            return Infinity;
        }
        if (startIdx === endIdx) return 0;

        // 2. 构建基于索引的邻接表
        const edges = this._buildClusterEdges(allClusters);

        let seriesPaths = [];

        // 3. 寻找 A -> X -> B 路径
        if (edges[startIdx]) {
            const startEdges = edges[startIdx];

            for (const middleIdxStr in startEdges) {
                const xIdx = Number(middleIdxStr);

                // 过滤：中继点不能是起点或终点
                if (xIdx === startIdx || xIdx === endIdx) continue;

                // 检查中继点是否连接到终点
                if (edges[xIdx] && edges[xIdx][endIdx] !== undefined) {
                    const rAX = startEdges[xIdx];      // A -> X 的电阻
                    const rXB = edges[xIdx][endIdx];    // X -> B 的电阻

                    // 串联相加
                    seriesPaths.push(rAX + rXB);
                }
            }
        }

        // 4. 检查直连 A -> B
        let directR = (edges[startIdx] && edges[startIdx][endIdx] !== undefined)
            ? edges[startIdx][endIdx]
            : Infinity;
        if (directR === 0) return 0;

        // 5. 汇总计算（并联逻辑）
        let invSum = 0;
        let foundPath = false;

        if (directR !== Infinity) {
            invSum += 1 / directR;
            foundPath = true;
        }

        seriesPaths.forEach(r => {
            if (r === 0) {
                invSum = Infinity; // 存在短路路径
            } else if (invSum !== Infinity) {
                invSum += 1 / r;
            }
            foundPath = true;
        });

        if (!foundPath) return Infinity;

        return invSum === Infinity ? 0 : (1 / invSum);
    }
    /**
     * 提取集群间的邻接表 (辅助 build)
     */
    _buildClusterEdges(allClusters) {
        const edges = {};
        for (let i = 0; i < allClusters.length; i++) {
            for (let j = i + 1; j < allClusters.length; j++) {
                const res = this._getParallelResistanceBetweenClusters(allClusters[i], allClusters[j]);
                if (res.count > 0) {
                    if (!edges[i]) edges[i] = {};
                    if (!edges[j]) edges[j] = {};
                    edges[i][j] = edges[j][i] = res.totalR;
                }
            }
        }
        return edges;
    }

    /**
    * 辅助函数F：检查两个端子是否通过导线直接（或经过路径）连接
    * 这取决于你 wireConns 的存储结构
    */
    _isDirectlyConnected(startNode, targetNode, wireConns) {
        // 简单的路径搜索，判断 startNode 是否更靠近 targetNode
        // 如果 wireConns 包含 {from: "multimeter_wire_com", to: "trans_wire_p"}
        if (!wireConns) return false;
        return wireConns.some(w =>
            (w.from === startNode && w.to === targetNode) ||
            (w.to === startNode && w.from === targetNode)
        );
    }
    /**
     * 1. 检查温度变送器输入状态
     * @returns {Object} { status: 'NORMAL'|'OPEN'|'SHORT'|'ERROR', value: number }
     */
    checkTransmitterInput(clusters) {
        const portL = `trans_wire_l`;
        const portM = `trans_wire_m`;
        const portR = `trans_wire_r`;
        if (!clusters || !Array.isArray(clusters)) {
            console.warn('checkPidPowerStatus: clusters 尚未生成或读取失败');
            return { status: 'OPEN', value: Infinity };
        }
        const clusterL = clusters.find(c => c.has(portL));
        const clusterM = clusters.find(c => c.has(portM));
        const clusterR = clusters.find(c => c.has(portR));

        // 情况 0：接线端子完全空置或 M-R 未按标准短接
        if (!clusterL || !clusterM || !clusterR || clusterM !== clusterR) {
            return { status: 'OPEN', value: Infinity };
        }

        // 情况 1：检查 L 与 M 之间是否直接短路 (通过导线集群直接连通)
        if (clusterL === clusterM) {
            return { status: 'SHORT', value: 0 };
        }

        // 情况 2：寻找跨接电阻
        const result = this._getParallelResistanceBetweenClusters(clusterL, clusterM);

        if (result.count > 0) {
            // 如果电阻值极小（例如小于 0.5 欧姆），在仿真中通常视为短路
            if (result.totalR < 0.5) {
                return { status: 'SHORT', value: result.totalR };
            }
            if (result.totalR > 1000) {
                return { status: 'OPEN', value: Infinity };
            }
            // 正常电阻范围
            return { status: 'NORMAL', value: result.totalR };
        }

        // 情况 3：有接线但中间没接负载电阻
        return { status: 'OPEN', value: Infinity };
    }

    /**
     *2.  检查 PID 控制器的供电状态
     * @param {Array} clusters 当前所有等电位集群
     * @returns {string} 'POWER_ON' | 'SHORT' | 'OPEN' | 'REVERSE'
     */
    checkPidPowerStatus(clusters) {
        const vcc = `pid_wire_vcc`;
        const gnd = `pid_wire_gnd`;
        const pwrP = `dcpower_wire_p`;
        const pwrN = `dcpower_wire_n`;
        if (!clusters || !Array.isArray(clusters)) {
            console.warn('checkPidPowerStatus: clusters 尚未生成或读取失败');
            return 'OPEN';
        }
        // 1. 获取电源和PID端子所在的集群
        const clusterVcc = clusters.find(c => c.has(vcc));
        const clusterGnd = clusters.find(c => c.has(gnd));
        const clusterP = clusters.find(c => c.has(pwrP));
        const clusterN = clusters.find(c => c.has(pwrN));
        if (!clusterVcc || !clusterGnd || !clusterP || !clusterN) {
            return 'OPEN';
        }

        // 2. 检查电源自身状态 (假设电源组件有 isOn 属性和内部故障 s.fault)
        // const powerSource = this.comps['dcpower'];
        // if (!powerSource || !powerSource.isOn || powerSource.isFault) {
        //     return 'OPEN';
        // }

        // 3. 检查短路 (电源正负极被导线直接连通)
        // 如果电源的正极集群和负极集群是同一个，说明整个系统总电源短路
        if (clusterP && clusterN && clusterP === clusterN) {
            return 'SHORT';
        }
        // 同时也检查 PID 端的输入是否被短路
        if (clusterVcc && clusterGnd && clusterVcc === clusterGnd) {
            return 'SHORT';
        }

        // 4. 检查正常连接 (正连正，负连负)
        const isNormal = (clusterVcc === clusterP) && (clusterGnd === clusterN);
        if (isNormal) {
            return 'POWER_ON';
        }

        // 5. 检查极性反接 (正连负，负连正)
        const isReverse = (clusterVcc === clusterN) && (clusterGnd === clusterP);
        if (isReverse) {
            return 'REVERSE';
        }

        // 6. 其他情况（如只连了一根线，或者完全没连）均视为断路
        return 'OPEN';
    }

    /**
    * 3. 检查二线制变送器回路及供电状态
    */
    checkTransmitterLoop(clusters) {
        const transP = `trans_wire_p`;
        const transN = `trans_wire_n`;
        const pidPI = `pid_wire_pi1`;
        const pidNI = `pid_wire_ni1`;
        if (!clusters || !Array.isArray(clusters)) {
            console.warn('checkPidPowerStatus: clusters 尚未生成或读取失败');
            return { active: false, reason: 'PID_NO_POWER' };
        }
        // 1. 找到各端子所属集群
        const clusterTransP = clusters.find(c => c.has(transP));
        const clusterTransN = clusters.find(c => c.has(transN));
        const clusterPidPI = clusters.find(c => c.has(pidPI));
        const clusterPidNI = clusters.find(c => c.has(pidNI));

        if (!clusterTransP || !clusterTransN || !clusterPidPI || !clusterPidNI) return { active: false, reason: 'NO_LOOP' };


        if (clusterPidPI === clusterPidNI) return { active: false, reason: 'SHORT_LOOP' };
        // 2. 物理链路检查：变送器必须串联在 PID 的馈电回路中
        const isWired = (clusterTransP === clusterPidPI) && (clusterTransN === clusterPidNI);
        if (!isWired) return { active: false, reason: 'NO_LOOP' };


        // 4. 变送器自检
        const transmitter = this.comps['trans'];
        if (!transmitter || transmitter.isOpened) {
            return { active: false, reason: 'DEVICE_FAULT' };
        }

        // 5. 全部通过
        return { active: true, reason: 'TRANS_NORMAL' };
    }

    /**
    * 4. 检查 PID 输出回路 (AO)
    * @param {string} pidId PID输出回路编码
    * @param {Array} clusters 等电位集群
    * @returns {Object} { isConnected: boolean, reason: string，resistance:number }
    */
    checkPidOutputLoop(outChannel, clusters) {
        const po = `pid_wire_po${outChannel}`;
        const no = `pid_wire_no${outChannel}`;
        if (!clusters || !Array.isArray(clusters)) {
            console.warn('checkPidPowerStatus: clusters 尚未生成或读取失败');
            return { isConnected: false, reason: 'PID_NO_POWER' };
        }
        // 1. 先决条件：检查 PID 自身是否正常供电启动
        // 假设你之前已经有了 checkPidPowerStatus 或者 pid 实例有 isRunning 属性
        // if (this.checkPidPowerStatus !== 'POWER_ON') {
        //     return { isConnected: false, reason: 'PID_NO_POWER' };
        // }

        // 2. 获取输出端子所在的集群
        const clusterPO = clusters.find(c => c.has(po));
        const clusterNO = clusters.find(c => c.has(no));

        if (!clusterPO || !clusterNO) {
            return { isConnected: false, reason: 'NOT_WIRED' };
        }

        // 3. 核心判定：检查这两个集群之间是否存在负载
        // 情况 A：直接短接（电阻为0），在并查集中 PO1 和 NO1 会属于同一个集群
        if (clusterPO === clusterNO) {
            return { isConnected: false, reason: 'SHORT_CIRCUIT', resistance: 0 };
        }

        if (this.comps.pid.outFault) {
            return { isConnected: false, reason: 'PID_FAULT' };
        }

        // 情况 B：跨接了电阻设备
        // 使用我们之前的辅助函数 D，寻找跨接在两个集群间的电阻
        const resResult = this._getParallelResistanceBetweenClusters(clusterPO, clusterNO);

        if (resResult.count > 0) {
            if (resResult.totalR === Infinity || resResult.totalR > 1000)
                return { isConnected: false, reason: 'OPEN_LOOP' };
            return { isConnected: true, reason: 'LOAD_DETECTED', resistance: resResult.totalR };
        }

        // 4. 有接线但没有负载（开路）
        return { isConnected: false, reason: 'OPEN_LOOP' };
    }

    /**
     *5. 检查 RS-485 通信链路
     * @param {Array} clusters 等电位集群
     * @returns {Object} { connected: boolean, status: string }
     */
    checkRS485Comm(clusters) {
        // 1. 定义 485 标准端子：A (Data+) 和 B (Data-)
        const pidA = `pid_wire_a1`;
        const pidB = `pid_wire_b1`;
        const monA = `monitor_wire_a1`;
        const monB = `monitor_wire_b1`;
        if (!clusters || !Array.isArray(clusters)) {
            console.warn('checkPidPowerStatus: clusters 尚未生成或读取失败');
            return { isConnected: false, reason: 'PID_OFFLINE' };
        }
        // 2. 检查两端设备的供电状态
        // if (this.checkPidPowerStatus !== 'POWER_ON') return { connected: false, status: 'PID_OFFLINE' };

        // 3. 找到端子所在的集群
        const clusterPidA = clusters.find(c => c.has(pidA));
        const clusterPidB = clusters.find(c => c.has(pidB));
        const clusterMonA = clusters.find(c => c.has(monA));
        const clusterMonB = clusters.find(c => c.has(monB));
        if (!clusterPidA || !clusterPidB || !clusterMonA || !clusterMonA) {
            return { connected: false, status: 'NO_PHYSICAL_LINK' };
        }

        // 4. 判定 A-A 和 B-B 的物理连通性
        const isAPathOk = (clusterPidA && clusterMonA && clusterPidA === clusterMonA);
        const isBPathOk = (clusterPidB && clusterMonB && clusterPidB === clusterMonB);

        // 情况 A：正常连接 (A-A, B-B)
        if (isAPathOk && isBPathOk) {
            // 检查 Modbus 协议参数匹配（如站号、波特率）
            return { connected: true, status: 'COMM_OK' };
        }

        // 情况 B：极性反接 (A-B, B-A)
        const isReversed = (clusterPidA === clusterMonB) && (clusterPidB === clusterMonA);
        if (isReversed) {
            return { connected: false, status: 'POLARITY_REVERSED' };
        }

        // 情况 C：短路 (A 和 B 连在了一起)
        if (clusterPidA && clusterPidB && clusterPidA === clusterPidB) {
            return { connected: false, status: 'BUS_SHORTED' };
        }

        // 情况 D：断路或单线连接
        return { connected: false, status: 'NO_PHYSICAL_LINK' };
    }

    // 6. 在电路计算完成后，计算并更新万用表和电流表显示值
    updateMeterValue(elec) {
        const wireConns = this.conns.filter(c => c.type === 'wire');
        const clusters = elec.clusters;
        //万用表更新逻辑
        const mm = this.comps.multimeter;
        const maNode = `multimeter_wire_ma`;
        const comNode = `multimeter_wire_com`;
        const vNode = `multimeter_wire_v`;
        // 基础查找：COM 和 V/Ω 端子所在的集群
        const comCluster = clusters.find(c => c.has(comNode));
        const vCluster = clusters.find(c => c.has(vNode));
        const maCluster = clusters.find(c => c.has(maNode));

        // --- 电流表 (Ammeter) 更新逻辑 ---
        const ampmeter = this.comps.ampmeter;
        const ampNodeP = 'ampmeter_wire_p';
        const ampNodeN = 'ampmeter_wire_n';
        const ampPCluster = clusters.find(c => c.has(ampNodeP));
        const ampNCluster = clusters.find(c => c.has(ampNodeN));

        let amp_I = 0;
        // 只有当电流表两个端子都接了线，且在同一个集群（电流表内部短路）
        if (ampPCluster && ampNCluster && ampPCluster === ampNCluster) {
            // 通用的电流获取逻辑：遍历所有能产生电流的设备
            const currentSources = [
                { p: 'trans_wire_n', n: 'trans_wire_p', val: elec.transCurrent },
                { p: 'pid_wire_po1', n: 'pid_wire_no1', val: elec.ch1Current },
                { p: 'pid_wire_po2', n: 'pid_wire_no2', val: elec.ch2Current }
            ];
            for (let source of currentSources) {
                // 检查电流表是否在该回路中
                if (ampPCluster.has(source.p) || ampPCluster.has(source.n)) {
                    amp_I = source.val || 0;
                    // --- 极性判断 ---
                    // 正常：P连SourceP（正路入）或 N连SourceN（负路出）
                    // 反接：P连SourceN 或 N连SourceP
                    const isPToN = this._isDirectlyConnected(ampNodeP, source.n, wireConns);
                    const isNToP = this._isDirectlyConnected(ampNodeN, source.p, wireConns);

                    // 如果满足反接特征（电流从 N 流向 P）
                    if (isPToN || isNToP) {
                        amp_I = -amp_I;
                    }
                    break;
                }
            }
        }
        // 更新电流表显示
        try {
            ampmeter.update(amp_I);
        } catch (e) {
            ampmeter.value = amp_I;
        }

        // 电流档 (MA)：万用表在回路中短接，接在哪个回路就显示哪个回路的电流。
        if (mm.mode && mm.mode.startsWith('MA')) {
            let I_mA = 0;
            // 通用的电流获取逻辑：遍历所有能产生电流的设备
            const currentSources = [
                { p: 'trans_wire_p', n: 'trans_wire_n', val: elec.transCurrent },
                { p: 'pid_wire_no1', n: 'pid_wire_po1', val: elec.ch1Current },
                { p: 'pid_wire_no2', n: 'pid_wire_po2', val: elec.ch2Current }
            ];

            if (!maCluster || !comCluster) {

                try { mm.update(I_mA); } catch (e) { mm.value = I_mA; }
                return;
            }

            for (let source of currentSources) {
                // 检查万用表是否在该回路中
                if (maCluster.has(source.p) || maCluster.has(source.n)) {
                    I_mA = source.val || 0;

                    // --- 极性判断核心逻辑 ---
                    // 获取具体的物理连接：找到 MA 端子和 COM 端子分别连接的导线对端
                    // 假设我们通过检测 MA 端子是否更接近电源的正极 (source.p)

                    // 逻辑：如果 COM 端子接在了电源的正极 (source.p)，说明电流从黑表笔流入，显示负号
                    // 注意：在并查集中，MA和COM在同一个集群，我们需要通过“逻辑路径”来模拟极性。
                    // 简单的仿真做法：检查万用表的 maNode 端口是通过导线连向 p 还是 n

                    const isMaToP = this._isDirectlyConnected(maNode, source.p, wireConns);
                    const isComToN = this._isDirectlyConnected(comNode, source.n, wireConns);

                    if (isMaToP || isComToN) {
                        I_mA = -I_mA; // 极性反接
                    }

                    break;
                }
            }
            try { mm.update(I_mA); } catch (e) { mm.value = I_mA; }
            return;
        }

        // 电压档：不改变电路，只读取两点电压差（v - com）
        if (mm.mode && mm.mode.startsWith('DCV')) {
            let diff = 0;
            if (comCluster && vCluster) {
                const vVolt = (elec.termVoltMap[vNode] !== undefined ? elec.termVoltMap[vNode] : 0);
                const comVolt = (elec.termVoltMap[comNode] !== undefined ? elec.termVoltMap[comNode] : 0);
                diff = vVolt - comVolt;
            }
            try { mm.update(diff); } catch (e) { mm.value = diff; }
            return;
        }

        // 电阻档：直接获取两端之间接的电阻数值（若连通且存在 Resistor 实例）
        if (mm.mode && mm.mode.startsWith('RES')) {

            let R = Infinity;
            if (comCluster && vCluster) {
                R = this._getEquivalentResistance(comCluster, vCluster, clusters);
                // R = resObj.totalR;
                // if (R === Infinity) {
                //     R = this._getEquivalentResistance(comCluster, vCluster, clusters);
                //     console.log("总电阻：", R);
                // }
            }
            const displayR = (R === Infinity) ? 100000000 : R;
            try { mm.update(displayR); } catch (e) { mm.value = displayR; }
            return;
        }
        if (mm.mode && mm.mode.startsWith('ACV')) {
            mm.update(0);
            return;
        }
        if (mm.mode === 'OFF') {
            mm.update(0);
            return;
        }
        if (mm.mode === 'C') {
            mm.update(0);
            return;
        }


    }

    //电路状态检测，主函数
    computeElectricalState(frame) {
        // 返回对象：{ pidPowered, transCurrent(mA),ch1Current,ch2Current,RS485State, termVoltMap电压矩阵,clusters连接集 }
        const res = { pidPowered: false, transCurrent: null, ch1Active: null, ch2Active: null, RS485Connected: false, termVoltMap: {}, clusters: [] };

        this.allTerminalId = new Set(); // 收集所有电气端子ID
        let termVoltMap = {};  //节点电压矩阵
        // 1. 初始化：所有端点电位清零
        Object.values(this.comps).forEach(device => {
            // 遍历设备内部定义的 terminals 数组
            if (device.ports && Array.isArray(device.ports)) {
                device.ports.forEach(terminal => {
                    // 仅初始化电路端口
                    if (terminal.type === 'wire') {
                        // terminal.termId 应该是类似 "dcpower_wire_p" 的完整 ID
                        this.allTerminalId.add(terminal.id); // 收集所有端子ID
                        termVoltMap[terminal.id] = 0;
                    }
                });
            }
        });
        res.termVoltMap = termVoltMap;


        const psu = this.comps.dcpower;
        // 2. 构建初始集群（物理导线）
        const wireConns = this.conns.filter(c => c.type === 'wire');
        let clusters = this._getElectricalClusters(wireConns);
        res.clusters = clusters;

        // 3. 动态合并：处理开关及“导通型”设备
        this._bridgeZeroResistanceDevices(clusters);



        //4.检查各个设备的状态，更新电位和电流
        // 如果电源没开，直接更新状态并退出
        if (!psu.isOn) {
            this._setClusterVoltage(clusters, termVoltMap, 'dcpower_wire_p', 0);
            this.comps.trans.update({ powered: false, transCurrent: 0 });

            this.updateMeterValue(res);
            return res;

        }
        //走到这里，说明电源正常，与电源相连的部分设置电压。负极和参考点不用设置，默认都是0.

        this._setClusterVoltage(clusters, termVoltMap, 'dcpower_wire_p', psu.voltage);
        if (!clusters || this.checkPidPowerStatus(clusters) !== 'POWER_ON') {
            this._setClusterVoltage(clusters, termVoltMap, 'pid_wire_pi1', 0);
            this.comps.trans.update({ powered: false, transCurrent: 0 });
            this.updateMeterValue(res);
            return res;
        }

        res.pidPowered = true;  //PID供电，检查输入和两个输出回路、通信回路，一起刷新仪表状态。
        this._setClusterVoltage(clusters, termVoltMap, 'pid_wire_pi1', psu.voltage);
        //(1)检查温度变速器PT100的情况，返回短路、开路、正常等状态和电阻值。
        const transInput = this.checkTransmitterInput(clusters);

        const transOutput = this.checkTransmitterLoop(clusters); //只有输出回路激活，根据电阻接入计算电流
        let iFinal = 21.6;
        if (transOutput.active) {

            switch (transInput.status) {
                case 'SHORT':
                    // 短路：输出低报电流
                    iFinal = 3.6;
                    break;

                case 'OPEN':
                    // 开路：输出高报电流
                    iFinal = 21.6;
                    break;

                case 'NORMAL':
                    // 正常接电阻：标准 PT100 阻值转电流公式
                    // 基础阻值 100Ω (0℃)，分度系数 38.51Ω/100℃ // 软件校准修正
                    // Iout = (i + zeroadj) * spanadj // 硬件输出限幅 (Clamping)
                    // 最大输出 20.8, 最小输出 3.8
                    const r = transInput.value;
                    const iRaw = 16 * (r - 100) / 38.51 + 4;
                    let iCalibrated = (iRaw + this.comps.trans.zeroAdj) * (this.comps.trans.spanAdj);
                    iFinal = Math.max(3.8, Math.min(20.8, iCalibrated));
                    break;
            }

            res.transCurrent = iFinal;
        } else {
            res.transCurrent = 0;
        }
        //在这里更新变送器的测量温度。
        this.comps.trans.update({ powered: transOutput.active, transCurrent: iFinal });
        this._setClusterVoltage(clusters, termVoltMap, 'pid_wire_ni1', res.transCurrent * 250 / 1000);

        //(2)检查输出回路
        const outChannels = ['1', '2']; // 修正变量名拼写
        const dt = frame ? frame.timeDiff / 1000 : 0.016;
        // --- 1. 更新 PWM 统一计时器 ---
        this.pwmTimer += dt;
        if (this.pwmTimer >= this.PWM_PERIOD) {
            this.pwmTimer = 0; // 到达 5s 后归零重放
        }
        // --- 2. 预计算当前时刻的 PWM 逻辑状态 ---
        // 计算加热通道瞬时电平 (PO1)
        const heatDuty = this.comps.pid.heatPWM; // 假设范围 0-1
        const isPo1High = (this.pwmTimer / this.PWM_PERIOD) < heatDuty;
        this._setClusterVoltage(clusters, termVoltMap, 'pid_wire_po1', isPo1High ? this.comps.dcpower.voltage : 0);

        // 计算冷却通道瞬时电平 (PO2)
        const coolDuty = this.comps.pid.coolPWM; // 假设范围 0-1
        const isPo2High = (this.pwmTimer / this.PWM_PERIOD) < coolDuty;
        this._setClusterVoltage(clusters, termVoltMap, 'pid_wire_po2', isPo2High ? this.comps.dcpower.voltage : 0);
        outChannels.forEach((channel) => {
            // 调用之前定义的输出回路检查函数
            const result = this.checkPidOutputLoop(channel, clusters);

            // 使用方括号语法动态设置属性名
            if (result.isConnected) {
                res[`ch${channel}Active`] = true;
            }
            else {
                res[`ch${channel}Active`] = false;
            }
            //根据电流结果更新电压矩阵
        });

        //（3）检查485连接
        const RS485Comm = this.checkRS485Comm(clusters);
        res.RS485Connected = RS485Comm.connected;
        res.clusters = clusters;
        res.termVoltMap = termVoltMap;
        this.updateMeterValue(res);
        return res;
    }

    getVoltageBetween(portIdA, portIdB) {
        console.log(this.termVoltMap[portIdA], this.termVoltMap[portIdB])
        return this.termVoltMap[portIdA] - this.termVoltMap[portIdB];
    }

    isPortConnected(portIdA, portIdB) {
        const cluster = this.clusters.find(c => c.has(portIdA));
        // 如果找不到包含 A 的分量，或者该分量不包含 B，则不连通
        return !!(cluster && cluster.has(portIdB));
    }
    //第五部分：主函数
    /**
     * 仿真更新循环：处理热力平衡和信号传递
     */
    updateSimulation(frame) {

        // ---------------------------------------------------------
        // 3. 信号与控制链
        // ---------------------------------------------------------
        // 先计算电路状态（供电、各线电位、变送器、PID输出回路）
        const elec = this.computeElectricalState(frame);
        this.termVoltMap = elec.termVoltMap;
        this.clusters = elec.clusters;

        if (elec.ch1Active) {
            this.comps.heater.update(this.comps.pid.heatPWM);
        }
        else {
            this.comps.heater.update(0);
        }
        if (elec.ch2Active) {
            this.comps.fan.update(this.comps.pid.coolPWM);
        }
        else {
            this.comps.fan.update(0);
        }
        const s = this.state;

        // 2. 核心热力学模拟 (二阶滞后模型 + 温差动态散热)
        // ---------------------------------------------------------
        s.internalT = s.internalT || 20;
        const ambientT = 20; // 环境基准温度

        // 产热：主要受发动机负荷影响
        const heatGen = this.comps.heater.power * 7;

        let coolingEffect = 0;
        /**
        * 动态散热调整：
        * 1. (s.internalT - ambientT) 代表温差。温度越高，这个值越大，散热越强。
        * 2. s.valvePos 代表流量控制。
        * 3. 0.05 是热交换系数（可根据需要微调）。
        */
        const heatExchangeRate = 0.14; // 基础热交换系数
        coolingEffect = (s.internalT - ambientT) * this.comps.fan.power * heatExchangeRate;
        const heatLoss = (s.internalT - ambientT) * 0.0006;


        // 第一阶惯性：加热核心的温度变化
        const coreInertia = 0.05;
        // 核心公式：温度变化 = (产热 - 散热) * 惯性系数
        s.internalT += (heatGen - coolingEffect - heatLoss) * coreInertia;



        // 第二阶：纯滞后 (Transport Delay)
        // 模拟水从加热点流到传感器点需要 2 秒（假设每秒 10 帧，数组长度 20）
        this.thermalBuffer.push(s.internalT);
        const delayedT = this.thermalBuffer.shift(); // 取出 2 秒前的温度

        // 第三阶：传感器惯性 (Sensor Lag)
        // 传感器本身有热敏电阻外壳，感温不及时
        s.realT = s.realT || 20;
        s.realT += (delayedT - s.realT) * 0.08;

        // 物理极值保护
        s.realT = Math.max(20, Math.min(100, s.realT));
        //温度表实时更新，PT100实时感测温度，阻值变化
        this.comps.tempmeter.update(s.realT);
        this.comps.pt.update(s.realT);

        let sensedTemp = 0;


        s.fault = {
            transmitter: null,
            ovenTemp: false,
            pidOutput1: false,
            pidOutput2: false,
            communication: !elec.RS485Connected // 通信故障判定
        };

        // 控制器计算：只有当 PID 实际通电（elec.pidPowered）时才允许 update 输出与显示
        if (elec.pidPowered) {
            // 变送器组件更新 (独立于 PID 供电)
            let pidIn_mA = elec.transCurrent || 0;
            // 即使电流异常(3.6或21.6)，也先计算出一个数值，后续由 fault 覆盖
            sensedTemp = ((pidIn_mA - 4) / 16) * 100;
            if (sensedTemp > 100) {
                console.log("电流测量值", pidIn_mA, "温度值：", sensedTemp);
            }
            // --- 1. 变送器相关故障诊断 ---
            const transMA = elec.transCurrent || 0;
            if (transMA === 21.6) {
                s.fault.transmitter = 'OPEN';        // PT100 开路
            } else if (transMA === 3.6) {
                s.fault.transmitter = 'SHORT';       // PT100 短路
            } else if (transMA === 0) {
                s.fault.transmitter = 'LOOP_BREAK';  // 变送器输出回路开路（无电流）
            }
            // --- 2. 水温异常诊断 (HH报警) ---
            if (sensedTemp >= 95) {
                s.fault.ovenTemp = true;
            }
            // --- 3. PID 输出回路诊断 ---
            // 只有在 PID 有电但检测不到输出电流时触发
            if (elec.pidPowered && !elec.ch1Active) {
                s.fault.pidOutput1 = true;
            }
            if (elec.pidPowered && !elec.ch2Active) {
                s.fault.pidOutput2 = true;
            }
            // PID 根据电流推算温度 (4-20mA -> 20-100℃)
            // A. 输入信号处理：将电路电流 (4-20mA) 传入 PID
            this.comps.pid.update(transMA);


        } else {
            this.comps.pid.update({ powered: false }); // 无电源时通知 PID 断电以清屏

        }
        // 更新 Monitor：传入归一化数据 (0-1)
        // 注意：Monitor 的纵坐标范围是 -0.1 到 1.1，这样 10% 的超调会清晰可见
        if (elec.RS485Connected) {
            this.comps.monitor.update({
                pv: sensedTemp,      // 假设 100℃ 是量程上限
                sv: this.comps.pid.SV,
                out1: this.termVoltMap['pid_wire_po1'] * 2, // PID 已经 0-100
                out2: this.termVoltMap['pid_wire_po2'] * 2, // PID 已经 0-100                
                fault: s.fault
            });
        } else {
            this.comps.monitor.update({
                pv: 0,   // 界面通常会显示 ---
                sv: 0,
                out1: 0,
                out2: 0,
                fault: {
                    transmitter: null,
                    ovenTemp: false,
                    pidOutput1: false,
                    pidOutput2: false,
                    communication: !elec.RS485Connected // 通信故障判定
                }  // 99 约定为通信链路故障
            });
        }

    }
}