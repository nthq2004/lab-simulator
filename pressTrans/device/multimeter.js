/**
 * Multimeter.js
 * 基于 Konva.js 仿真的 ZOYI ZT98 万用表
 */
export class Multimeter {
    constructor(config) {
        this.layer = config.layer;

        // 1. 内部状态
        this.mode = 'OFF';       // 当前档位: OFF, DCV, ACV, RES, DIODE, DCMA, DCUA
        this.value = 0.0;        // 输入的物理值
        this.displayValue = "0"; // 屏幕显示字符串
        this.isBacklight = false;
        this.width = config.width || 200;
        this.height = config.height || 360;

        this.terminals = []; // 存储端子对象，便于外部访问和连接

        // 2. 交互回调
        this.onTerminalClick = config.onTerminalClick || null;
        this.onStateChange = config.onStateChange || null;
        this.group = new Konva.Group({
            x: config.x || 800,
            y: config.y || 60,
            width: this.width,
            height: this.height,
            draggable: true,
            id: config.id || 'muM'
        });
        this._createUI();
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
        const lcdWidth = Math.min(220, Math.max(160, Math.floor(this.width - 80)));
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

        this.pointer = new Konva.Line({
            points: [0, -10, 0, -Math.floor(knobRadius * 0.9)],
            stroke: '#999', strokeWidth: Math.max(6, Math.floor(knobRadius * 0.1)), lineCap: 'round'
        });

        this.knobGroup.add(knobCircle, this.pointer);
        // 初始指针指向 -90 度（左侧 OFF）
        this.pointer.rotation(-90);

        // 将其他主要部件加入 group（在 body 之上）
        this.group.add(lcdBg, this.lcdText, this.lcdUnit, this.lcdMode, this.knobGroup);

        // --- 挡位文字标注 ---
        this._drawScaleLabels(cx, knobY);

        // --- 插孔区域 ---
        const jacksY = Math.floor(this.height - 50);
        this._drawJacks(cx, jacksY);

        this.layer.add(this.group);
        this.layer.draw();

        // 绑定旋钮交互
        this.knobGroup.on('mousedown touchstart', (e) => this._rotateKnob(e));
    }

    _drawScaleLabels(cx, cy) {
        const scales = [
            { label: 'OFF', angle: -90, mode: 'OFF' },
            { label: 'V~', angle: -60, mode: 'ACV' },
            { label: 'V⎓', angle: -30, mode: 'DCV' },
            { label: 'Ω', angle: 0, mode: 'RES' },
            { label: '▶|', angle: 30, mode: 'DIODE' },
            { label: 'mA', angle: 60, mode: 'MA' },
            { label: 'OFF', angle: 90, mode: 'OFF' }
        ];

        const radius = Math.min(110, Math.max(40, Math.floor(this.width / 3)));
        scales.forEach(s => {
            const rad = (s.angle - 90) * (Math.PI / 180);
            const x = cx + Math.cos(rad) * radius;
            const y = cy + Math.sin(rad) * radius;

            const text = new Konva.Text({
                x: x - 20, y: y - 10,
                text: s.label, fontSize: 18, fill: '#fff', width: 40, align: 'center'
            });
            this.group.add(text);
        });
    }

    _drawJacks(cx, y) {
        const jackLabels = ['mA', 'COM', 'VΩ▶|'];
        const colors = ['#c00', '#000', '#c00'];
        const id = ['ma', 'com', 'v'];

        const spacing = Math.floor(this.width / 3.3333333); // approx 90 for width=300
        const startX = cx - spacing;
        const jackRadius = Math.max(8, Math.min(20, Math.floor(this.width * 0.06)));

        jackLabels.forEach((l, i) => {
            const x = startX + i * spacing;
            const jack = new Konva.Circle({
                x: x, y: y, radius: jackRadius, fill: colors[i], stroke: '#111', strokeWidth: 3
            });
            const inner = new Konva.Circle({
                x: x, y: y, radius: Math.floor(jackRadius * 0.6), fill: '#222', id: `${this.group.id()}_wire_${id[i]}`, stroke: '#333', strokeWidth: 3
            });
            const label = new Konva.Text({
                x: x - Math.floor(jackRadius * 3), y: y - (jackRadius + 20), text: l, fontSize: 12, fill: '#fff', width: Math.floor(jackRadius * 6), align: 'center'
            });
            this.group.add(jack, inner, label);
            inner.setAttr('connType', 'wire');
            inner.setAttr('termId', inner.id());
            inner.setAttr('parentId', this.group.id());
            this.terminals.push(inner);
            inner.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                if (this.onTerminalClick) this.onTerminalClick(inner);
            });
        });
    }

    /**
     * 逻辑：旋转旋钮并切换模式
     */
    _rotateKnob(e) {
        // 点击决定旋转方向：点击在指针顺时针方向 -> 顺时针转动；点击在逆时针方向 -> 逆时针转动
        // 步进 30°，限制在 [-90, 90]
        const stage = this.layer.getStage();
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
        const minRot = -90;
        const maxRot = 90;

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
        this.layer.batchDraw();
    }

    _updateAngleByMode(mode){
        switch(mode){
            case "RES":
                this.pointer.rotation(0);
                break;
            case "BEEP":
                this.pointer.rotation(30);
                break;  
            case "MA":
                this.pointer.rotation(60);
                break;                              
            case "OFF":
                this.pointer.rotation(90);
                break;
            case "ACV":
                this.pointer.rotation(-60);
                break; 
            case "DCV":
                this.pointer.rotation(-30);
                break;
            default:
                this.pointer.rotation(90);
                break;                                               
        };
        this.update();
    }
    _updateModeByAngle(angle) {
        // 归一化角度到 0-360 之间
        const normalizedAngle = (angle % 360 + 360) % 360;

        /**
         * ZOYI ZT98 档位分布 (近似角度):
         * 0° (正上): 欧姆/电阻 (Ω)
         * 30°: 二极管/蜂鸣器 (▶|·)) )
         * 60°: 毫安档 (mA)
         * 90°: 关 (OFF)- (正右)
         * -30°: 交流电压 (V~)
         * -60°: 直流电压 (V⎓)
         * -90° : 关 (OFF) - (正左)
         */

        if (normalizedAngle >= 337.5 || normalizedAngle < 22.5) {
            this.mode = 'RES';        // 欧姆档
        } else if (normalizedAngle >= 7.5 && normalizedAngle < 52.) {
            this.mode = 'BEEP';      // 二极管/蜂鸣器
        } else if (normalizedAngle >= 37.5 && normalizedAngle < 82.5) {
            this.mode = 'MA';       // 毫安档 (DC)
        } else if (normalizedAngle >= 67.5 && normalizedAngle < 112.5) {
            this.mode = 'OFF';        // 底部多个 OFF 区域
        } else if (normalizedAngle >= 307.5 && normalizedAngle < 352.5) {
            this.mode = 'DCV';        // 交流电压档
        } else if (normalizedAngle >= 277.5 && normalizedAngle < 322.5) {
            this.mode = 'ACV';        // 直流电压档
        } else {
            this.mode = 'OFF';
        }
        if (this.onStateChange) {
            this.onStateChange(this.group.id(), { 'mode': this.mode });
        }
        this.update();
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
                this.audioCtx.resume().catch(() => {});
            }

            // 如果已有未清理的振荡器，先清理
            if (this._osc) {
                try { this._osc.stop(); } catch (e) {}
                try { this._osc.disconnect(); } catch (e) {}
                this._osc = null;
            }
            if (this._gain) {
                try { this._gain.disconnect(); } catch (e) {}
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
            try { osc.start(); } catch (e) {}

            this._osc = osc;
            this._gain = gain;

            // 短促蜂鸣（200ms），并在结束后清理资源与恢复颜色
            this._beepStopTimer = setTimeout(() => {
                if (this._osc) {
                    try { this._osc.stop(); } catch (e) {}
                    try { this._osc.disconnect(); } catch (e) {}
                    this._osc = null;
                }
                if (this._gain) {
                    try { this._gain.disconnect(); } catch (e) {}
                    this._gain = null;
                }
                this.isBeepingNow = false;
                this._beepStopTimer = null;
                // 恢复为默认颜色（update 可能再次设置颜色）
                try { this.lcdText.fill('#222'); } catch (e) {}
            }, 2000);
        } else {
            // 立即停止蜂鸣并清理
            if (this._beepStopTimer) {
                clearTimeout(this._beepStopTimer);
                this._beepStopTimer = null;
            }
            if (this._osc) {
                try { this._osc.stop(); } catch (e) {}
                try { this._osc.disconnect(); } catch (e) {}
                this._osc = null;
            }
            if (this._gain) {
                try { this._gain.disconnect(); } catch (e) {}
                this._gain = null;
            }
            this.isBeepingNow = false;
            try { this.lcdText.fill('#222'); } catch (e) {}
        }
    }
    /**
     * 核心接口：设置输入的物理值
     * @param {number} val - 测量到的数值
     */
    setInputValue(val) {
        this.value = val;
        this.update();
    }
    //只有在MA档位下，setPower才会有实际效果，其他档位无论开关都不影响显示.
    setPower(on) {
        this.isConnected = on;
    }

    getValue() {
        return this.value;
    }

    update() {
        // 1. 关机状态处理
        if (this.mode === 'OFF') {
            this.lcdText.text('');
            this.lcdMode.text('');
            this.lcdUnit.text('');
            this.layer.batchDraw();
            return;
        }

        let display = this.value;
        let unit = '';
        let prefix = 'AUTO';
        let precision = 3; // 默认保留3位小数

        // 2. 根据模式处理量程与显示逻辑
        switch (this.mode) {
            case 'DCV':
                unit = 'V';
                prefix = 'DC AUTO';
                precision = 3; // 示例：1.999V
                break;

            case 'ACV':
                unit = 'V';
                prefix = 'AC AUTO';
                precision = 3;
                break;

            case 'RES':
                prefix = 'AUTO';
                // 电阻档位自动单位换算
                if (display >= 1000000) {
                    display = display / 1000000;
                    unit = 'MΩ';
                    precision = 3; // 示例：1.500 MΩ
                } else if (display >= 1000) {
                    display = display / 1000;
                    unit = 'kΩ';
                    precision = 2; // 示例：10.50 kΩ
                } else {
                    unit = 'Ω';
                    precision = 1; // 示例：100.5 Ω
                }
                console.log(`更新显示: ${display.toFixed(precision)} ${unit} (原始值: ${this.value})`);
                break;

            case 'DIODE':
                unit = 'V';
                prefix = '▶|'; // 二极管标识
                precision = 3; // 显示导通压降，如 0.650V
                break;

            case 'BEEP': // 蜂鸣器/通断档
                unit = 'Ω';
                prefix = '·))';
                precision = 1;
                // --- 模拟蜂鸣逻辑 ---
                // 工业万用表通常在电阻小于 50Ω 时鸣叫
                if (display < 50) {
                    // 1. 视觉反馈：LCD 背景微弱闪烁或数值颜色改变
                    this.lcdText.fill('#ff0000'); // 导通时显示红色

                    // 2. 听觉反馈：调用浏览器频率振荡器
                    this.triggerBeep(true);
                } else {
                    this.lcdText.fill('#222'); // 恢复正常颜色
                    this.triggerBeep(false);
                }
                break;

            case 'MA':
                if (!this.isConnected) {
                    display = 0;
                }
                unit = 'mA';
                prefix = 'DC';
                precision = 2; // 示例：19.99 mA
                break;

            default:
                unit = '';
                prefix = '';
        }

        // 3. 处理溢出显示 (OL - Over Load)
        // 假设万用表最大量程限制，超过则显示 OL
        if (display > 1999 && this.mode !== 'RES') {
            this.lcdText.text('OL');
        }
        else if (display > 1000 && this.mode == 'RES') {
            this.lcdText.text('OL');
        } else {
            this.lcdText.text(display.toFixed(precision));
        }

        // 4. 更新 UI 文本
        this.lcdUnit.text(unit);
        this.lcdMode.text(prefix);

        // 5. 渲染
        this.layer.batchDraw();
    }
}