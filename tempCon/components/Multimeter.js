/**
 * Multimeter.js
 * 基于 Konva.js 仿真的 万用表
 */
import { BaseComponent } from './BaseComponent.js';

export class Multimeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // 1. 内部状态
        this.mode = 'OFF';       // 当前档位: OFF, DCV, ACV, RES, DIODE, DCMA, DCUA
        this.value = 0.0;        // 输入的物理值
        this.displayValue = "0"; // 屏幕显示字符串

        this.width = config.width || 240;
        this.height = config.height || 400;

        this._createUI();
        const spacing = Math.floor(this.width / 3.3333333); // approx 90 for width=300
        const startX = this.width / 2 - spacing;
        this.addPort(startX, this.height - 25, 'ma', 'wire', 'p');
        this.addPort(startX + spacing, this.height - 25, 'com', 'wire');
        this.addPort(startX + 2 * spacing, this.height - 25, 'v', 'wire', 'p');
    }

    /**
     * 构建万用表外观
     */
    _createUI() {
        // 使用 group 的局部坐标 (0,0) 作为万用表左上角
        const cx = this.width / 2;
        const bodyWidth = this.width;
        const bodyHeight = this.height;

        // --- 外壳 (青色边框 + 深灰面板) ---
        const body = new Konva.Rect({
            x: 0, y: 0,
            width: bodyWidth, height: bodyHeight,
            fill: '#444', stroke: '#00ced1', strokeWidth: 12,
            cornerRadius: 40, shadowBlur: 20
        });

        // 先将外壳加入 group，保证为底层
        this.group.add(body);

        // --- 液晶屏区域 ---
        const lcdWidth = Math.min(220, Math.max(200, Math.floor(this.width - 80)));
        const lcdHeight = 90;
        const lcdX = Math.floor((this.width - lcdWidth) / 2);
        const lcdY = 40;

        const lcdBg = new Konva.Rect({
            x: lcdX, y: lcdY,
            width: lcdWidth, height: lcdHeight,
            fill: '#c5ccb7', stroke: '#222', strokeWidth: 2, cornerRadius: 5
        });

        this.lcdText = new Konva.Text({
            x: lcdX + 10, y: lcdY + 15,
            text: ' ', fontSize: Math.min(60, Math.floor(this.width / 6)), fontFamily: 'monospace',
            fill: '#222', width: lcdWidth - 20, align: 'right', fontStyle: 'bold'
        });

        this.lcdUnit = new Konva.Text({
            x: lcdX + lcdWidth - 30, y: lcdY + lcdHeight - 30,
            text: ' ', fontSize: 20, fill: '#222'
        });

        this.lcdMode = new Konva.Text({
            x: lcdX + 10, y: lcdY + lcdHeight - 25,
            text: ' ', fontSize: 14, fill: '#e3142f'
        });

        // --- 挡位旋钮 ---
        const knobY = Math.floor(this.height * 0.63);
        this.knobGroup = new Konva.Group({ x: cx, y: knobY });
        const knobRadius = Math.min(80, Math.floor(this.width * 0.26));
        const knobCircle = new Konva.Circle({
            radius: knobRadius, fill: '#333', stroke: '#111', strokeWidth: 5,
            shadowBlur: 5
        });

        //电阻档标志
        const resArc = new Konva.Arc({
            InnerRadius: knobRadius - 3, outerRadius: knobRadius, angle: 90, rotation: -60, fill: '#17e760', stroke: '#08df2f', strokeWidth: 1,
        });

        //交流电压档标志
        const acArc = new Konva.Arc({
            InnerRadius: knobRadius - 3, outerRadius: knobRadius, angle: 30, rotation: 120, fill: '#f17c08', stroke: '#ec9819', strokeWidth: 1,
        });
        //直流电压档标志
        const dcArc = new Konva.Arc({
            InnerRadius: knobRadius - 3, outerRadius: knobRadius, angle: 60, rotation: 180, fill: '#f10808', stroke: '#f00505', strokeWidth: 1,
        });
        this.pointer = new Konva.Line({
            points: [0, -10, 0, -Math.floor(knobRadius * 0.9)],
            stroke: '#999', strokeWidth: Math.max(10, Math.floor(knobRadius * 0.1)), lineCap: 'round'
        });

        this.knobGroup.add(knobCircle, this.pointer, resArc, acArc, dcArc);
        // 初始指针指向 -90 度（左侧 OFF）
        this.pointer.rotation(0);

        // 将其他主要部件加入 group（在 body 之上）
        this.group.add(lcdBg, this.lcdText, this.lcdUnit, this.lcdMode, this.knobGroup);

        // --- 挡位文字标注 ---
        this._drawScaleLabels(cx, knobY);

        // --- 插孔区域 ---
        const jacksY = Math.floor(this.height - 25);
        this._drawJacks(cx, jacksY);

        this.sys.layer.draw();

        // 绑定旋钮交互
        this.knobGroup.on('mousedown touchstart', (e) => this._rotateKnob(e));
    }

    _drawScaleLabels(cx, cy) {
        const scales = [
            { label: 'OFF', angle: 0, mode: 'OFF' },
            { label: '200mv', angle: -30, mode: 'DCVmv' },
            { label: '20V', angle: -60, mode: 'DCV20' },
            { label: '200V', angle: -90, mode: 'DCV200' },
            { label: '~200V', angle: -120, mode: 'ACV200' },
            { label: '~500V', angle: -150, mode: 'ACV500' },
            { label: '▶|-))', angle: 30, mode: 'RES0' },
            { label: '200Ω', angle: 60, mode: 'RES200' },
            { label: '2kΩ', angle: 90, mode: 'RES2k' },
            { label: '200kΩ', angle: 120, mode: 'RES200k' },
            { label: 'mA', angle: 150, mode: 'MA' },
            { label: 'uF', angle: 180, mode: 'C' }
        ];

        const radius = Math.min(110, Math.max(40, Math.floor(this.width / 3)));
        const knobRadius = Math.min(80, Math.floor(this.width * 0.26));
        scales.forEach(s => {
            const rad = (s.angle - 90) * (Math.PI / 180);
            const x = cx + Math.cos(rad) * radius;
            const y = cy + Math.sin(rad) * radius;
            const markx = cx + Math.cos(rad) * knobRadius;
            const marky = cy + Math.sin(rad) * knobRadius;
            const mark = new Konva.Circle({
                x: markx, y: marky, radius: 3, fill: '#0e5ae7', stroke: '#1165eb', strokeWidth: 1,
            });

            const text = new Konva.Text({
                x: x - 20, y: y - 6,
                text: s.label, fontSize: 12, fill: '#fff', width: 40, align: 'center'
            });
            this.group.add(text, mark);
        });
    }

    _drawJacks(cx, y) {
        const jackLabels = ['mA', 'COM', 'VΩ▶|'];
        const colors = ['#c00', '#000', '#c00'];

        const spacing = Math.floor(this.width / 3.3333333); // approx 90 for width=300
        const startX = cx - spacing;
        const jackRadius = Math.max(8, Math.min(20, Math.floor(this.width * 0.06)));

        jackLabels.forEach((l, i) => {
            const x = startX + i * spacing;
            const jack = new Konva.Circle({
                x: x, y: y, radius: jackRadius, fill: colors[i], stroke: '#111', strokeWidth: 3
            });
            const inner = new Konva.Circle({
                x: x, y: y, radius: Math.floor(jackRadius * 0.6), fill: '#222', stroke: '#333', strokeWidth: 3
            });
            const label = new Konva.Text({
                x: x - Math.floor(jackRadius * 3), y: y - (jackRadius + 20), text: l, fontSize: 12, fill: '#fff', width: Math.floor(jackRadius * 6), align: 'center'
            });
            this.group.add(jack, inner, label);

        });
    }

    /**
     * 逻辑：旋转旋钮并切换模式
     */
    _rotateKnob(e) {
        // 点击决定旋转方向：点击在指针顺时针方向 -> 顺时针转动；点击在逆时针方向 -> 逆时针转动
        // 步进 30°，限制在 [-90, 90]
        const stage = this.sys.layer.getStage();
        if (!stage) return;
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const knobAbs = this.knobGroup.getAbsolutePosition();
        const dx = pointerPos.x - knobAbs.x;
        const dy = pointerPos.y - knobAbs.y;

        const clickAngle = Math.atan2(dy, dx) * 180 / Math.PI; // 相对于 +x 轴
        const desiredRotation = clickAngle + 90; // 将 +x 轴角度转换为 rotation 空间（rotation=0 指向上）

        const currentRotation = this.pointer.rotation();

        let delta = desiredRotation - currentRotation;
        // 归一化到 (-180,180]
        delta = ((delta + 540) % 360) - 180;

        const step = 30;
        const minRot = -3600;
        const maxRot = 3600;

        let newRotation = currentRotation;
        if (delta > 1) {
            newRotation = Math.min(maxRot, currentRotation + step);
        } else if (delta < -1) {
            newRotation = Math.max(minRot, currentRotation - step);
        } else {
            return; // 点击在指针方向附近，不变
        }

        if (Math.abs(newRotation - currentRotation) < 1e-6) return;

        this.pointer.rotation(newRotation);
        this._updateModeByAngle(newRotation);
        this.sys.layer.batchDraw();
    }

    _updateModeByAngle(angle) {
        // 归一化角度到 0-360 之间
        const normalizedAngle = (angle % 360 + 360) % 360;

        /**
            { label: 'OFF', angle: 0, mode: 'OFF' },
            { label: '200mv', angle: -30, mode: 'DCVmv' },
            { label: '20V', angle: -60, mode: 'DCV20' },
            { label: '200V', angle: -90, mode: 'DCV200' },
            { label: '~200V', angle: -120, mode: 'ACV200' },
            { label: '~500V', angle: -150, mode: 'ACV500' },
            { label: '▶|', angle: 30, mode: 'RES0' },
            { label: '200Ω', angle: 60, mode: 'RES200' },
            { label: '2kΩ', angle: 90, mode: 'RES2k' },
            { label: '200kΩ', angle: 120, mode: 'RES200k' },
            { label: 'mA', angle: 150, mode: 'MA' },
            { label: 'uF', angle: 180, mode: 'C' }
         */

        switch (true) {

            case (normalizedAngle >= 350 || normalizedAngle < 10):
                this.mode = 'OFF';
                break;
            case (normalizedAngle >= 20 && normalizedAngle < 40):
                this.mode = 'RES0';
                break;
            case (normalizedAngle >= 50 && normalizedAngle < 70):
                this.mode = 'RES200';
                break;
            case (normalizedAngle >= 80 && normalizedAngle < 100):
                this.mode = 'RES2k';
                break;
            case (normalizedAngle >= 110 && normalizedAngle < 130):
                this.mode = 'RES200k';
                break;
            case (normalizedAngle >= 140 && normalizedAngle < 160):
                this.mode = 'MA';
                break;
            case (normalizedAngle >= 170 && normalizedAngle < 190):
                this.mode = 'C';
                break;
            case (normalizedAngle >= 200 && normalizedAngle < 220):
                this.mode = 'ACV500';
                break;
            case (normalizedAngle >= 230 && normalizedAngle < 250):
                this.mode = 'ACV200';
                break;
            case (normalizedAngle >= 260 && normalizedAngle < 280):
                this.mode = 'DCV200';
                break;
            case (normalizedAngle >= 290 && normalizedAngle < 310):
                this.mode = 'DCV20';
                break;
            case (normalizedAngle >= 320 && normalizedAngle < 340):
                this.mode = 'DCVmv';
                break;
            default:
                this.mode = 'OFF';
        }


    }
    _updateAngleByMode() {
                /**
            { label: 'OFF', angle: 0, mode: 'OFF' },
            { label: '200mv', angle: -30, mode: 'DCVmv' },
            { label: '20V', angle: -60, mode: 'DCV20' },
            { label: '200V', angle: -90, mode: 'DCV200' },
            { label: '~200V', angle: -120, mode: 'ACV200' },
            { label: '~500V', angle: -150, mode: 'ACV500' },
            { label: '▶|', angle: 30, mode: 'RES0' },
            { label: '200Ω', angle: 60, mode: 'RES200' },
            { label: '2kΩ', angle: 90, mode: 'RES2k' },
            { label: '200kΩ', angle: 120, mode: 'RES200k' },
            { label: 'mA', angle: 150, mode: 'MA' },
            { label: 'uF', angle: 180, mode: 'C' }
         */
        switch (this.mode) {
            case 'DCVmv':
                this.pointer.rotation(-30);
                break;
            case 'DCV20':
                this.pointer.rotation(-60);
                break;
            case 'DCV200':
                this.pointer.rotation(-90);
                break;       
            case 'ACV200':
                this.pointer.rotation(-120);
                break;
            case 'ACV500':
                this.pointer.rotation(-150);
                break;
            case 'OFF':
                this.pointer.rotation(0);
                break;                
            // --- 电阻与通断档 ---
            case 'RES0': // 蜂鸣/二极管档
                this.pointer.rotation(30);
                break;
            case 'RES200':
                this.pointer.rotation(60);
                break;
            case 'RES2k':
                this.pointer.rotation(90);
                break;
            case 'RES200k':
                this.pointer.rotation(120);
                break;

            // --- 电流与电容档 ---
            case 'MA':
                this.pointer.rotation(150);
                break;
            case 'C':
                this.pointer.rotation(180);
                break;

            default:
                break;
        }
    }
    /**
 * 停止蜂鸣器声音
 * 采用安全的状态检查，确保振荡器被彻底销毁
 */
    // MultiMeter 类内部方法：播放/停止蜂鸣并安全清理音频节点与定时器
    triggerBeep(isBeeping) {
        if (!this.lcdText) return;

        if (isBeeping) {
            if (this.isBeepingNow) return;
            this.isBeepingNow = true;
            this.lcdText.fill('#f1c40f'); // 数值变黄模拟发光

            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume().catch(() => { });
            }

            // 如果已有未清理的振荡器，先清理
            if (this._osc) {
                try { this._osc.stop(); } catch (e) { }
                try { this._osc.disconnect(); } catch (e) { }
                this._osc = null;
            }
            if (this._gain) {
                try { this._gain.disconnect(); } catch (e) { }
                this._gain = null;
            }
            if (this._beepStopTimer) {
                clearTimeout(this._beepStopTimer);
                this._beepStopTimer = null;
            }

            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(2500, this.audioCtx.currentTime);
            gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            try { osc.start(); } catch (e) { }

            this._osc = osc;
            this._gain = gain;

            // 短促蜂鸣（200ms），并在结束后清理资源与恢复颜色
            this._beepStopTimer = setTimeout(() => {
                if (this._osc) {
                    try { this._osc.stop(); } catch (e) { }
                    try { this._osc.disconnect(); } catch (e) { }
                    this._osc = null;
                }
                if (this._gain) {
                    try { this._gain.disconnect(); } catch (e) { }
                    this._gain = null;
                }
                this.isBeepingNow = false;
                this._beepStopTimer = null;
                // 恢复为默认颜色（update 可能再次设置颜色）
                try { this.lcdText.fill('#222'); } catch (e) { }
            }, 2000);
        } else {
            // 立即停止蜂鸣并清理
            if (this._beepStopTimer) {
                clearTimeout(this._beepStopTimer);
                this._beepStopTimer = null;
            }
            if (this._osc) {
                try { this._osc.stop(); } catch (e) { }
                try { this._osc.disconnect(); } catch (e) { }
                this._osc = null;
            }
            if (this._gain) {
                try { this._gain.disconnect(); } catch (e) { }
                this._gain = null;
            }
            this.isBeepingNow = false;
            try { this.lcdText.fill('#222'); } catch (e) { }
        }
    }

    update(val) {
        this.value = val;

        // 1. 关机状态处理
        if (this.mode === 'OFF') {
            this.lcdText.text('');
            this.lcdMode.text('');
            this.lcdUnit.text('');
            this.triggerBeep(false); // 关机必须关声音
            this.sys.layer.batchDraw();
            return;
        }

        let display = this.value;
        let unit = '';
        let prefix = 'DC';
        let precision = 3;
        let isOverload = false;

        // 2. 根据 12 种模式处理量程与显示逻辑
        switch (this.mode) {
            // --- 直流电压档 ---
            case 'DCVmv':
                unit = 'mV';
                prefix = 'DC';
                precision = 1;
                display = display * 1000;
                if (Math.abs(display) > 200) isOverload = true;
                break;
            case 'DCV20':
                unit = 'V';
                prefix = 'DC';
                precision = 2; // 19.99V
                if (Math.abs(display) > 20) isOverload = true;
                break;
            case 'DCV200':
                unit = 'V';
                prefix = 'DC';
                precision = 1; // 199.9V
                if (Math.abs(display) > 200) isOverload = true;
                break;

            // --- 交流电压档 ---
            case 'ACV200':
                unit = 'V';
                prefix = 'AC';
                precision = 1;
                if (Math.abs(display) > 200) isOverload = true;
                break;
            case 'ACV500':
                unit = 'V';
                prefix = 'AC';
                precision = 0; // 高压档通常不留小数
                if (Math.abs(display) > 500) isOverload = true;
                break;

            // --- 电阻与通断档 ---
            case 'RES0': // 蜂鸣/二极管档
                unit = 'Ω';
                prefix = '▶|·))';
                precision = 1;
                // 蜂鸣逻辑：阻值小于 50 欧姆
                if (display < 5) {
                    this.lcdText.fill('#f1c40f');
                    this.triggerBeep(true);
                } else {
                    this.lcdText.fill('#222');
                    this.triggerBeep(false);
                }
                if (display > 50) isOverload = true; // 
                break;
            case 'RES200':
                unit = 'Ω';
                prefix = '';
                precision = 1;
                if (display > 200) isOverload = true;
                break;
            case 'RES2k':
                unit = 'kΩ';
                prefix = '';
                display = display / 1000;
                precision = 3; // 1.999 kΩ
                if (display > 2) isOverload = true;
                break;
            case 'RES200k':
                unit = 'kΩ';
                prefix = '';
                display = display / 1000;
                precision = 1; // 199.9 kΩ
                if (display > 200) isOverload = true;
                break;

            // --- 电流与电容档 ---
            case 'MA':
                unit = 'mA';
                prefix = 'DC';
                precision = 2;
                if (display > 200) isOverload = true;
                break;
            case 'C':
                unit = 'uF';
                prefix = 'CAP';
                precision = 2;
                if (display > 200) isOverload = true; // 假设最大 200uF
                break;

            default:
                break;

        }

        // 3. 渲染显示内容
        if (isOverload) {
            this.lcdText.text('O.L'); // 工业标准溢出显示
        } else {
            this.lcdText.text(display.toFixed(precision));
        }

        this.lcdUnit.text(unit);
        this.lcdMode.text(prefix);

        // 4. 强制重绘
        this.sys.layer.batchDraw();
    }
}