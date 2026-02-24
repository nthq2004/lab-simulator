import { BaseComponent } from './BaseComponent.js';

export class PIDController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.w = 320;
        this.h = 280;

        // --- 核心参数 ---
        this.mode = "MAN";
        this.direction = "DIR";
        this.atActive = false;
        this.PV = 0;
        this.SV = 60;
        this.OUT = 50.0;
        this.P = 4;
        this.I = 0;
        this.D = 0;
        this.OL = 0;
        this.OH = 100;
        this.LRV = 0;
        this.URV = 100;
        this.alarmStatus = "----";
        this.alarm = { HH: 95, H: 90, L: 30, LL: 10 };
        this.outFault = false;

        // --- 内部 PID 运算状态 ---
        this.lastError = 0;    // 上一次的误差
        this.integral = 0;     // 积分累加值
        this.lastTime = Date.now(); // 上一次执行的时间戳

        // --- 输出逻辑参数 ---
        this.outSelection = "BOTH"; // 可选: "CH1", "CH2", "BOTH"
        this.outModes = { CH1: "PWM", CH2: "PWM" };

        // 每一路实际的物理输出值
        this.heatPWM = 0;
        this.coolPWM = 0;

        this.menu = new IndustrialMenuSystem(this);
        this.initVisuals();
        this.initInteraction();

        // 左面板：4-20mA 输入 (AI)
        this.addPort(-20, 50, 'pi1', 'wire', 'p');
        this.addPort(-20, 100, 'ni1', 'wire');
        // 右面板：电源 (DC24V) + RS485
        this.addPort(this.w + 20, 50, 'vcc', 'wire', 'p');
        this.addPort(this.w + 20, 100, 'gnd', 'wire');
        this.addPort(this.w + 20, 180, 'a1', 'wire', 'p');
        this.addPort(this.w + 20, 230, 'b1', 'wire');

        // 下面板：双路输出 (CH1 / CH2)
        this.addPort(60, this.h + 20, 'po1', 'wire', 'p');
        this.addPort(110, this.h + 20, 'no1', 'wire');
        this.addPort(220, this.h + 20, 'po2', 'wire', 'p');
        this.addPort(270, this.h + 20, 'no2', 'wire');


    }

    initVisuals() {
        const sidePanelAttr = { width: 20, height: this.h, fill: '#b5aeae', stroke: '#444', strokeWidth: 2, cornerRadius: 2 };
        const leftPanel = new Konva.Rect({ x: -20, y: 0, ...sidePanelAttr });
        const rightPanel = new Konva.Rect({ x: this.w, y: 0, ...sidePanelAttr });

        const body = new Konva.Rect({
            width: this.w, height: this.h,
            fill: '#1a1a1a', stroke: '#333', strokeWidth: 4, cornerRadius: 4
        });

        const mainScreen = new Konva.Rect({ x: 10, y: 10, width: this.w - 20, height: 75, fill: '#050505', cornerRadius: 2 });
        this.pvDisplay = this._createDigit(25, 18, '00.0', 38, '#ff3333');
        this.svDisplay = this._createDigit(175, 18, '80.0', 38, '#33ff33');

        // 必须先加 body 到底层
        this.group.add(leftPanel, rightPanel, body, mainScreen, this.pvDisplay, this.svDisplay);
        // 在 SV 显示区域右下角添加一个固定位置的闪烁点
        this.editDot = new Konva.Circle({
            x: 300, // 根据 SV 框位置调整，确保在右下角
            y: 45,
            radius: 3,
            fill: '#33ff33',
            visible: false // 默认隐藏
        });
        this.group.add(this.editDot);
        // 状态指示灯：增加文字大小和灯亮度
        this.lights = {
            AUTO: this._createLED(20, 65, '#00ff00', 'AUTO'),
            MAN: this._createLED(65, 65, '#ffcc00', 'MAN'),
            AT: this._createLED(110, 65, '#ff00ff', 'AT'),
            AL: this._createLED(155, 65, '#ff3333', 'AL'),
            DIR: this._createLED(205, 65, '#00ffff', 'DIR'),
            REV: this._createLED(255, 65, '#00ffff', 'REV')
        };

        this.boxes = {};
        const paramLayout = [
            { id: 'P', x: 10, y: 95, label: 'P' },
            { id: 'I', x: 88, y: 95, label: 'I' },
            { id: 'D', x: 166, y: 95, label: 'D' },
            { id: 'AL', x: 244, y: 95, label: 'AL', color: '#ff3333' },
            { id: 'OL', x: 10, y: 140, label: 'OL' },
            { id: 'OH', x: 88, y: 140, label: 'OH' },
            { id: 'URV', x: 166, y: 140, label: 'URV' },
            { id: 'OUT', x: 244, y: 140, label: 'OUT', color: '#ffcc00' }
        ];

        paramLayout.forEach(p => {
            const group = new Konva.Group({ x: p.x, y: p.y });
            group.add(new Konva.Rect({ width: 70, height: 38, fill: '#000', stroke: '#444', strokeWidth: 1 }));
            // 强化标签：白色且更大
            group.add(new Konva.Text({ x: 4, y: 4, text: p.label, fontSize: 10, fill: '#ffffff', fontStyle: 'bold' }));

            const val = new Konva.Text({
                x: 0, y: 18, text: '---', fontSize: 16, fontFamily: 'Courier New',
                fill: p.color || '#33ff33', width: 66, align: 'right'
            });
            this.boxes[p.id] = val;
            group.add(val);
            this.group.add(group);
        });

        const btnLabels = ['AT', 'A/M', 'SET', '▲', '▼'];
        this.btnObjs = {};
        btnLabels.forEach((label, i) => {
            const btn = this._createButton(10 + i * 62, 215, label);
            this.btnObjs[label] = btn;
            this.group.add(btn);
        });

        // 增加下侧面板
        const bottomPanel = new Konva.Rect({
            x: 0, y: this.h, width: this.w, height: 20,
            fill: '#b5aeae', stroke: '#444', strokeWidth: 2
        });
        this.group.add(bottomPanel);
                // 双击清除输出故障
        bottomPanel.on('dblclick', () => {
            if (this.outFault) {
                this.outFault = false;
            }
            try { this.sys.layer.batchDraw(); } catch (e) {}
        });

        // 辅助标注 (让接线一目了然)
        this._addLabel(-40, 70, 'IN: 4-20mA', 9);
        this._addLabel(this.w + 20, 70, 'POWER', 9);
        this._addLabel(this.w + 20, 200, 'RS485', 9);
        this._addLabel(65, this.h + 5, 'OUT: CH1', 9);
        this._addLabel(225, this.h + 5, 'OUT: CH2', 9);
    }

    _addLabel(x, y, text, size) {
        this.group.add(new Konva.Text({ x, y, text, fontSize: size, fill: '#0d05f2' }));
    }

    _createDigit(x, y, txt, size, color) {
        return new Konva.Text({ x, y, text: txt, fontSize: size, fontFamily: 'Courier New', fontStyle: 'bold', fill: color });
    }

    _createLED(x, y, color, label) {
        const ledGroup = new Konva.Group();
        const dot = new Konva.Circle({ x, y: y + 4, radius: 4, fill: '#222', stroke: '#000', strokeWidth: 1 });
        const txt = new Konva.Text({ x: x + 8, y: y, text: label, fontSize: 10, fill: '#ddd', fontStyle: 'bold' });
        ledGroup.add(dot, txt);
        this.group.add(ledGroup);
        return dot;
    }

    _createButton(x, y, txt) {
        const g = new Konva.Group({ x, y, name: 'btn_' + txt });
        g.add(new Konva.Rect({ width: 55, height: 45, fill: '#444', stroke: '#000', cornerRadius: 3 }));
        g.add(new Konva.Text({ width: 55, y: 16, text: txt, align: 'center', fill: '#fff', fontSize: 13, fontStyle: 'bold' }));
        return g;
    }

    initInteraction() {
        Object.keys(this.btnObjs).forEach(label => {
            const btn = this.btnObjs[label];
            btn.on('mousedown', () => {
                btn.findOne('Rect').fill('#0f7e4a');
                if (label === 'AT') this.toggleAT();
                if (label === 'A/M') this.menu.pressRUN();
                if (label === '▲') this.menu.pressUP();
                if (label === '▼') this.menu.pressDOWN();
                if (label === 'SET') this.pressTimer = Date.now();
                this.sys.layer.draw();
            });
            btn.on('mouseup mouseleave', () => {
                btn.findOne('Rect').fill('#444');
                if (label === 'SET' && this.pressTimer) {
                    const dur = Date.now() - this.pressTimer;
                    this.menu.pressSET(dur > 1000);
                    this.pressTimer = null;
                }
                this.sys.layer.draw();
            });
        });


    }

    toggleAT() {
        this.atActive = !this.atActive;
        if (this.atActive) this.mode = "AUTO"; // AT通常在自动模式下运行
    }

update(inputmA) {
        // 1. 获取时间增量 dt (秒)
        const now = Date.now();
        const dt = (now - this.lastTime) / 1000; 
        this.lastTime = now;
        if (dt <= 0) return; 

        // 断电清屏逻辑
        if (inputmA && typeof inputmA === 'object') {
            if (inputmA.powered === false) {
                try {
                    this.pvDisplay.text('');
                    this.svDisplay.text('');
                    this.pvDisplay.fill('#000');
                    this.svDisplay.fill('#000');
                    Object.keys(this.lights).forEach(k => this.lights[k].fill('#222'));
                    Object.keys(this.boxes).forEach(k => this.boxes[k].text(''));
                    this.OUT = 50;
                    this.heatPWM = 0; // 清除输出
                    this.coolPWM = 0;
                } catch (e) { }
                this.sys.layer.batchDraw();
                return;
            }
            if (typeof inputmA.mA === 'number') inputmA = inputmA.mA;
        }

        // 2. 信号输入映射
        const validmA = (typeof inputmA === 'number' && !isNaN(inputmA)) ? inputmA : 4;
        this.PV = this.LRV + ((validmA - 4) / 16) * (this.URV - this.LRV);

        // 3. 计算误差
        let error = this.SV - this.PV; 
        if (this.direction === "REV") error = -error; 

        if (this.mode === "AUTO") {
            // --- PID 核心算法 ---
            const P_out = this.P * error;

            if (this.I > 0) {
                this.integral += error * (1 / this.I) * dt;
            } else {
                this.integral = 0;
            }

            // 积分抗饱和 (针对 0-100% 范围)
            this.integral = Math.max(-20, Math.min(20, this.integral));

            const derivative = (error - this.lastError) / dt;
            const D_out = this.D * derivative;

            // 合并输出 (50为偏置基准，即 50% 处不加热也不冷却)
            this.OUT = 50 + P_out + this.integral + D_out;

            // 4. 限制总输出范围 (0-100)
            this.OUT = Math.max(0, Math.min(100, this.OUT));

            this.lastError = error;
        }

        // 5. --- 分程控制逻辑 (Split Range) ---
        // 定义死区 (Deadband)，例如 48% - 52% 之间不动作，防止系统震荡
        const deadband = 2.0; 
        const center = 50.0;

        if (this.OUT > (center + deadband)) {
            // 加热区间：52% -> 100% 映射到 0.0 -> 1.0
            this.heatPWM = (this.OUT - (center + deadband)) / (100 - (center + deadband));
            this.coolPWM = 0;
        } else if (this.OUT < (center - deadband)) {
            // 冷却区间：48% -> 0% 映射到 0.0 -> 1.0
            // 输出越接近0，冷却强度越大
            this.coolPWM = ((center - deadband) - this.OUT) / (center - deadband);
            this.heatPWM = 0;
        } else {
            // 死区：两者都不动作
            this.heatPWM = 0;
            this.coolPWM = 0;
        }

        // 兼容旧代码：物理输出电流映射 (如果 PO1 还需要 4-20mA 信号的话)
        this.outputmA = 4 + (this.OUT / 100) * 16;

        // 报警逻辑
        if (this.PV > this.alarm.HH) this.alarmStatus = "HH";
        else if (this.PV > this.alarm.H) this.alarmStatus = "H";
        else if (this.PV < this.alarm.LL) this.alarmStatus = "LL";
        else if (this.PV < this.alarm.L) this.alarmStatus = "L";
        else this.alarmStatus = "----";

        // 更新指示灯
        this.lights.AUTO.fill(this.mode === "AUTO" ? "#00ff00" : "#222");
        this.lights.MAN.fill(this.mode === "MAN" ? "#ffcc00" : "#222");
        this.lights.AT.fill(this.atActive ? "#ff00ff" : "#222");
        this.lights.AL.fill(this.alarmStatus !== "----" ? "#ff0000" : "#222");
        this.lights.DIR.fill(this.direction === "DIR" ? "#00ffff" : "#222");
        this.lights.REV.fill(this.direction === "REV" ? "#00ffff" : "#222");

        // 更新显示
        const menuText = this.menu.getMenuText();
        if (menuText) {
            const parts = menuText.split(':');
            this.pvDisplay.text(parts[0]);
            this.svDisplay.text(parts[1] || "");
            this.pvDisplay.fill('#3498db');
        } else {

            if (this.PV > this.URV) {
                this.pvDisplay.text('HHHH'.padStart(5, ' '));
            }
            else if (this.PV < this.LRV) {
                this.pvDisplay.text('LLLL'.padStart(5, ' '));
            }
            else {
                this.pvDisplay.text(this.PV.toFixed(1).padStart(5, ' '));
            }
            this.svDisplay.text(this.SV.toFixed(1).padStart(5, ' '));
            this.pvDisplay.fill('#ff3333');
            this.svDisplay.fill('#19f1a2');
        }

        this.boxes.P.text(this.P.toFixed(1));
        this.boxes.I.text(this.I.toString());
        this.boxes.D.text(this.D.toFixed(1));
        this.boxes.AL.text(this.alarmStatus);
        this.boxes.OL.text(this.OL + "%");
        this.boxes.OH.text(this.OH + "%");
        this.boxes.URV.text(this.URV.toString());
        this.boxes.OUT.text(this.OUT.toFixed(1));
    }
}

class IndustrialMenuSystem {
    constructor(pid) {
        this.pid = pid;
        this.level = 0;
        this.groupIndex = 0;
        this.paramIndex = 0;

        // --- 新增：参数确认逻辑变量 ---
        this.pendingValue = null;   // 存储修改中但未确认的值
        this.isModified = false;    // 标识当前参数是否被动过
        this.lastActionTime = 0;    // 用于 5 秒超时还原
        this.dotVisible = false;    // 用于圆点闪烁控制
        this.flashTimer = 0;        // 闪烁频率计时

        this.lastMenuActivity = 0; // 新增：用于 20s 菜单自动返回

        this.groups = [
            { name: "PID", params: ["P", "I", "D", "OL", "OH"] },
            { name: "ALARM", params: ["HH", "H", "L", "LL"] },
            { name: "RANGE", params: ["SV", "LRV", "URV"] },
            { name: "SYS", params: ["mode", "DIR", "OUTSEL", "CH1M", "CH2M"] }
        ];
    }
    // 每次按键都刷新 20s 计时
    refreshMenuTimer() {
        this.lastMenuActivity = Date.now();
    }
    pressUP() {
        this.refreshMenuTimer();
        if (this.level === 0) {
            if (this.pid.mode === "AUTO") this.pid.SV += 1;
            else this.pid.OUT = Math.min(this.pid.OH, this.pid.OUT + 1);
        } else if (this.level === 1) {
            this.groupIndex = (this.groupIndex + 1) % this.groups.length;
        } else if (this.level === 2) this.changeValue(1);
    }

    pressDOWN() {
        this.refreshMenuTimer();
        if (this.level === 0) {
            if (this.pid.mode === "AUTO") this.pid.SV -= 1;
            else this.pid.OUT = Math.max(this.pid.OL, this.pid.OUT - 1);
        } else if (this.level === 1) {
            this.groupIndex = (this.groupIndex - 1 + this.groups.length) % this.groups.length;
        } else if (this.level === 2) this.changeValue(-1);
    }

    pressSET(longPress) {
        this.refreshMenuTimer();
        if (this.level === 2 && !longPress && this.isModified) {
            // --- 关键：只有在修改状态按下 SET 才真正保存 ---
            const p = this.groups[this.groupIndex].params[this.paramIndex];
            this._commitValue(p, this.pendingValue);
            this.isModified = false; // 保存后清除修改状态
            return;
        }

        // 基础菜单跳转逻辑
        if (this.level === 0 && longPress) this.level = 1;
        else if (this.level === 1) { this.level = 2; this.paramIndex = 0; }
        else if (this.level === 2) {
            if (longPress) { this.level = 0; this.isModified = false; }
            else {
                this.paramIndex = (this.paramIndex + 1) % this.groups[this.groupIndex].params.length;
                this.isModified = false; // 切换参数时放弃未保存的修改
            }
        }
    }

    pressRUN() { this.pid.mode = this.pid.mode === "AUTO" ? "MAN" : "AUTO"; }


    changeValue(step) {
        const p = this.groups[this.groupIndex].params[this.paramIndex];

        // 如果是首次修改，备份当前值到 pendingValue
        if (!this.isModified) {
            this.pendingValue = this._getRealValue(p);
            this.isModified = true;
        }

        this.lastActionTime = Date.now(); // 更新操作时间

        // 修改逻辑
        if (typeof this.pendingValue === 'number') {
            this.pendingValue += step;
        } else {
            // 枚举类型切换逻辑 (DIR, OUT-S 等)
            this.pendingValue = this._getNextEnum(p, this.pendingValue);
        }
    }

    // 内部：获取当前参数真实值
    _getRealValue(p) {
        // 建立短代码与实际属性的映射表
        const map = {
            "DIR": this.pid.direction,
            "OUTSEL": this.pid.outSelection,
            "CH1M": this.pid.outModes.CH1,
            "CH2M": this.pid.outModes.CH2,
            "mode": this.pid.mode
        };

        if (map[p] !== undefined) return map[p];

        // 如果是数字参数（如 P, I, D 或 alarm 对象里的值）
        return this.pid[p] !== undefined ? this.pid[p] : this.pid.alarm[p];
    }

    // 内部：写入参数到 PID 实例
    _commitValue(p, val) {
        if (p === "DIR") this.pid.direction = val;
        else if (p === "OUTSEL") this.pid.outSelection = val;
        else if (p === "CH1M") this.pid.outModes.CH1 = val;
        else if (p === "CH2M") this.pid.outModes.CH2 = val;
        else if (p === "mode") this.pid.mode = val;
        else if (this.pid[p] !== undefined) this.pid[p] = val;
        else if (this.pid.alarm[p] !== undefined) this.pid.alarm[p] = val;
    }
    /**
  * 内部辅助方法：处理非数字枚举值的循环切换
  * @param {string} p - 参数键名 (如 "DIR", "OUTSEL")
  * @param {string} current - 当前显示的临时值
  * @returns {string} 下一个枚举值
  */
    _getNextEnum(p, current) {
        // 1. 定义每个短参数名对应的可选值列表
        const enumMaps = {
            "mode": ["AUTO", "MAN"],             // 运行模式：自动/手动
            "DIR": ["DIR", "REV"],             // 控制方向：正向/反向
            "OUTSEL": ["CH1", "CH2", "BOTH"],     // 输出通道选择
            "CH1M": ["4-20mA", "PWM"],          // 通道1输出模式
            "CH2M": ["4-20mA", "PWM"]         // 通道2输出模式           
        };

        // 2. 获取该参数对应的列表
        const list = enumMaps[p];

        // 3. 如果不在列表中（例如误传了数字参数），则直接返回原值
        if (!list) return current;

        // 4. 计算下一个值的索引，实现循环切换
        let idx = list.indexOf(current);

        // 如果当前值由于某种原因不在列表中（例如初始化错误），从第一个开始
        if (idx === -1) return list[0];

        // 核心逻辑：(当前索引 + 1) 对 列表长度 取模
        return list[(idx + 1) % list.length];
    }



    getMenuText() {
        if (this.level === 0) {
            this.pid.editDot.visible(false); // 回到主界面关闭圆点
            return null;
        }

        const now = Date.now();

        // --- 新增：20s 自动返回主界面逻辑 ---
        if (now - this.lastMenuActivity > 20000) {
            this.level = 0;
            this.isModified = false;
            this.pid.editDot.visible(false);
            console.log("Menu timeout: returning to main screen");
            return null;
        }

        // --- 5秒超时还原逻辑 ---
        if (this.isModified && (Date.now() - this.lastActionTime > 5000)) {
            this.isModified = false; // 放弃修改，跳回原值
            this.pendingValue = null;
            // 注意：这里只还原数值，不退出菜单            
        }

        if (this.level === 1) return "GRP:" + this.groups[this.groupIndex].name;

        const p = this.groups[this.groupIndex].params[this.paramIndex];
        const val = this.isModified ? this.pendingValue : this._getRealValue(p);

        // --- 圆点闪烁控制 ---
        if (this.isModified) {
            if (Date.now() - this.flashTimer > 300) {
                this.pid.editDot.visible(!this.pid.editDot.visible());
                this.flashTimer = Date.now();
            }
        } else {
            this.pid.editDot.visible(false);
        }

        // 返回短名称和当前值
        let displayVal = val;
        return p.substring(0, 6) + ":" + displayVal;
    }
}