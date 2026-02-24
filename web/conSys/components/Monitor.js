import { BaseComponent } from './BaseComponent.js';

export class Monitor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.w = 420;
        this.h = 320;
        this.history = [];
        this.maxDataPoints = 600;

        // --- 报警管理 ---
        this.activeAlarms = []; // {id,text, confirmed, muted,timestamp, isPhysicalActive}
        this.alarmIdCounter = 0;
        // this.isMuted = false;
        this.flashState = true;
        this.maxAlarmLines = 5;

        // --- 延时报警管理 ---
        this.faultTimers = {}; // 存储格式: { "PT100断路": startTime, ... }
        this.alarmDelay = 3000; // 延时 5 秒

        this.faultMap = {
            transmitter: {
                'OPEN': "温度变送器输入断路",
                'SHORT': "温度变送器输入短路",
                'LOOP_BREAK': "PID输入回路开路"
            },
            waterTemp: "冷却水温异常(HH)",
            pidOutput: "PID输出回路断路",
            communication: "RS485通信故障"
        };

        this.audioCtx = null;
        this.initUI();
        this.initInteraction();

        this.addPort(this.w / 2 - 20, 0, 'a1', 'wire', 'p');
        this.addPort(this.w / 2 + 20, 0, 'b1', 'wire');

        setInterval(() => {
            this.flashState = !this.flashState;
            this.handleAudio();
        }, 500);
    }

    initUI() {
        const frame = new Konva.Rect({
            width: this.w, height: this.h,
            fill: '#2c3e50', stroke: '#7f8c8d', strokeWidth: 4, cornerRadius: 5
        });

        // 1. 绘图区 (高度压缩至 160 以留出 5 条文字空间)
        const plotBg = new Konva.Rect({
            x: 10, y: 10, width: 400, height: 180, fill: '#000'
        });

        this.svLine = new Konva.Line({ stroke: '#00ff00', strokeWidth: 2, dash: [8, 8] });
        this.pvLine = new Konva.Line({ stroke: '#ff0000', strokeWidth: 2 });
        this.outLine = new Konva.Line({ stroke: '#f5d865', strokeWidth: 1.5 });
        this.group.add(frame, plotBg, this.pvLine, this.svLine, this.outLine);
        // 2. 报警显示区 (5 条)
        this.alarmLines = [];
        for (let i = 0; i < this.maxAlarmLines; i++) {
            const t = new Konva.Text({
                x: 15, y: 200 + i * 22,
                fontSize: 13, fontFamily: 'monospace',
                text: ""
            });
            this.alarmLines.push(t);
            this.group.add(t);
        }

        // 3. 控制排 (按钮垂直堆叠在指示灯上方)
        this.btnMute = this.createButton("消音", 345, 200, '#f39c12');
        this.btnAck = this.createButton("确认", 345, 240, '#27ae60');

        this.alarmLed = new Konva.Circle({ x: 355, y: 295, radius: 8, fill: '#333' });
        this.buzzerIcon = new Konva.Path({
            x: 380, y: 295, data: 'M0 0 L8 -8 L8 8 Z M10 -4 Q13 0 10 4',
            stroke: '#7f8c8d', scale: { x: 1.2, y: 1.2 }
        });

        this.group.add(this.btnMute, this.btnAck, this.alarmLed, this.buzzerIcon);
    }

    createButton(txt, x, y, color) {
        const g = new Konva.Group({ x, y, name: 'button', cursor: 'pointer' });
        const r = new Konva.Rect({ width: 60, height: 32, fill: color, cornerRadius: 4, stroke: '#1a252f' });
        const t = new Konva.Text({ width: 60, height: 32, text: txt, align: 'center', verticalAlign: 'middle', fill: '#fff', fontStyle: 'bold' });
        g.add(r, t);
        return g;
    }

    btnAckFunc() {

        this.activeAlarms.forEach(a => {

            if (!a.isPhysicalActive && !a.confirmed) {
                a.confirmed = true;
            }

        });
    }

    btnMuteFunc() {

        this.activeAlarms.forEach(a => {
            if (!a.confirmed) {
                a.muted = true;
            }
        });
    }
    initInteraction() {
        // this.btnMute.on('mousedown', () => {
        //     // this.isMuted = true;
        // });
        this.btnMute.on('mousedown', () => {
            this.btnMuteFunc();
        });
        // 修改后的确认逻辑
        this.btnAck.on('mousedown', () => {
            this.btnAckFunc();
        });
    }

    handleAudio() {

        const hasFlashingAlarm = this.activeAlarms.some(
            a => !a.confirmed && !a.muted
        );

        if (hasFlashingAlarm && this.flashState) {

            if (!this.audioCtx)
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

            if (this.audioCtx.state === 'suspended')
                this.audioCtx.resume();

            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc.frequency.setValueAtTime(1000, this.audioCtx.currentTime);
            gain.gain.setValueAtTime(0.05, this.audioCtx.currentTime);

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.1);
        }
    }

    update(data) {
        if (data.pv === null) {
            this.alarmLines.forEach((l, i) => l.text(i === 0 ? "无效数据" : ""));
            return;
        }

        // 1. 曲线逻辑
        this.updatePlot(data);

        // 2. 报警解析与滚动逻辑
        this.processFaults(data.fault);

        // 3. 渲染
        this.renderAlarms();
    }

    updatePlot(data) {
        this.history.push({ pv: data.pv / 100, sv: data.sv / 100, out: data.out / 100 });
        if (this.history.length > this.maxDataPoints) this.history.shift();

        const mapY = (v) => 190 - ((v - (-0.1)) / 1.2) * 170;
        const ptsPV = [], ptsSV = [], ptsOUT = [];

        this.history.forEach((d, i) => {
            const x = 10 + i * (400 / this.maxDataPoints);
            ptsPV.push(x, mapY(d.pv));
            ptsSV.push(x, mapY(d.sv));
            ptsOUT.push(x, mapY(d.out));
        });

        this.pvLine.points(ptsPV);
        this.svLine.points(ptsSV);
        this.outLine.points(ptsOUT);
    }

    processFaults(faultObj) {
        const now = Date.now();
        const detectedTexts = [];
        if (faultObj.transmitter) detectedTexts.push(this.faultMap.transmitter[faultObj.transmitter]);  //faultObj.transmitter可能值
        if (faultObj.waterTemp) detectedTexts.push(this.faultMap.waterTemp);
        if (faultObj.pidOutput) detectedTexts.push(this.faultMap.pidOutput);
        if (faultObj.communication) detectedTexts.push(this.faultMap.communication);

        // 1. 处理延时逻辑与计时器清理
        // 遍历 faultMap 中的所有可能故障文本（扁平化处理）
        const allPossibleFaults = [
            ...Object.values(this.faultMap.transmitter),
            this.faultMap.waterTemp,
            this.faultMap.pidOutput,
            this.faultMap.communication
        ];

        allPossibleFaults.forEach(txt => {
            const isPhysicallyPresent = detectedTexts.includes(txt);

            if (isPhysicallyPresent) {
                // 如果故障当前存在
                if (!this.faultTimers[txt]) {
                    // 如果还没有开始计时，记录开始时间
                    this.faultTimers[txt] = now;
                } else {
                    // 如果已经开始计时，检查是否超过延时
                    const duration = now - this.faultTimers[txt];
                    if (duration >= this.alarmDelay) {
                        // 满足 5s 延时，尝试触发报警
                        this.triggerAlarm(txt);
                    }
                }
            } else {
                // 如果故障消失，立即重置该故障的计时器
                delete this.faultTimers[txt];
            }
        });

        // 2. 更新现有报警的物理活跃状态 (用于渲染 [ACT] / [CLR])
        this.activeAlarms.forEach(a => {
            if (!a.confirmed) {
                a.isPhysicalActive = detectedTexts.includes(a.text);
            }
        });

        if (this.activeAlarms.length > this.maxAlarmLines) {
            this.activeAlarms = this.activeAlarms.slice(0, this.maxAlarmLines);
        }
    }

    // 将报警触发逻辑独立出来
    triggerAlarm(txt) {
        // 检查是否已经存在该故障的“未确认”实例
        const existing = this.activeAlarms.find(a => a.text === txt && !a.confirmed);

        if (!existing) {  //新的报警插入在第一条显示。
            this.activeAlarms.unshift({
                id: ++this.alarmIdCounter,   // 唯一ID
                text: txt,
                confirmed: false,
                muted: false,               // ✅ 每条独立消音
                isPhysicalActive: true,
                timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }).slice(0, 5)
            });
            // this.isMuted = false;
            // 报警产生后，可以清除计时器防止重复触发（直到下一次故障发生）
            // 或者保留计时器，靠上面的 existing 判断拦截
        }
    }

    renderAlarms() {

        this.alarmLines.forEach((line, i) => {
            const alarm = this.activeAlarms[i];
            if (alarm) {
                // 状态文字显示
                const statusFlag = alarm.isPhysicalActive ? "[ACT]" : "[CLR]";
                line.text(`${alarm.timestamp} ${statusFlag} ${alarm.text}`);

                if (!alarm.confirmed) {
                    // 未确认状态：
                    // 如果物理故障还在，显示红色（或闪烁）
                    // 如果物理故障消失但未确认，同样显示红色（或闪烁），提示需要确认
                    // const color = (shouldFlash && !this.flashState) ? '#ffffff' : '#ff0000';
                    // line.fill(this.isMuted ? '#ff0000' : color);
                    // ✅ 每条独立闪烁判断
                    if (!alarm.muted) {
                        const color = this.flashState ? '#ff0000' : '#ffffff';
                        line.fill(color);
                    } else {
                        line.fill('#ff0000'); // 消音后常亮红
                    }
                } else {
                    // 已确认（只有物理故障消失后才能进入此状态）：显示绿色历史
                    line.fill('#2ecc71');
                }
            } else {
                line.text(i === 0 && this.activeAlarms.length === 0 ? "系统工作正常" : "");
                line.fill('#2ecc71');
            }
        });

        // 指示灯逻辑：只要有未确认的（无论物理故障是否还在），指示灯就响应
        // const ledOn = (shouldFlash && this.flashState) || (hasUnconfirmed && this.isMuted);
        // this.alarmLed.fill(ledOn ? '#ff0000' : (hasUnconfirmed ? '#c0392b' : '#690606'));
        // this.buzzerIcon.stroke(shouldFlash && this.flashState ? '#ff0000' : '#7f8c8d');
        // ===== 指示灯逻辑 =====

        const hasFlashingAlarm = this.activeAlarms.some(
            a => !a.confirmed && !a.muted
        );

        const hasUnconfirmed = this.activeAlarms.some(
            a => !a.confirmed
        );

        if (hasFlashingAlarm) {
            this.alarmLed.fill(this.flashState ? '#ff0000' : '#690606');
            this.buzzerIcon.stroke(this.flashState ? '#ff0000' : '#7f8c8d');
        }
        else if (hasUnconfirmed) {
            this.alarmLed.fill('#ea3d29'); // 常亮红
            this.buzzerIcon.stroke('#7f8c8d');
        }
        else {
            this.alarmLed.fill('#690606');
            this.buzzerIcon.stroke('#7f8c8d');
        }
    }
}