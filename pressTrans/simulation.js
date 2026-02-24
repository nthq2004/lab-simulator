import { Gauge } from './device/guage.js';  //下层设备对象依赖的类，比如仪表类
import { DCPower } from './device/dcpower.js'; //下层设备对象依赖的类，比如直流电源类
import { PressureTransmitter } from './device/pressuretrans.js'; //下层设备对象依赖的类，比如压力变送器类
import { TeeConnector } from './device/teeconn.js'; //下层设备对象依赖的类，比如T型管接头类
import { PressureRegulator } from './device/presreg.js'; //下层设备对象依赖的类，比如调压阀类
import { StopValve } from './device/stopvalve.js'; //截止阀 
import { AirBottle } from './device/airbottle.js'; //空气瓶
import { Multimeter } from './device/multimeter.js'; //万用表
import { AdjustableResistor } from './device/adjres.js'; //调节电阻
import { LeakDetector } from './device/leakdetect.js';  //肥皂泡产生器


/*对外声明的类，构造时要传入画布ID，和处理函数，所有的仿真对象都包含在这个文件 */
export class SimulationEngine {
    //构造函数，传入画布容器ID和设备操作处理函数（上层传给本层系统的回调函数）。
    constructor(containerId, onAction) {
        this.container = document.getElementById(containerId);
        /* 仿真对象都在画布上，根据这个画布创建舞台，添加图层，设备都在图层上， */
        this.stage = new Konva.Stage({
            container: containerId,
            width: this.container.offsetWidth,
            height: this.container.offsetHeight
        });
        this.devLayer = new Konva.Layer();
        this.stage.add(this.devLayer);
        this.lineLayer = new Konva.Layer();
        this.stage.add(this.lineLayer);

        /*这是设备操作的主处理逻辑函数，由main.js定义*/
        this.onAction = onAction;
        this.locked = false; //仿真锁定状态，默认为false，表示可以操作。当教师端在演示模式下时，锁定学生端的操作权限，设置locked=true；当教师端在练习模式下，只有被选中的学生可以操作，其他学生locked=true；教师端自己在练习模式下locked=true，不能操作模型。
        /*这是设备对象数组，每个设备都是一个group，可根据id找到对应设备的group，devices[Pump]就获得Pump的group，可对group内的组件（圆形、矩形、线条）进行操作 */
        this.devices = {};
        this.conns = []; // 存储所有连线对象的数组。
        // 简单的历史快照，用于实现撤销/重做
        this._history = [];
        this._historyIndex = -1;
        this._historyMax = 100;

        this.pTransMax = 1.0; //默认压力变送器量程最大值1MPa
        this.pGaugeMax = 10; //默认压力表量程最大值10bar

        this.stepsArray = []; // 演示步骤列表，每项包含 { msg: '步骤说明', act: () => { ... } }，act 是执行该步骤的函数
        this._workflow = []; //评估步骤列表，每项包括{ msg: '步骤说明', act: () => { ... } }，act 检查该步骤操作是否正确的函数。
        this._workflowIdx = 0;
        this._break = null;

        this.pressureMap = {}; //所有气路端子的压力视图，可确定气路的通断和气路设备的工作状态
        this.selectedTerminal = null; // 当前选中的端子,用于连线操作。
        this.isProcessing = false; // 关键：防死循环锁

        this.init();/*构造函数里面，一般会调用初始化函数 */
        this.initSteps();
        // 启动物理仿真计时器（用于处理气瓶耗气等随时间变化的逻辑）
        this.startPhysicsTimer();
        // 初始快照
        this._recordSnapshot();
    }

    init() {
        //在画布左边生成两个工具箱，一个是设备工具箱，包括电源、变送器、执行器等，另一个是仿真工具箱，包括自动连线、自动连管、重置接线、单步仿真、撤销操作等功能按钮

        //如果有组件移动，重绘所有连线，移动过程中就重绘
        this.devLayer.on('dragmove dragend', () => {
            this.updateAllDevices();
        });
        //如何为设备自动生成id，如果是新建设备，可以用设备类型加上一个递增数字，比如dcPower_01,dcPower_02等，如果是从预设模板加载的设备，就用模板里定义的id。

        const aGauge = new Gauge({
            layer: this.devLayer,
            id: 'aGa',
            name: '电流表mA',
            min: 0,
            max: 20,
            type: 'aGauge',
            onTerminalClick: this.onTermClick.bind(this)
        })
        //把这个设备对象存到devices里，方便后续操作
        this.devices['aGa'] = aGauge;

        const pGauge = new Gauge({
            layer: this.devLayer,
            x: 480,
            y: 190,
            id: 'pGa',
            name: '压力表bar',
            min: 0,
            max: this.pGaugeMax || 10,
            type: 'pGauge',
            onTerminalClick: this.onTermClick.bind(this),
        })
        this.devices['pGa'] = pGauge;//把这个设备对象存到devices里，方便后续操作

        const myPower = new DCPower({
            layer: this.devLayer,
            id: 'dcP',
            name: '直流电源24V',
            onTerminalClick: this.onTermClick.bind(this),
            onStateChange: this.reportDevState.bind(this)
        })
        this.devices['dcP'] = myPower;//把这个设备对象存到devices里，方便后续操作

        const myTrans = new PressureTransmitter({
            layer: this.devLayer,
            id: 'pTr',
            name: '压力变送器',
            rangeMax: this.pTransMax || 1.0, // 量程最大值1MPa
            onTerminalClick: this.onTermClick.bind(this),
            onStateChange: this.reportDevState.bind(this)
        });
        this.devices['pTr'] = myTrans;//把这个设备对象存到devices里，方便后续操作

        const tConn = new TeeConnector({
            layer: this.devLayer,
            id: 'tCo',
            name: 'T型管接头',
            direction: 'left',
            onTerminalClick: this.onTermClick.bind(this),
        });
        this.devices['tCo'] = tConn;//把这个设备对象存到devices里，方便后续操作 

        const pReg = new PressureRegulator({
            layer: this.devLayer,
            id: 'pRe',
            name: '调压阀',
            onTerminalClick: this.onTermClick.bind(this),
            onStateChange: this.reportDevState.bind(this),
        });
        this.devices['pRe'] = pReg;//把这个设备对象存到devices里，方便后续操作  

        const stValve = new StopValve({
            layer: this.devLayer,
            id: 'stV',
            name: '截止阀',
            onTerminalClick: this.onTermClick.bind(this),
            onStateChange: this.reportDevState.bind(this),
        });
        this.devices['stV'] = stValve;//

        const caBot = new AirBottle({
            layer: this.devLayer,
            id: 'caB',
            name: '压缩空气瓶',
            onTerminalClick: this.onTermClick.bind(this),
        });
        this.devices['caB'] = caBot;

        const mulMeter = new Multimeter({
            layer: this.devLayer,
            id: 'muM',
            name: '万用表',
            onTerminalClick: this.onTermClick.bind(this),
            onStateChange: this.reportDevState.bind(this),
        });
        this.devices['muM'] = mulMeter;

        const adjRes = new AdjustableResistor({
            layer: this.devLayer,
            id: 'pRr',
            name: '调节电阻',
            onTerminalClick: this.onTermClick.bind(this),
            onStateChange: this.reportDevState.bind(this),
        });
        this.devices['pRr'] = adjRes;

        const leakD = new LeakDetector({
            layer: this.devLayer,
            id: 'leD',
            name: '泄漏检测器',
            getTerminals: this.getPipeTerminals.bind(this),
        });
        this.devices['leD'] = leakD;
        //topInfo显示当前步骤说明，在仿真操作演示过程中，根据预设的步骤列表，依次更新topInfo的文本内容，引导用户完成实验操作。最后一步是实验完成，提示用户3秒后关闭信息框。关闭函数隐藏topInfo，并清空文本内容。
        this._bindRepairLogic();    //绑定演示步骤和评估步骤的逻辑函数，定义在后面，主要是设置步骤列表和实现showTopInfo函数。


        this.devLayer.draw();
    }

    initSteps() {

        this.stepsArray[0] = [
            {
                msg: "1. 24V电源(+) -> 负载电阻(+)",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'dcP_wire_p', to: 'pRr_wire_p', type: 'wire' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'dcP_wire_p' && c.to === 'pRr_wire_p') || this.conns.some(c => c.from === 'pRr_wire_p' && c.to === 'dcP_wire_p') }
            },
            {
                msg: "2. 负载电阻(-)-> 压力变送器(+)",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'pRr_wire_n', to: 'pTr_wire_p', type: 'wire' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'pRr_wire_n' && c.to === 'pTr_wire_p') || this.conns.some(c => c.from === 'pTr_wire_p' && c.to === 'pRr_wire_n') }
            },
            {
                msg: "3.  压力变送器(-) -> 电流表(+)",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'pTr_wire_n', to: 'aGa_wire_p', type: 'wire' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'pTr_wire_n' && c.to === 'aGa_wire_p') || this.conns.some(c => c.from === 'aGa_wire_p' && c.to === 'pTr_wire_n') }

            },
            {
                msg: "4. 电流表(-) -> 24V电源(-)",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'aGa_wire_n', to: 'dcP_wire_n', type: 'wire' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'caB_pipe_o' && c.to === 'stV_pipe_o') || this.conns.some(c => c.from === 'stV_pipe_o' && c.to === 'caB_pipe_o') }
            },
            {
                msg: "5. 空气瓶出口 -> 截止阀右端",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'caB_pipe_o', to: 'stV_pipe_o', type: 'pipe' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'stV_pipe_i' && c.to === 'pRe_pipe_i') || this.conns.some(c => c.from === 'pRe_pipe_i' && c.to === 'stV_pipe_i') }
            },
            {
                msg: "6. 截止阀左端 -> 调节阀入口",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'stV_pipe_i', to: 'pRe_pipe_i', type: 'pipe' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'stV_pipe_i' && c.to === 'pRe_pipe_i') || this.conns.some(c => c.from === 'pRe_pipe_i' && c.to === 'stV_pipe_i') }
            },
            {
                msg: "7. 调节阀出口 -> T型管下端",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'pRe_pipe_o', to: 'tCo_pipe_l', type: 'pipe' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'pRe_pipe_o' && c.to === 'tCo_pipe_l') || this.conns.some(c => c.from === 'tCo_pipe_l' && c.to === 'pRe_pipe_o') }
            },
            {
                msg: "8. T型管上端 -> 压力表",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'tCo_pipe_r', to: 'pGa_pipe_i', type: 'pipe' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'tCo_pipe_r' && c.to === 'pGa_pipe_i') || this.conns.some(c => c.from === 'pGa_pipe_i' && c.to === 'tCo_pipe_r') }
            },
            {
                msg: "9. T型管左端 -> 压力变送器气压口",
                act: async () => {
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'tCo_pipe_u', to: 'pTr_pipe_i', type: 'pipe' });
                    await this.sleep(1000);
                },
                check: () => { return this.conns.some(c => c.from === 'tCo_pipe_u' && c.to === 'pTr_pipe_i') || this.conns.some(c => c.from === 'pTr_pipe_i' && c.to === 'tCo_pipe_u') }
            },
            {
                msg: "10. 按下24V电源键,接通电源",
                act: async () => {
                    await this.sleep(3000);
                    this.devices['dcP'].setValue(true, 24);
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => this.devices['dcP'].isOn === true
            },
            {
                msg: "11. 合上截止阀,变送器气压为0,电流应为4mA.",
                act: async () => {
                    await this.sleep(3000);
                    this.devices['stV'].setValue(true); this.devices['pRe'].setPressure = 0; this.devices['pRe'].update();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => this.devices['stV'].isOpen === true && this.devices['pRe'].setPressure === 0 && Math.abs(this.devices['pTr'].getValue() - 4) < 0.1
            },
            {
                msg: `12. 将压力调节到0.25 * 量程,变送器电流应为8mA.`,
                act: async () => {
                    await this.sleep(3000);
                    this.devices['pRe'].setPressure = 2.5 * this.pTransMax; this.devices['pRe'].update();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => Math.abs(this.devices['pRe'].setPressure - 2.5 * this.pTransMax) < 0.05 && Math.abs(this.devices['pTr'].getValue() - 8) < 0.1
            },
            {
                msg: `13. 将压力调节到0.5 * 量程,变送器电流应为12mA.`,
                act: async () => {
                    await this.sleep(3000);
                    this.devices['pRe'].setPressure = 5 * this.pTransMax;
                    this.devices['pRe'].update();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => Math.abs(this.devices['pRe'].setPressure - 5 * this.pTransMax) < 0.05 && Math.abs(this.devices['pTr'].getValue() - 12) < 0.1
            },
            {
                msg: `14. 将压力调节到0.75 *  量程,变送器电流应为16mA.`,
                act: async () => {
                    await this.sleep(3000);
                    this.devices['pRe'].setPressure = 7.5 * this.pTransMax;
                    this.devices['pRe'].update();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => Math.abs(this.devices['pRe'].setPressure - 7.5 * this.pTransMax) < 0.05 && Math.abs(this.devices['pTr'].getValue() - 16) < 0.1
            },
            {
                msg: `15. 将压力调节到1* 量程,变送器电流应为20mA.`,
                act: async () => {
                    await this.sleep(3000);
                    this.devices['pRe'].setPressure = 10 * this.pTransMax;
                    this.devices['pRe'].update();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => Math.abs(this.devices['pRe'].setPressure - 10 * this.pTransMax) < 0.05 && Math.abs(this.devices['pTr'].getValue() - 20) < 0.1
            },
        ];
        this.stepsArray[1] = [
            {
                msg: '1. 接通电路和气路。',
                act: async () => {
                    await this.sleep(1000);
                    const autoConns = [
                        { from: 'dcP_wire_p', to: 'pRr_wire_p', type: 'wire' },
                        { from: 'pRr_wire_n', to: 'pTr_wire_p', type: 'wire' },
                        { from: 'pTr_wire_n', to: 'aGa_wire_p', type: 'wire' },
                        { from: 'aGa_wire_n', to: 'dcP_wire_n', type: 'wire' },
                        { from: 'caB_pipe_o', to: 'stV_pipe_o', type: 'pipe' },
                        { from: 'stV_pipe_i', to: 'pRe_pipe_i', type: 'pipe' },
                        { from: 'pRe_pipe_o', to: 'tCo_pipe_l', type: 'pipe' },
                        { from: 'tCo_pipe_r', to: 'pGa_pipe_i', type: 'pipe' },
                        { from: 'tCo_pipe_u', to: 'pTr_pipe_i', type: 'pipe' },
                    ];
                    // 使用 for...of 替代 forEach
                    for (const conn of autoConns) {
                        const exists = this.conns.some(c =>
                            (c.from === conn.from && c.to === conn.to) ||
                            (c.from === conn.to && c.to === conn.from)
                        );

                        if (!exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            await this.addConnectionAnimated(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => this.checkConn()
            },
            {
                msg: '2. 触发压力变送器电路开路故障。',
                act: async () => {
                    await this.sleep(2000);
                    this.setFault(1);
                    await this.sleep(2000);
                },
                check: () => (this._break !== null)
            },

            {
                msg: '3. 合上电源和截止阀，观察电流表显示为0。',
                act: async () => {
                    await this.sleep(2000);
                    this.devices['dcP'].isOn = true;
                    this.devices['dcP'].update();
                    await this.sleep(2000);
                    this.devices['stV'].isOpen = true;
                    this.devices['stV'].update();
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => (this.devices['dcP'] && this.devices['dcP'].isOn) && (this.devices['stV'] && this.devices['stV'].isOpen) && (this.devices['aGa'] && Math.abs(this.devices['aGa'].getValue() - 0) < 0.1)
            },
            {
                msg: '4. 关闭气源。',
                act: async () => {
                    await this.sleep(3000);
                    this.devices['stV'].isOpen = false;
                    this.devices['stV'].update();
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => (this.devices['stV'] && !this.devices['stV'].isOpen)
            },
            {
                msg: '5. 用万用表测电压,判断电路断点。',
                act: async () => {
                    await this.sleep(3000);
                    this.devices['muM'].group.position({ x: 300, y: 500 });
                    await this.sleep(1000);
                    this.devices['muM'].mode = "DCV";
                    this.devices['muM']._updateAngleByMode('DCV');
                    await this.sleep(1000);
                    await this.addConnectionAnimated({ from: 'muM_wire_com', to: 'dcP_wire_n', type: 'wire' });
                    await this.addConnectionAnimated({ from: 'muM_wire_v', to: 'dcP_wire_p', type: 'wire' });
                    this.updateAllDevices();
                    await this.sleep(3000);
                    if ((this._break && this._break.type === 'pTr_internal')) {
                        this.removeConn({ from: 'muM_wire_com', to: 'dcP_wire_n', type: 'wire' });
                        this.removeConn({ from: 'muM_wire_v', to: 'dcP_wire_p', type: 'wire' });
                        this.updateAllDevices();
                        await this.sleep(1000);
                        await this.addConnectionAnimated({ from: 'muM_wire_com', to: 'pTr_wire_n', type: 'wire' });
                        await this.addConnectionAnimated({ from: 'muM_wire_v', to: 'pTr_wire_p', type: 'wire' });
                        this.updateAllDevices();
                    }
                    console.log(this._break);
                    this._recordSnapshot();

                    await this.sleep(3000);
                },
                check: () => {
                    // 学员需将万用表表笔接到对应端子，检测显示由 muM 的读数决定
                    if (!this.devices['muM']) return false;
                    // 如果是电源断线，muM 测 dcP_wire_p 到 dcP_wire_n 应为 0
                    if (this._break && this._break.type === 'dcP_p') {
                        // 只有当万用表连接到 dcP_wire_p 与 dcP_wire_n 时才判断

                        return (this.conns.some(c => (c.from === 'muM_wire_v' && c.to === 'dcP_wire_p') || (c.to === 'muM_wire_v' && c.from === 'dcP_wire_p')) &&
                            this.conns.some(c => (c.from === 'muM_wire_com' && c.to === 'dcP_wire_n') || (c.to === 'muM_wire_com' && c.from === 'dcP_wire_n')) && (this.devices['dcP'] && this.devices['dcP'].isOn) &&
                            (this.devices['muM'].mode === 'DCV') &&
                            Math.abs(this.devices['muM'].getValue() - 0) < 0.5);
                    }
                    // 如果是变送器内部断线，万用表可测得变送器 p/n 端电压等于电源电压
                    if (this._break && this._break.type === 'pTr_internal') {
                        console.log(this._break.type, this.devices['muM'].mode, this.devices['muM'].getValue(), this.devices['dcP'].getValue());
                        return (this.conns.some(c => (c.from === 'muM_wire_v' && c.to === 'pTr_wire_p') || (c.to === 'muM_wire_v' && c.from === 'pTr_wire_p')) &&
                            this.conns.some(c => (c.from === 'muM_wire_com' && c.to === 'pTr_wire_n') || (c.to === 'muM_wire_com' && c.from === 'pTr_wire_n')) && (this.devices['dcP'] && this.devices['dcP'].isOn) &&
                            (this.devices['muM'].mode === 'DCV')) && Math.abs(this.devices['muM'].getValue() - this.devices['dcP'].getValue()) < 0.5;
                    }
                    return false;
                }
            },
            {
                msg: '6. 关闭电源，修复断线故障。',
                act: async () => {
                    await this.sleep(3000);
                    this.devices['dcP'].isOn = false;
                    this.devices['dcP'].update();
                    this.updateAllDevices();
                    await this.sleep(2000);
                    this._break = null;
                    this.devices['pTr'].isBroken = false;
                    const term = this.stage.findOne('#dcP_wire_p');
                    term.setAttr('isBroken', false);
                    this.updateAllDevices();
                    await this.sleep(3000);
                },
                check: () => {
                    // 判断断线是否已修复
                    // 兼容性增强：若 this._break 已被清除（例如修复逻辑将其置空），也视为已修复。
                    if (this.devices['dcP'] && this.devices['dcP'].isOn) return false; // 必须先关闭电源
                    if (!this._break) return true;

                    if (this._break.type === 'dcP_p') {
                        const t = this.stage.findOne('#dcP_wire_p');
                        // 如果端子存在且 isBroken 为 false，则视为修复；若 _break 被外部清除，上面已返回 true
                        return (t && !t.getAttr('isBroken'));
                    }
                    if (this._break.type === 'pTr_internal') {
                        return this.devices['pTr'] && !this.devices['pTr'].isBroken;
                    }
                    return false;
                }
            },
            {
                msg: '7. 开启电源，确认在无气压输入情况下电流恢复为4mA。',
                act: async () => {
                    await this.sleep(3000);
                    this.devices['dcP'].isOn = true;
                    this.devices['dcP'].update();
                    this.updateAllDevices();
                    await this.sleep(2000);
                },
                check: () => (this.devices['dcP'] && this.devices['dcP'].isOn) && (this.devices['aGa'] && Math.abs(this.devices['aGa'].getValue() - 4) < 0.5)
            }
        ];
        this.stepsArray[2] = [
            {
                msg: '1. 接通电路和气路。',
                act: async () => {
                    await this.sleep(1000);
                    const autoConns = [
                        { from: 'dcP_wire_p', to: 'pRr_wire_p', type: 'wire' },
                        { from: 'pRr_wire_n', to: 'pTr_wire_p', type: 'wire' },
                        { from: 'pTr_wire_n', to: 'aGa_wire_p', type: 'wire' },
                        { from: 'aGa_wire_n', to: 'dcP_wire_n', type: 'wire' },
                        { from: 'caB_pipe_o', to: 'stV_pipe_o', type: 'pipe' },
                        { from: 'stV_pipe_i', to: 'pRe_pipe_i', type: 'pipe' },
                        { from: 'pRe_pipe_o', to: 'tCo_pipe_l', type: 'pipe' },
                        { from: 'tCo_pipe_r', to: 'pGa_pipe_i', type: 'pipe' },
                        { from: 'tCo_pipe_u', to: 'pTr_pipe_i', type: 'pipe' },
                    ];
                    // 使用 for...of 替代 forEach
                    for (const conn of autoConns) {
                        const exists = this.conns.some(c =>
                            (c.from === conn.from && c.to === conn.to) ||
                            (c.from === conn.to && c.to === conn.from)
                        );

                        if (!exists) {
                            // 这里会等待当前这一根线画完，再进入下一次循环
                            await this.addConnectionAnimated(conn);
                            // 每一根线画完后，可以稍微停顿一下（可选）
                        }
                    }
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => this.checkConn()
            },
            {
                msg: '2. 触发压力变送器气路漏气故障。',
                act: async () => {
                    console.log(">>> 开始执行第 2 步 act");
                    await this.sleep(2000);
                    this.setFault(2);
                    console.log(">>> 故障已设置完成");
                    this.updateAllDevices();
                    await this.sleep(2000);
                    console.log(">>> 第 2 步 act 执行完毕");
                },
                check: () => {
                    const candidates = [];
                    const tryPush = (id) => { const term = this.stage.findOne('#' + id); if (term) candidates.push(term); };
                    tryPush('pTr_pipe_i');
                    tryPush('pGa_pipe_i');
                    const hasLeaking = candidates.some(term => term.getAttr('isLeaking') === true);
                    return hasLeaking;
                }
            },
            {
                msg: '3. 合上电源和截止阀，观察电流表显示正常。',
                act: async () => {
                    await this.sleep(2000);
                    this.devices['dcP'].isOn = true;
                    this.devices['dcP'].update();
                    this.updateAllDevices();
                    await this.sleep(2000);
                    this.devices['stV'].isOpen = true;
                    this.devices['stV'].update();
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => (this.devices['dcP'] && this.devices['dcP'].isOn) && (this.devices['stV'] && this.devices['stV'].isOpen) && (this.devices['aGa'] && Math.abs(this.devices['aGa'].getValue() - 4) < 0.1)
            },
            {
                msg: `4. 将压力调节到 0.5 MPa，观察漏气现象，判断漏气点。 `,
                act: async () => {
                    await this.sleep(2000);
                    this.devices['pRe'].setPressure = 5;
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(3000);
                },
                check: () => Math.abs((this.devices['pRe'].setPressure) - 5) < (0.05 )
            },
            {
                msg: '5. 使用 Leak Test 工具检测漏气',
                act: async () => {
                    await this.sleep(2000);
                    const candidates = [];
                    const tryPush = (id) => { const term = this.stage.findOne('#' + id); if (term) candidates.push(term); };
                    tryPush('pTr_pipe_i');
                    tryPush('pGa_pipe_i');
                    // 1. 使用 find 找到第一个 isLeaking 为 true 的节点
                    const leakingNode = candidates.find(term =>
                        term.getAttr('isLeaking') === true);
                    // 2. 获取该节点的绝对坐标
                    const pos = leakingNode.getAbsolutePosition();
                    this.devices['leD'].group.position({ x: pos.x - 10, y: pos.y + 20 });
                    this.updateAllDevices();
                    await this.sleep(500);
                    this.devices['leD'].group.position({ x: pos.x - 10, y: pos.y + 30 });
                    this.updateAllDevices();
                    await this.sleep(500);
                    this.devices['leD'].group.position({ x: pos.x - 10, y: pos.y + 20 });
                    await this.sleep(500);
                    this.devices['leD'].group.position({ x: pos.x - 10, y: pos.y + 20 });                    
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(3000);
                },
                check: () => (this.devices['leD'] && this.devices['leD'].isEmitting === true)
            },
            {
                msg: '6. 关闭电源和气源。',
                act: async () => {
                    await this.sleep(2000);
                    this.devices['dcP'].isOn = false;
                    this.devices['dcP'].update();
                    this.updateAllDevices();
                    await this.sleep(2000);
                    this.devices['stV'].isOpen = false;
                    this.devices['stV'].update();
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => (this.devices['dcP'] && !this.devices['dcP'].isOn) && (this.devices['stV'] && !this.devices['stV'].isOpen)
            },
            {
                msg: '7. 修复漏气点。',
                act: async () => {
                    await this.sleep(2000);
                    const candidates = [];
                    const tryPush = (id) => { const term = this.stage.findOne('#' + id); if (term) candidates.push(term); };
                    tryPush('pTr_pipe_i');
                    tryPush('pGa_pipe_i');
                    // 1. 使用 find 找到第一个 isLeaking 为 true 的节点
                    const leakingNode = candidates.find(term =>
                        term.getAttr('isLeaking') === true || term.isLeaking === true
                    );
                    // 2. 获取该节点的绝对坐标
                    leakingNode.setAttr('isLeaking', false);
                    this.updateAllDevices();
                    await this.sleep(3000);
                },
                check: () => {
                    const terms = this.getPipeTerminals();
                    return terms.every(t => !t.getAttr('isLeaking'));
                }
            },
            {
                msg: '8. 合上电源和气源，确定气压表和变送器读数接近相等。',
                act: async () => {
                    await this.sleep(2000);
                    this.devices['dcP'].isOn = true;
                    this.devices['dcP'].update();
                    this.updateAllDevices();
                    await this.sleep(2000);
                    this.devices['stV'].isOpen = true;
                    this.devices['stV'].update();
                    this.updateAllDevices();
                    await this.sleep(1000);
                    this.devices['pRe'].setPressure = (5 * this.pTransMax);
                    this._recordSnapshot();
                    this.updateAllDevices();
                    await this.sleep(1000);
                },
                check: () => (this.devices['dcP'] && this.devices['dcP'].isOn) && (this.devices['stV'] && this.devices['stV'].isOpen) && (Math.abs((this.devices['pRe'].setPressure) - 5)) < 0.05 
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
    //物理计时器，处理随时间变化的属性。
    startPhysicsTimer() {
        const anim = new Konva.Animation((frame) => {
            if (!frame) return;
            // 检查空气瓶是否需要耗气
            const bottle = this.devices['caB'];
            if (bottle && bottle.isConsuming) {
                // 内部仅减小数值，不触发 updateAllDevices
                // 物理数值的变动会在下一帧通过 updateAllDevices 渲染
                this.updateAllDevices();
            }
        }, this.devLayer);

        anim.start();
    }
    // 记录当前快照（conns 和设备关键状态），作为历史栈的一项
    _recordSnapshot() {
        try {
            const connsCopy = JSON.parse(JSON.stringify(this.conns));
            const devStates = {};
            Object.entries(this.devices).forEach(([id, dev]) => {
                devStates[id] = {     //记录设备的参数，这是参数变化是由于用户操作引起的，回放时直接覆盖当前状态即可。
                    isOn: dev.isOn ?? null,
                    voltage: dev.voltage ?? null,  //电源有开关和电压两个参数
                    zeroAdj: dev.zeroAdj ?? null,
                    spanAdj: dev.spanAdj ?? null,  //变送器有零点和量程两个参数
                    isOpen: dev.isOpen ?? null,  //截止阀有开关参数
                    setPressure: dev.setPressure ?? null,  //调压阀有设定压力参数
                };
            });
            const snap = { conns: connsCopy, devStates };
            // 截断前向历史，此次操作后，当前历史索引之后的历史都无效了，所以要删除掉，然后把新快照添加到历史栈中，并更新索引。
            this._history.splice(this._historyIndex + 1);
            this._history.push(snap);
            if (this._history.length > this._historyMax) this._history.shift(); // 超出最大历史长度，删除最旧的一项
            this._historyIndex = this._history.length - 1; // 更新索引到最新

        } catch (e) {
            console.warn('记录快照失败', e);
        }
    }
    // 应用历史快照到当前仿真
    _applySnapshot(index) {
        if (index < 0 || index >= this._history.length) return;
        const snap = this._history[index];
        try {
            this.conns = JSON.parse(JSON.stringify(snap.conns));
            Object.entries(snap.devStates).forEach(([id, state]) => {
                const dev = this.devices[id];
                if (!dev) return;
                if (state.isOn !== null) dev.isOn = state.isOn;
                if (state.voltage !== null) dev.voltage = state.voltage;  //电源状态覆盖
                if (state.zeroAdj !== null) dev.zeroAdj = state.zeroAdj;
                if (state.spanAdj !== null) dev.spanAdj = state.spanAdj; //变送器状态覆盖
                if (state.isOpen !== null) dev.isOpen = state.isOpen;   //截止阀状态覆盖
                if (state.setPressure !== null) dev.setPressure = state.setPressure;    //调压阀状态覆盖

                if (dev.update) dev.update(); //参数覆盖后，调用设备的update方法，让设备根据新状态刷新显示和输出。
            });
            this.updateAllDevices();
        } catch (e) {
            console.warn('应用快照失败', e);
        }
    }
    // engine对象的延时函数，返回一个Promise，在需要等待的地方可以用await engine.sleep(ms)来调用，实现异步等待效果，避免使用setTimeout导致的回调地狱。
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    //端口点击处理函数，用于实现端口连线功能，是本层传给下层设备对象的回调函数。
    onTermClick(termShape) {
        if (!termShape) return;
        // 首次选择
        if (!this.selectedTerminal) {
            this.selectedTerminal = termShape;
            termShape.stroke('#f1c40f');
            termShape.strokeWidth(4);
            this.devLayer.draw();
            return;
        }
        // 取消选择同一端子
        if (this.selectedTerminal === termShape) {
            this.selectedTerminal.stroke('#333');
            this.selectedTerminal.strokeWidth(2);
            this.selectedTerminal = null;
            this.devLayer.draw();
            return;
        }
        // 不同端子，若类型相同则建立连接
        if (this.selectedTerminal.getAttr('connType') === termShape.getAttr('connType')) {
            const [normFrom, normTo] = [this.selectedTerminal.getAttr('termId'), termShape.getAttr('termId')].sort();
            const exists = this.conns.some(c => c.from === normFrom && c.to === normTo);
            if (!exists) {
                this.conns.push({
                    from: normFrom,
                    to: normTo,
                    type: termShape.getAttr('connType')
                });
                this.onAction('conns', this.conns); // 通知上层有新连接
                this._recordSnapshot();
            }
            //如果是气路端子，只允许连接一次，连接后禁用端子点击事件
            if (termShape.getAttr('connType') === 'pipe') {
                termShape.off('mousedown touchstart');
                this.selectedTerminal.off('mousedown touchstart');
            }
        }
        // 清除选择样式
        this.selectedTerminal.stroke('#333');
        this.selectedTerminal.strokeWidth(2);
        this.selectedTerminal = null;

        this.updateAllDevices();
        this.devLayer.draw();
    }

    /**
     * 核心仿真函数：每当开关、档位或连线变化时调用，计算电路的连通性和电位分布，并更新设备状态。主要步骤：
 * 1. 初始化：收集所有电气端子，建立初始电位映射。
 * 2. 构建初始集群：根据物理导线连接关系，将端子分成若干集群。
 * 3. 动态合并：处理开关及“导通型”设备，将它们连接的集群合并。
 * 4. 路径完整性判定：检查电源正负极是否通过变送器和电阻构成闭合回路。
 * 5. 电位计算：如果路径完整，注入电源电位，并根据变送器和电阻的关系计算各端子电位。
 * 6. 更新设备状态：根据端子电位更新变送器、电流表等设备的显示值和工作状态。
     */
    updateCircuitSimulation() {
        const wireConns = this.conns.filter(c => c.type === 'wire');
        this.allTerminalIds = new Set(); // 收集所有电气端子ID
        this.eDevices = {}; // 收集所有电气设备对象，key是设备ID，value是设备对象
        const terminals = {};

        // 1. 初始化：所有端点电位清零
        Object.values(this.devices).forEach(device => {
            // 遍历设备内部定义的 terminals 数组
            if (device.terminals && Array.isArray(device.terminals)) {
                device.terminals.forEach(terminal => {
                    // 仅初始化气路端口
                    if (terminal.getAttr('connType') === 'wire') {
                        // terminal.termId 应该是类似 "acB_pipe_i" 的完整 ID
                        this.allTerminalIds.add(terminal.getAttr('termId')); // 收集所有端子ID
                        this.eDevices[terminal.getAttr('parentId')] = device; // 收集所有电气设备)
                        terminals[terminal.getAttr('termId')] = 0;
                    }
                });
            }
        });
        const psu = this.eDevices['dcP'];
        const pTr = this.eDevices['pTr'];
        const pRr = this.eDevices['pRr'];
        // const aGa = this.eDevices['aGa'];

        // 2. 构建初始集群（物理导线）
        let clusters = this._getElectricalClusters(wireConns);

        // 3. 动态合并：处理开关及“导通型”设备
        this._bridgeZeroResistanceDevices(clusters);

        // 如果电源没开，直接更新状态并退出
        if (!psu || !psu.isOn) {
            this._applyVoltageToDevices(terminals, clusters, 0, false);
            return terminals;
        }

        // 4. 定义关键节点索引
        const getRoot = (id) => clusters.findIndex(c => c.has(id));
        const posRoot = getRoot('dcP_wire_p');
        const negRoot = getRoot('dcP_wire_n');
        const pTr_pRoot = getRoot('pTr_wire_p');
        const pTr_nRoot = getRoot('pTr_wire_n');
        const res_pRoot = getRoot('pRr_wire_p');
        const res_nRoot = getRoot('pRr_wire_n');

        // 5. 路径完整性判定 (Path Trace)
        // 判定电源正负极是否通过 [电阻] 和 [变送器] 构成了闭合回路
        let isPathComplete = false;
        if (posRoot !== -1 && negRoot !== -1) {
            // 判定变送器P端是否可达正极 (直接连或通过电阻连)
            const pTrP_to_Pos = (pTr_pRoot === posRoot) ||
                (pTr_pRoot === res_pRoot && res_nRoot === posRoot) ||
                (pTr_pRoot === res_nRoot && res_pRoot === posRoot);

            // 判定变送器N端是否可达负极 (直接连或通过电阻连)
            const pTrN_to_Neg = (pTr_nRoot === negRoot) ||
                (pTr_nRoot === res_pRoot && res_nRoot === negRoot) ||
                (pTr_nRoot === res_nRoot && res_pRoot === negRoot);

            if (pTrP_to_Pos && pTrN_to_Neg) isPathComplete = true;
        }
        // 2. 物理有效性检查：负载必须两端都接线且不在同一个集群内（未被短路）
        const isPTrConnected = (pTr_pRoot !== -1 && pTr_nRoot !== -1 && pTr_pRoot !== pTr_nRoot);
        const isPRrConnected = (res_pRoot !== -1 && res_nRoot !== -1 && res_pRoot !== res_nRoot);

        // 3. 重新判定主回路连通性 (串联逻辑)
        // 只有当变送器和电阻都“双端接入”且首尾相连通往电源正负时，路径才真正完整
        let realPathComplete = isPathComplete && isPTrConnected && isPRrConnected;
        // 如果变送器内部断线或电源正端断线，则回路不能导通
        if (pTr && pTr.isBroken) realPathComplete = false;
        if (this._break && this._break.type === 'dcP_p') realPathComplete = false;
        this.connected = realPathComplete; // 更新主回路连通状态，供设备更新时参考

        const V_MAX = psu.getValue();
        // 注入电源电位
        // 如果存在电源输出断线故障，则 dcP_wire_p 输出为 0
        if (this._break && this._break.type === 'dcP_p') {
            this._setClusterVoltage(clusters, terminals, 'dcP_wire_p', 0);
        } else {
            this._setClusterVoltage(clusters, terminals, 'dcP_wire_p', V_MAX);
        }
        this._setClusterVoltage(clusters, terminals, 'dcP_wire_n', 0);

        // 特殊情况：若变送器内部断线（回路不导通），电流为 0，但电压应仍可通过导线/电阻到达各端口。
        // 此时不进行电压降扩散计算，而是将变送器与电阻两端的集群电位设置为电源正/负电位（无电压降）。
        if (pTr && pTr.isBroken) {
            // 将变送器正端与电阻正端视为与电源正端同一电位
            this._setClusterVoltage(clusters, terminals, 'pTr_wire_p', V_MAX);
            this._setClusterVoltage(clusters, terminals, 'pRr_wire_p', V_MAX);
            // 将变送器负端与电阻负端视为与电源负端同一电位
            this._setClusterVoltage(clusters, terminals, 'pTr_wire_n', 0);
            this._setClusterVoltage(clusters, terminals, 'pRr_wire_n', V_MAX);
            // 确保后续不会将变送器标记为有电流
        }

        // 6. 电位计算 (电压降扩散)
        let currentA = 0;
        if (realPathComplete) {
            pTr.setPower(true); // 变送器有电了，设置功率为1，表示正常工作状态
            // aGa.setPower(true); // 电流表有电了，设置功率为1，表示正常工作状态

            currentA = pTr.getValue(); // 从变送器读取当前实时电流 (4-20A)
            const vRes = currentA * pRr.getValue() / 1000; // 计算电阻压降


            // 多轮扩散以处理不同位置的电阻
            for (let i = 0; i < 5; i++) {
                // 处理电阻压降逻辑
                if (res_pRoot !== -1 && res_nRoot !== -1) {
                    if (terminals['pRr_wire_p'] > 0 && terminals['pRr_wire_n'] === 0) {
                        this._setClusterVoltage(clusters, terminals, 'pRr_wire_n', terminals['pRr_wire_p'] - vRes);
                    } else if (terminals['pRr_wire_n'] > 0 && terminals['pRr_wire_p'] === 0) {
                        this._setClusterVoltage(clusters, terminals, 'pRr_wire_p', terminals['pRr_wire_n'] - vRes);
                    }
                }
                // 处理变送器电位
                if (pTr_pRoot !== -1 && pTr_nRoot !== -1) {
                    // 如果N端连接了电阻的非负极侧，则N端电位为vRes，否则为0
                    const nIsNearRes = (pTr_nRoot === res_pRoot || pTr_nRoot === res_nRoot);
                    const resIsAtNeg = (res_pRoot === negRoot || res_nRoot === negRoot);
                    if (nIsNearRes && resIsAtNeg) {
                        this._setClusterVoltage(clusters, terminals, 'pTr_wire_n', vRes);
                    }
                }
            }
        }
        // 7. 更新设备显示
        this._applyVoltageToDevices(terminals, clusters, currentA, realPathComplete);
        return terminals;
    }
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
     * 辅助B：合并零电阻设备：导线、电流表、mA档、闭合的开关
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

        Object.values(this.eDevices).forEach(dev => {
            const id = dev.group.id();
            // 开关逻辑：只有不处于 isOpen 状态时才桥接
            if (id === 'swI' && !dev.isOpen) bridge('swI_wire_1', 'swI_wire_2');

            // 电流表和万用表mA档逻辑
            if (id === 'aGa') bridge('aGa_wire_p', 'aGa_wire_n');
            if (id === 'muM' && dev.mode === 'MA') bridge('muM_wire_ma', 'muM_wire_com');
        });
    }
    /**
     * 辅助 C：设置集群电位
     */
    _setClusterVoltage(clusters, terminals, termId, volt) {
        const cluster = clusters.find(c => c.has(termId));
        if (cluster) {
            cluster.forEach(id => terminals[id] = volt);
        } else {
            terminals[termId] = volt;
        }
    }
    /**
     * 辅助D：更新设备状态及显示读数
     */
    _applyVoltageToDevices(terminals, clusters, currentA, realPathComplete) {

        const getRoot = (id) => clusters.findIndex(c => c.has(id));

        // 获取所有负载的端子根索引
        const posRoot = getRoot('dcP_wire_p');
        const negRoot = getRoot('dcP_wire_n');

        const pTr_p = getRoot('pTr_wire_p');
        const pTr_n = getRoot('pTr_wire_n');
        const pRr_p = getRoot('pRr_wire_p');
        const pRr_n = getRoot('pRr_wire_n');

        //   只要电路完整，我们需要识别出构成闭合回路的所有集群根索引
        const activeClusterIndices = new Set();
        // const isPTrConnected = (pTr_p !== -1 && pTr_n !== -1 && pTr_p !== pTr_n);
        const isPRrConnected = (pRr_p !== -1 && pRr_n !== -1 && pRr_p !== pRr_n);

        if (realPathComplete) {
            activeClusterIndices.add(posRoot);
            activeClusterIndices.add(negRoot);

            // 将这些负载的端子所属的集群全部标记为“活跃”
            [pTr_p, pTr_n, pRr_p, pRr_n].forEach(idx => {
                if (idx !== -1) activeClusterIndices.add(idx);
            });
        }

        Object.values(this.eDevices).forEach(dev => {
            const devId = dev.group.id();
            if (devId === 'dcP') return;

            // 获取设备两端的集群根
            const pTerm = (devId === 'muM') ?
                (dev.mode === 'MA' ? 'muM_wire_ma' : 'muM_wire_v') : `${devId}_wire_p`;
            const nTerm = (devId === 'muM') ? 'muM_wire_com' : `${devId}_wire_n`;

            const pRoot = clusters.findIndex(c => c.has(pTerm));
            const nRoot = clusters.findIndex(c => c.has(nTerm));

            // --- 判定逻辑修正 ---
            // 只要设备所属的集群在“活跃集群集合”中，说明它就在电流通路上
            // 设备要显示电流，前提是：1.整体回路闭合 2.设备的两端都在活跃路径集群中
            const inActivePath = realPathComplete && (pRoot !== -1 && nRoot !== -1) &&
                (activeClusterIndices.has(pRoot) && activeClusterIndices.has(nRoot));

            if (devId === 'aGa' || (devId === 'muM' && dev.mode === 'MA')) {
                dev.setPower(inActivePath);
                const val = inActivePath ? currentA : 0;
                devId === 'aGa' ? dev.setValue(val) : dev.setInputValue(val);
            }

            if (devId === 'pTr') {
                dev.setPower(realPathComplete);
                dev.update();
            }
            // --- 万用表电阻档 (RES) ---
            if (devId === 'muM' && dev.mode === 'RES') {
                const vM = clusters.findIndex(c => c.has('muM_wire_v'));
                const cM = clusters.findIndex(c => c.has('muM_wire_com'));
                // 只有当表笔精准对接电阻两端（且电阻两端没被连在一起短路）时才有读数

                if (vM !== -1 && cM !== -1 && vM === cM) {
                    // 1. 同一集群：说明通过导线或闭合开关直接连通
                    dev.setInputValue(0); // 显示接近0的数值

                } else {
                    const isMeasuringRes = isPRrConnected && (
                        (vM === pRr_p && cM === pRr_n) || (vM === pRr_n && cM === pRr_p)
                    );
                    dev.setInputValue(!inActivePath ? (isMeasuringRes ? this.devices['pRr'].getValue() : 10000000000) : 10000000000); // 如果在测量电阻且路径有效，显示电阻值，否则显示无穷大（10GΩ）
                }

            }
            if (devId === 'muM' && dev.mode === 'DCV') {
                const vTerm = 'muM_wire_v';
                const cTerm = 'muM_wire_com';

                // 获取两个表笔所属的集群索引
                const vRoot = clusters.findIndex(c => c.has(vTerm));
                const cRoot = clusters.findIndex(c => c.has(cTerm));

                // 严谨判定：
                // 只有当两个表笔都接在了“已定义”的电路节点上（即在 clusters 中）时，才显示电压
                // 如果任何一个端子没接线，它的 root 会是 -1，此时 isValid 为 false
                const isValid = (vRoot !== -1 && cRoot !== -1);

                if (isValid) {
                    const voltageDiff = terminals[vTerm] - terminals[cTerm];
                    dev.setInputValue(voltageDiff);
                } else {
                    // 只要有一根表笔悬空，读数立刻归零
                    dev.setInputValue(0);
                }
            }
            // --- 万用表蜂鸣器档 (BEEP) ---
            if (devId === 'muM' && dev.mode === 'BEEP') {
                const vM = clusters.findIndex(c => c.has('muM_wire_v'));
                const cM = clusters.findIndex(c => c.has('muM_wire_com'));

                // 只有在断电情况下测量才有意义 (模拟真实保护逻辑)
                const isPowerOff = this.devices['dcP'] && !this.devices['dcP'].isOn;

                if (vM !== -1 && cM !== -1 && vM === cM) {
                    // 1. 同一集群：说明通过导线或闭合开关直接连通
                    dev.setInputValue(0); // 显示接近0的数值
                    if (isPowerOff) dev.triggerBeep(true);
                } else {
                    // 2. 不同集群或悬空：不响
                    dev.setInputValue(10000000000);
                    dev.triggerBeep(false);
                }
            }
        });
    }


    /** 通用气路拓扑计算逻辑 */
    computeTermPress() {
        // 1. 初始化所有端子的压力为 0
        const terminalPressures = {};
        const queue = [];

        Object.values(this.devices).forEach(device => {
            // 遍历设备内部定义的 terminals 数组
            if (device.terminals && Array.isArray(device.terminals)) {
                device.terminals.forEach(terminal => {
                    // 仅初始化气路端口
                    if (terminal.getAttr('connType') === 'pipe') {
                        // terminal.termId 应该是类似 "acB_pipe_i" 的完整 ID
                        terminalPressures[terminal.getAttr('termId')] = 0;
                    }
                });
            }
        });

        // 2. 识别所有气源 (例如空气瓶)
        Object.values(this.devices).forEach(device => {
            if (device.type === 'airBottle') {
                const outPortId = `${device.group.id()}_pipe_o`;
                terminalPressures[outPortId] = device.pressure;
                queue.push(outPortId); // 将气源出口加入扩散队列
            }
        });

        // 3. 广度优先搜索 (BFS) 传播压力
        const visited = new Set();
        while (queue.length > 0) {
            const currentPortId = queue.shift();
            if (visited.has(currentPortId)) continue;
            visited.add(currentPortId);

            const currentPressure = terminalPressures[currentPortId];

            // 查找所有连接到当前端口的连线
            this.conns.forEach(conn => {
                if (conn.type !== 'pipe') return;

                let nextPortId = null;
                if (conn.from === currentPortId) nextPortId = conn.to;
                else if (conn.to === currentPortId) nextPortId = conn.from;

                if (nextPortId) {
                    // 压力通过管路平传
                    terminalPressures[nextPortId] = currentPressure;

                    // 如果该端口被标记为泄漏，则实际输入压力随机降低 10% ~ 30%
                    try {
                        const termNode = this.stage.findOne('#' + nextPortId);
                        if (termNode && termNode.getAttr && termNode.getAttr('isLeaking')) {
                            const lossRatio = 0.2 + Math.random() * 0.1; // 0.1 ~ 0.3
                            terminalPressures[nextPortId] = Math.max(0, currentPressure * (1 - lossRatio));
                        }
                    } catch (e) {
                        /* ignore */
                    }

                    // 查找该端口所属的设备，处理内部逻辑转换
                    const deviceId = nextPortId.split('_pipe_')[0];
                    const device = this.devices[deviceId];

                    if (device) {
                        this._processDevicePress(device, nextPortId, terminalPressures, queue);
                    }
                }
            });
        }
        return terminalPressures;
    }
    /**处理压力在设备内部的传递 */
    _processDevicePress(device, inputPortId, terminalPressures, queue) {
        const currentP = terminalPressures[inputPortId];
        switch (device.type) {
            case 'teeConnector': // 三通处理
                // 三通有三个口：_pipe_l, _pipe_u, _pipe_r
                ['l', 'u', 'r'].forEach(suffix => {
                    const portId = `${device.group.id()}_pipe_${suffix}`;
                    if (portId !== inputPortId) {
                        terminalPressures[portId] = currentP;
                        queue.push(portId);
                    }
                });
                break;
            case 'stopValve': // 截止阀
                if (device.isOpen) {
                    const otherPort = inputPortId.includes('_i') ? '_o' : '_i';
                    const outId = `${device.group.id()}_pipe${otherPort}`;
                    terminalPressures[outId] = currentP;
                    queue.push(outId);
                }
                break;
            case 'regulator': // 减压阀
                if (inputPortId.includes('_i')) {
                    const outId = `${device.group.id()}_pipe_o`;
                    // 减压阀计算逻辑
                    device.outputPressure = Math.min(currentP, device.setPressure);
                    terminalPressures[outId] = device.outputPressure;
                    queue.push(outId);
                }
                break;
            case 'pGauge': // 压力表/变送器 (末端设备)
                // device.update(currentP); // 直接更新显示
                break;
        }
    }
    // 设备状态变化上报处理函数,例如电源开关状态变化,变送器输入压力变化等,也可以调用上层设备逻辑函数onAction，让main.js处理
    //编写remOperation函数，接收设备ID和状态对象，根据设备类型和状态变化的内容，判断是否需要调用updateAllDevices来更新仿真状态。比如当电源开关状态变化时，需要重新计算电路连通性和压力分布，所以调用updateAllDevices；当变送器输入压力变化时，也需要重新计算压力分布，所以调用updateAllDevices；但如果是压力表的显示状态变化，就不需要调用updateAllDevices了，因为压力表的显示是由输入压力直接决定的，不会反过来影响其他设备。
    /**
     * 获取引擎下所有设备的气路端口
     * @returns {Konva.Node[]} 返回所有标记为 pipe 的端口节点数组
     */
    getPipeTerminals() {
        const pipeTerminals = [];

        // 1. 遍历所有注册的设备 (假设存储在 this.devices 中)
        Object.values(this.devices).forEach(device => {
            // 2. 检查设备是否有 terminals 属性 (存储了 Konva 节点)
            if (device.terminals) {
                Object.values(device.terminals).forEach(terminalNode => {
                    // 3. 筛选出 connType 为 pipe 的端口
                    if (terminalNode.getAttr('connType') === 'pipe') {
                        pipeTerminals.push(terminalNode);
                    }
                });
            }
        });

        return pipeTerminals;
    }

    _bindRepairLogic() {
        // 绑定所有端子（气路与电气），用于双击修复 leak / break 故障
        const allTerms = [];
        Object.values(this.devices).forEach(dev => {
            if (dev.terminals && Array.isArray(dev.terminals)) dev.terminals.forEach(t => allTerms.push(t));
        });

        allTerms.forEach(term => {
            term.off('dblclick dbltap');
            term.on('dblclick dbltap', (e) => {
                // 漏气修复
                if (term.getAttr('isLeaking')) {
                    term.setAttr('isLeaking', false);
                    // 若 LeakDetector 有清理方法则调用
                    if (this.devices['leD'] && typeof this.devices['leD'].clearAllBubbles === 'function') {
                        this.devices['leD'].clearAllBubbles();
                    }
                    this.updateAllDevices();
                    return;
                }

                // 电气断线修复（针对外部导线端口被标记为 isBroken）
                if (term.getAttr('isBroken')) {
                    term.setAttr('isBroken', false);
                    // 如果是电源输出断线，清除全局断线标记
                    if (this._break && this._break.type === 'dcP_p' && term.id() === 'dcP_wire_p') {
                        this._break = null;
                    }
                    this.updateAllDevices();
                    return;
                }

                // 变送器内部断线：双击变送器的 p 端修复
                if (term.id && term.id().startsWith('pTr_wire_')) {
                    if (this.devices['pTr'] && this.devices['pTr'].isBroken) {
                        this.devices['pTr'].isBroken = false;
                        if (this._break && this._break.type === 'pTr_internal') this._break = null;
                        this.updateAllDevices();
                        return;
                    }
                }
            });
        });
    }

    reportDevState(devId, state) {
        //如果是电源状态变化，重新画线
        console.log(`Device ${devId} state changed:`, state);
        this.onAction(devId, state); // 通知上层设备状态变化
        this.updateAllDevices();
    }
    // 更新所有设备状态，通过遍历devices数组，调用每个设备的update方法。
    updateAllDevices() {
        if (this.isProcessing) return; // 锁住，防止内部更新再次触发自身
        this.isProcessing = true;
        try {
            // 1. 物理计算层：根据当前拓扑计算每个节点的压力
            this.pressureMap = this.computeTermPress();
            this.voltageMap = this.updateCircuitSimulation(); // 计算电路状态并更新设备显示

            // 2. 表现层更新：将计算结果推送给设备,电流直接在上个函数updateCircuitSimulation里更新了，这里只需要更新压力相关的设备即可。
            this.devices['pRe'].setValue(this.pressureMap['pRe_pipe_i']);
            this.devices['pGa'].setValue(this.pressureMap['pGa_pipe_i']);
            this.devices['pTr'].setValue(this.pressureMap['pTr_pipe_i'] / 10);
            this.voltageMap = this.updateCircuitSimulation(); // 计算电路状态并更新设备显示            

            // 3. 连线层重绘
            // 注意：不要清空整个 uiLayer（会移除 topInfo），仅重绘连线图层
            this.reDrawConnections();
        } catch (error) {
            console.error("仿真更新失败:", error);
        } finally {
            this.isProcessing = false; // 释放锁
        }
    }
    // 撤销/重做/演示/重置等控制方法
    undo() {
        if (this._historyIndex > 0) {
            this._historyIndex -= 1;
            this._applySnapshot(this._historyIndex);
            console.log('undo ->', this._historyIndex);
        } else {
            console.log('已到历史最早记录');
        }
    }
    // 恢复上一步的操作
    redo() {
        if (this._historyIndex < this._history.length - 1) {
            this._historyIndex += 1;
            this._applySnapshot(this._historyIndex);
            console.log('redo ->', this._historyIndex);
        } else {
            console.log('已到最新记录');
        }
    }
    autoWire() {
        // 自动连线示例：连接电源正极到变送器正极，变送器负极到电流表正极，电流表负极到电源负极,并且连接截止阀和调压阀的气路，连接调压阀和T型管的气路，连接T型管和压力表的气路，连接T型管和变送器的气路。
        const autoConns = [
            { from: 'dcP_wire_p', to: 'pRr_wire_p', type: 'wire' },
            { from: 'pRr_wire_n', to: 'pTr_wire_p', type: 'wire' },
            { from: 'pTr_wire_n', to: 'aGa_wire_p', type: 'wire' },
            { from: 'aGa_wire_n', to: 'dcP_wire_n', type: 'wire' },
            { from: 'caB_pipe_o', to: 'stV_pipe_o', type: 'pipe' },
            { from: 'stV_pipe_i', to: 'pRe_pipe_i', type: 'pipe' },
            { from: 'pRe_pipe_o', to: 'tCo_pipe_l', type: 'pipe' },
            { from: 'tCo_pipe_r', to: 'pGa_pipe_i', type: 'pipe' },
            { from: 'tCo_pipe_u', to: 'pTr_pipe_i', type: 'pipe' },
        ];
        autoConns.forEach(conn => {
            const exists = this.conns.some(c => c.from === conn.from && c.to === conn.to);
            if (!exists) {
                this.conns.push(conn);
            }
        });
        this.devices['dcP'].isOn = true;
        this.devices['dcP'].update();
        this.devices['stV'].isOpen = true;
        this.devices['stV'].update();
        this._recordSnapshot();
        this.updateAllDevices();
    }
    // 5步步进：每点击一次，依次设置regulator压力：0，0.25MPa,0.5MPa,0.75MPa,1MPa。循环设置。
    stepFive() {
        const pressures = [0, 2.5 * this.pTransMax, 5 * this.pTransMax, 7.5 * this.pTransMax, 10 * this.pTransMax]; // 对应0,0.25MPa,0.5MPa,0.75MPa,1MPa
        const current = this.devices['pRe'].setPressure || 0;
        const nextIndex = (pressures.indexOf(current) + 1) % pressures.length;
        this.devices['pRe'].setPressure = pressures[nextIndex];
        this.devices['pRe'].update();
        this.devices['pTr'].setValue(this.devices['pRe'].getValue() / 10);
        this.devices['aGa'].setValue(this.devices['pTr'].getValue());
        this.updateAllDevices();
    }
    // 打开理论测试对话框：5道选择题，依次出题，最后提交评分（>=4 合格）
    openTheoryTest() {
        if (this._theoryModalEl) return;
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.background = 'rgba(0,0,0,0.45)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = 10000;

        const panel = document.createElement('div');
        panel.style.width = '560px';
        panel.style.maxWidth = '92%';
        panel.style.padding = '18px';
        panel.style.borderRadius = '8px';
        panel.style.background = '#ffffff';
        panel.style.boxShadow = '0 8px 28px rgba(0,0,0,0.3)';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.color = '#222';

        const questions = [
            {
                q: '压力变送器的主要功能是：', choices: ['放大电压信号', '将压力转换为标准电信号（如4-20mA）', '测量温度并输出电压', '作为压力源使用'], a: 1
            },
            {
                q: '压力变送器在无压力输入时，输出电流为0mA，最可能的原因是：',
                choices: ['零点调得过高', '供电极性接反或回路断路', '量程设置过大', '传感膜片损坏'],
                a: 1
            },
            {
                q: '使用万用表测量4-20mA回路电流时，万用表应：',
                choices: ['并联在变送器两端', '串联接入回路中', '接在电源两端', '接在负载电阻两端'],
                a: 1
            },
            {
                q: '进行压力变送器校验时，通常需要的标准设备是：',
                choices: ['示波器', '标准压力源和精密电流表', '频率计', '温度校准炉'],
                a: 1
            },
            {
                q: '压力变送器量程为0-3MPa，缓慢加压至1.5MPa，输出电流大约为：',
                choices: ['4mA', '8mA', '12mA', '16mA'],
                a: 2
            },
            {
                q: '对压力变送器进行功能测试时，以下哪项是正确步骤：',
                choices: ['直接加满量程压力', '断开回路电源', '逐点施加压力并记录输出电流', '仅检查零点即可'],
                a: 2
            }
        ];

        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <strong>理论测试</strong>
                <button id="theoryClose" style="padding:4px 8px">关闭</button>
            </div>
            <div id="theoryBody" style="min-height:140px"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
                <div id="theoryProgress" style="color:#666"></div>
                <div>
                    <button id="theoryPrev" style="margin-right:8px;padding:6px 10px;display:none">上一步</button>
                    <button id="theoryNext" style="padding:6px 10px" disabled>下一题</button>
                </div>
            </div>
        `;

        overlay.appendChild(panel);
        this.container.style.position = this.container.style.position || 'relative';
        this.container.appendChild(overlay);
        this._theoryModalEl = overlay;

        let idx = 0;
        const answers = new Array(questions.length).fill(null);

        const body = panel.querySelector('#theoryBody');
        const prog = panel.querySelector('#theoryProgress');
        const btnPrev = panel.querySelector('#theoryPrev');
        const btnNext = panel.querySelector('#theoryNext');

        const renderQuestion = () => {
            const q = questions[idx];
            prog.textContent = `第 ${idx + 1} / ${questions.length} 题`;
            body.innerHTML = '';
            const qEl = document.createElement('div');
            qEl.style.marginBottom = '10px';
            qEl.innerHTML = `<div style="font-weight:600;margin-bottom:8px">${q.q}</div>`;
            const choicesEl = document.createElement('div');
            q.choices.forEach((ch, ci) => {
                const btn = document.createElement('button');
                btn.style.display = 'block';
                btn.style.width = '100%';
                btn.style.textAlign = 'left';
                btn.style.padding = '8px 10px';
                btn.style.marginBottom = '8px';
                btn.style.border = '1px solid #cfcfcf';
                btn.style.borderRadius = '6px';
                btn.style.background = answers[idx] === ci ? '#e6f4ff' : '#fff';
                btn.textContent = ch;
                btn.addEventListener('click', () => {
                    answers[idx] = ci;
                    // 高亮选中
                    Array.from(choicesEl.children).forEach((cbtn, i) => {
                        cbtn.style.background = i === ci ? '#e6f4ff' : '#fff';
                    });
                    btnNext.disabled = false;
                    if (idx === questions.length - 1) btnNext.textContent = '提交';
                    else btnNext.textContent = '下一题';
                });
                choicesEl.appendChild(btn);
            });
            qEl.appendChild(choicesEl);
            body.appendChild(qEl);

            // 上一步按钮显隐
            btnPrev.style.display = idx > 0 ? 'inline-block' : 'none';
            btnNext.disabled = answers[idx] === null;
            btnNext.textContent = idx === questions.length - 1 ? '提交' : '下一题';
        };

        btnPrev.addEventListener('click', () => {
            if (idx > 0) {
                idx -= 1;
                renderQuestion();
            }
        });

        btnNext.addEventListener('click', () => {
            if (answers[idx] === null) return; // should not happen due to disabled
            if (idx < questions.length - 1) {
                idx += 1;
                renderQuestion();
                return;
            }
            // 最后一题，提交评分
            let score = 0;
            for (let i = 0; i < questions.length; i++) if (answers[i] === questions[i].a) score++;
            body.innerHTML = `<div style="text-align:center;padding:18px"><div style="font-size:20px;font-weight:700">答题完成</div><div style="margin-top:12px">你的得分：${score} / ${questions.length}</div><div style="margin-top:8px;font-weight:700;color:${score >= 4 ? "#2d862d" : "#c0392b"}">${score >= `${0.8 * questions.length}` ? "合格" : "不合格"}</div></div>`;
            btnPrev.style.display = 'none';
            btnNext.style.display = 'none';
            prog.textContent = '';
        });

        panel.querySelector('#theoryClose').addEventListener('click', () => {
            try { this.container.removeChild(overlay); } catch (e) { }
            this._theoryModalEl = null;
        });

        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) { try { this.container.removeChild(overlay); } catch (e) { } this._theoryModalEl = null; } });

        renderQuestion();
    }

    // 实验重置：清除连线并重新初始化设备布局（保留舞台）
    resetExperiment() {

        this.lineLayer.destroyChildren(); // 清除连线
        this.devLayer.destroyChildren();
        this.init();

        this.connected = false;
        this.conns = [];
        this._history = [];
        this._historyIndex = -1;
        this.stepIdx = 0;
        // 重新初始化默认设备
        this.updateAllDevices();
        this._recordSnapshot();
        console.log('实验已重置');
    }

    /**
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
        else if (mode === 'train' || mode === 'eval'){
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
    stepByStep() {
        // 1. 如果动画正在运行，直接拦截
        if (this._isStepRunning) return;

        // 2. 检查面板是否存在，如果不存在，先调用开启面板的方法
        if (!this._workflowPanelEl) {
            console.log("面板未建立，正在初始化...");
            this.openWorkflowPanel('step'); // 假设这是你打开面板的方法，模式设为演示
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
        console.log("this._workflowindex",this._workflowIdx);
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
            this.reDrawConnections();

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

        this.reDrawConnections();
    }
    resetWorkflow() {
        this._workflowIdx = 0;
        this.conns = []; // 清空所有连线

        this.devices['dcP'].isOn = false;
        this.devices['dcP'].update();
        this.devices['stV'].isOpen = false;
        this.devices['stV'].update();

        this.updateAllDevices();
        if (this._workflowPanelEl) this._renderWorkflowList();
    }
    // _startWorkflowWatcher() {
    //     if (this._workflowTimer) clearInterval(this._workflowTimer);

    //     this._workflowTimer = setInterval(() => {
    //         if (this._workflowIdx >= this._workflow.length) {
    //             clearInterval(this._workflowTimer);
    //             return;
    //         }

    //         const step = this._workflow[this._workflowIdx];
    //         // 核心：使用 check 函数评估用户行为
    //         if (step.check && step.check.call(this)) {
    //             this._workflowIdx++;
    //             this._renderWorkflowList();

    //             // 自动滚动到底部
    //             const wfList = this._workflowPanelEl.querySelector('#wfList');
    //             wfList.scrollTop = wfList.scrollHeight;
    //         }
    //     }, 1000);
    // }
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
    // _stopWorkflowWatcher() {
    //     if (this._workflowTimer) {
    //         clearInterval(this._workflowTimer);
    //         this._workflowTimer = null;
    //     }
    // }
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

    // 重绘所有连线
    reDrawConnections() {
        this.lineLayer.destroyChildren(); // 清除现有连线
        this.conns.forEach(conn => {
            const fromTerm = this.stage.findOne('#' + conn.from);
            const toTerm = this.stage.findOne('#' + conn.to);

            const getShapeCenter = (shape) => {
                const selfRect = shape.getSelfRect();
                const centerX = selfRect.x + selfRect.width / 2;
                const centerY = selfRect.y + selfRect.height / 2;
                const transform = shape.getAbsoluteTransform();
                return transform.point({ x: centerX, y: centerY });
            };

            if (fromTerm && toTerm) {
                let fromPos = fromTerm.getAbsolutePosition();
                let toPos = toTerm.getAbsolutePosition();

                // 1. 判定是否涉及万用表端子
                const isMuMConn = conn.from.includes('muM') || conn.to.includes('muM');
                const muMTermId = conn.from.includes('muM') ? conn.from : (conn.to.includes('muM') ? conn.to : null);

                // 2. 颜色与样式配置逻辑
                let strokeColor;
                let strokeWidth = conn.type === 'wire' ? 4 : 10;
                let lineTension = 0; // 默认直线
                let linePoints = [fromPos.x, fromPos.y, toPos.x, toPos.y];
                if (conn.type === 'wire') {
                    if (isMuMConn) {
                        // 万用表特殊连线逻辑
                        strokeWidth = 6;
                        lineTension = 0.4; // 开启贝塞尔曲线效果
                        // --- 核心修改：万用表表笔线增加中点以触发 tension ---
                        const midX = (fromPos.x + toPos.x) / 2;
                        const midY = Math.max(fromPos.y, toPos.y) + 20; // 模拟重力，让中点下垂 30 像素

                        // 重新构造点序列：[起点, 中点, 终点]
                        linePoints = [fromPos.x, fromPos.y, midX, midY, toPos.x, toPos.y];
                        // 根据端子功能上色
                        if (muMTermId.includes('com')) {
                            strokeColor = '#006400'; // 墨绿色
                        } else if (muMTermId.includes('v') || muMTermId.includes('ma')) {
                            strokeColor = '#FF4500'; // 火红色 (OrangeRed)
                        }
                    } else {
                        // 普通导线颜色
                        strokeColor = this.connected ? '#f42811' : '#ceafac';
                    }
                } else if (conn.type === 'pipe') {
                    // 气路逻辑
                    fromPos = getShapeCenter(fromTerm);
                    toPos = getShapeCenter(toTerm);
                    linePoints = [fromPos.x, fromPos.y, toPos.x, toPos.y];
                    strokeColor = ((this.pressureMap[conn.from] !== null) && this.pressureMap[conn.from] > 0) ? '#2765f4' : '#767a7a';
                }

                // 3. 创建连线
                const line = new Konva.Line({
                    points: linePoints,
                    stroke: strokeColor,
                    strokeWidth: strokeWidth,
                    lineCap: 'round',
                    lineJoin: 'round',
                    tension: lineTension, // 关键：设置此值大于0即变为贝塞尔曲线
                    shadowBlur: conn.type === 'pipe' ? 4 : 0,
                    shadowColor: '#333'
                });

                this.lineLayer.add(line);

                // 双击删除连线逻辑
                line.on('dblclick dbltap', () => {
                    this.conns = this.conns.filter(c => c !== conn);
                    this.reDrawConnections();
                    this.updateAllDevices();

                    if (conn.type === 'pipe') {
                        const fromTermShape = this.stage.findOne('#' + conn.from);
                        const toTermShape = this.stage.findOne('#' + conn.to);
                        const restoreClick = (shape) => {
                            shape.off('mousedown touchstart');
                            shape.on('mousedown touchstart', () => this.onTermClick(shape));
                        };
                        restoreClick(fromTermShape);
                        restoreClick(toTermShape);
                    }
                    this._recordSnapshot();
                });
            }
        });
        this.lineLayer.draw();
    }
    //窗口大小改变时，调整舞台大小
    resize() {
        this.stage.width(this.container.offsetWidth);
        this.stage.height(this.container.offsetHeight);
        this.reDrawConnections();
    }
    // 动画方式添加连线：3s 完成一次连线，结束后把连线加入 this.conns 并重绘
    addConnectionAnimated(conn) {
        return new Promise((resolve) => {
            const fromTerm = this.stage.findOne('#' + conn.from);
            const toTerm = this.stage.findOne('#' + conn.to);
            if (!fromTerm || !toTerm) {
                // 找不到端子，直接加入（回退）
                this.conns.push(conn);
                this.reDrawConnections();
                resolve();
                return;
            }
            const getShapeCenter = (shape) => {
                const selfRect = shape.getSelfRect();
                const centerX = selfRect.x + selfRect.width / 2;
                const centerY = selfRect.y + selfRect.height / 2;
                const transform = shape.getAbsoluteTransform();
                return transform.point({ x: centerX, y: centerY });
            };
            const fromPos = (conn.type === 'pipe') ? getShapeCenter(fromTerm) : fromTerm.getAbsolutePosition();
            const toPos = (conn.type === 'pipe') ? getShapeCenter(toTerm) : toTerm.getAbsolutePosition();

            // 临时动画线（只画一条从起点到起点，逐步扩展到终点）
            const animLine = new Konva.Line({
                points: [fromPos.x, fromPos.y, fromPos.x, fromPos.y],
                stroke: conn.type === 'wire' ? '#e41c1c' : '#78e4c9',
                strokeWidth: conn.type === 'wire' ? 6 : 10,
                lineCap: 'round',
                lineJoin: 'round',
                shadowBlur: conn.type === 'pipe' ? 6 : 0,
                shadowColor: '#333',
                opacity: 0.95,
            });
            this.lineLayer.add(animLine);
            this.lineLayer.draw();

            const duration = 3000; // ms
            const start = performance.now();
            const animate = (now) => {
                const t = Math.min(1, (now - start) / duration);
                const curX = fromPos.x + (toPos.x - fromPos.x) * t;
                const curY = fromPos.y + (toPos.y - fromPos.y) * t;
                animLine.points([fromPos.x, fromPos.y, curX, curY]);
                this.lineLayer.batchDraw();
                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    // 动画结束：移除临时线，加入正式连线并重绘
                    animLine.destroy();
                    this.conns.push(conn);
                    this.reDrawConnections();
                    this._recordSnapshot();
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
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
    addConn(conn) {
        if (!this.conns.some(c => this._connEqual(c, conn))) this.conns.push(conn);
        this.reDrawConnections();
    }

    removeConn(conn) {
        const idx = this.conns.findIndex(c => this._connKeyCanonical(c) === this._connKeyCanonical(conn) && c.type === conn.type);
        if (idx !== -1) this.conns.splice(idx, 1);
        this.reDrawConnections();
    }

    /**
     * 判定当前连线是否与标准答案完全等效
     * @returns {boolean}
     */
    checkConn() {
        const target = [
            { from: 'dcP_wire_p', to: 'pRr_wire_p', type: 'wire' },
            { from: 'pRr_wire_n', to: 'pTr_wire_p', type: 'wire' },
            { from: 'aGa_wire_p', to: 'pTr_wire_n', type: 'wire' },
            { from: 'aGa_wire_n', to: 'dcP_wire_n', type: 'wire' },
            { from: 'caB_pipe_o', to: 'stV_pipe_o', type: 'pipe' },
            { from: 'pRe_pipe_i', to: 'stV_pipe_i', type: 'pipe' },
            { from: 'pRe_pipe_o', to: 'tCo_pipe_l', type: 'pipe' },
            { from: 'pGa_pipe_i', to: 'tCo_pipe_r', type: 'pipe' },
            { from: 'pTr_pipe_i', to: 'tCo_pipe_u', type: 'pipe' }
        ];

        // 1. 如果数量都不对，直接判定失败
        if (this.conns.length !== target.length) return false;

        // 2. 将用户当前的连线进行归一化处理（内部 from/to 排序）并生成唯一标识字符串
        const normalize = (conn) => {
            const [a, b] = [conn.from, conn.to].sort();
            return `${conn.type}:${a}:${b}`;
        };

        const currentSet = new Set(this.conns.map(normalize));
        const targetSet = new Set(target.map(normalize));

        // 3. 检查两个集合是否完全一致
        if (currentSet.size !== targetSet.size) return false;
        for (let item of targetSet) {
            if (!currentSet.has(item)) return false;
        }

        return true;
    }

    setFault(n) {
        // 假设这些组件实例存储在 this.comps 中
        switch (n) {
            case 1:
                // n=1: 设置开路故障
                const choices = ['dcP_wire_p', 'pTr_internal'];
                const pick = choices[Math.floor(Math.random() * choices.length)];
                if (pick === 'dcP_wire_p') {
                    const term = this.stage.findOne('#dcP_wire_p');
                    if (!term) { this.showTopInfo('找不到电源输出端口'); return; }
                    term.setAttr('isBroken', true);
                    this._break = { type: 'dcP_p', termId: 'dcP_wire_p' };
                } else {
                    if (this.devices['pTr']) {
                        this.devices['pTr'].isBroken = true;
                        this._break = { type: 'pTr_internal' };
                    }
                }
                break;

            case 2:
                // n=2: 设置漏气故障
                const candidates = [];
                const tryPush = (id) => { const term = this.stage.findOne('#' + id); if (term) candidates.push(term); };

                tryPush('pTr_pipe_i');
                tryPush('pGa_pipe_i');

                if (candidates.length === 0) {
                    this.showTopInfo('未找到可注入漏点的端口');
                    return;
                }
                const idx = Math.floor(Math.random() * candidates.length);
                const term = candidates[idx];
                term.setAttr('isLeaking', true);
                this.updateAllDevices();
                break;

            default:
                console.log("未知故障代码");
                break;
        }

    }
    // 打开参数设置界面（使用 DOM 覆盖在画布上）
    openSettingsModal() {
        if (this._settingsModalEl) return; // 已打开
        const containerRect = this.container.getBoundingClientRect();

        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.background = 'rgba(0,0,0,0.35)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = 9999;

        const panel = document.createElement('div');
        panel.style.width = '360px';
        panel.style.padding = '18px';
        panel.style.borderRadius = '8px';
        panel.style.background = '#33592b';
        panel.style.boxShadow = '0 6px 18px rgba(0,0,0,0.25)';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.color = '#f0f8f7f9';

        panel.innerHTML = `
            <h3 style="margin:0 0 12px 0">参数设置</h3>
            <div style="margin-bottom:10px">
                <label style="display:block;margin-bottom:6px">压力变送器 Range Max (MPa)</label>
                <select id="selPTrans" style="width:100%;padding:6px">
                    <option value="0.5">0.5</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="5">5</option>
                </select>
            </div>
            <div style="margin-bottom:14px">
                <label style="display:block;margin-bottom:6px">压力表 Max (bar)</label>
                <select id="selPGauge" style="width:100%;padding:6px">
                    <option value="10">10</option>
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>                    
                </select>
            </div>
            <div style="text-align:right">
                <button id="btnCancel" style="margin-right:8px;padding:6px 12px">取消</button>
                <button id="btnApply" style="padding:6px 12px;background:#2c7be5;color:#fff;border:none;border-radius:4px">应用</button>
            </div>
        `;

        overlay.appendChild(panel);
        this.container.style.position = this.container.style.position || 'relative';
        this.container.appendChild(overlay);

        // 预选当前值
        const selPTrans = panel.querySelector('#selPTrans');
        const selPGauge = panel.querySelector('#selPGauge');
        selPTrans.value = (this.pTransMax !== undefined) ? String(this.pTransMax) : '1';
        selPGauge.value = (this.pGaugeMax !== undefined) ? String(this.pGaugeMax) : '10';

        // 事件
        const close = () => {
            try { this.container.removeChild(overlay); } catch (e) { }
            this._settingsModalEl = null;
        };
        panel.querySelector('#btnCancel').addEventListener('click', () => close());
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

        panel.querySelector('#btnApply').addEventListener('click', () => {
            const newPTrans = parseFloat(selPTrans.value);
            const newPGauge = parseFloat(selPGauge.value);
            // 保存参数到 engine
            this.pTransMax = newPTrans;
            this.pGaugeMax = newPGauge;
            // 按要求：调用 init() 重置系统（先清空当前设备状态以避免重复）
            try { this.resetExperiment(); } catch (e) { /* fallback */ }
            this.onAction('init', { pTransMax: newPTrans, pGaugeMax: newPGauge }); // 通知上层参数变化
            close();
        });

        this._settingsModalEl = overlay;
    }
    // 关闭设置面板（外部也可调用）
    closeSettingsModal() {
        if (this._settingsModalEl) {
            try { this.container.removeChild(this._settingsModalEl); } catch (e) { }
            this._settingsModalEl = null;
        }
    }
}