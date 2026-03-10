import { BaseComponent } from './BaseComponent.js';

export class PressRegulator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.scale = config.scale || 1;
        this.w = 140 * this.scale;
        this.h = 100 * this.scale;

        // 核心仿真属性
        this.type = 'regulator';
        this.inputPressure = 0;   // 输入气压 (内部统一单位：MPa)
        this.setPressure = config.setPressure || 0; // 设定压力值 (内部统一单位：MPa)
        this.outputPressure = 0;
        this.displayUnit = config.unit || 'MPa';

        // 初始配置对象同步
        this.config = { id: this.id, setPressure: this.setPressure, unit: this.displayUnit };

        this.initVisuals();

        // --- 端口设置 ---
        const reverse = config.reverse || false;
        const portY = this.h / 2 + 20 * this.scale;
        if (reverse) {
            this.addPort(this.w - 10 * this.scale, portY, 'o', 'pipe');
            this.addPort(10 * this.scale, portY, 'i', 'pipe');
        } else {
            this.addPort(10 * this.scale, portY, 'o', 'pipe');
            this.addPort(this.w - 10 * this.scale, portY, 'i', 'pipe','in');
        }

        this._startLoop();
    }

    initVisuals() {
        this.viewGroup = new Konva.Group({
            x: this.w / 2,
            y: this.h / 2 + 20 * this.scale,
            scaleX: this.scale,
            scaleY: this.scale
        });
        this.group.add(this.viewGroup);

        const bodyW = 40, bodyH = 40, pipeW = 120, pipeH = 40;

        // 1. 横向管道
        const pipe = new Konva.Rect({
            x: -pipeW / 2, y: -pipeH / 2,
            width: pipeW, height: pipeH,
            fillLinearGradientStartPoint: { x: 0, y: -pipeH / 2 },
            fillLinearGradientEndPoint: { x: 0, y: pipeH / 2 },
            fillLinearGradientColorStops: [0, '#7f8c8d', 0.5, '#bdc3c7', 1, '#7f8c8d'],
            cornerRadius: 2,
            stroke: '#7f8c8d', strokeWidth: 1
        });

        // 2. 主框体
        const body = new Konva.Rect({
            x: -bodyW / 2, y: -bodyH + 10,
            width: bodyW, height: bodyH,
            fillLinearGradientStartPoint: { x: -bodyW / 2, y: 0 },
            fillLinearGradientEndPoint: { x: bodyW / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#95a5a6', 0.4, '#f5f5f5', 1, '#95a5a6'],
            cornerRadius: 3,
            stroke: '#7f8c8d', strokeWidth: 1
        });

        this._drawHandWheel(0, -bodyH + 10);
        this.leftDisplay = this._drawIndustrialLCD(-70, -bodyH - 10, 'OUTPUT');
        this.rightDisplay = this._drawIndustrialLCD(25, -bodyH - 10, 'INPUT');

        this.viewGroup.add(pipe, body);
        this.update();
    }

    _drawHandWheel(centerX, centerY) {
        const wheelCenterY = centerY - 32;
        this.wheelVisual = new Konva.Group({ x: centerX, y: wheelCenterY });

        const shaft = new Konva.Rect({
            x: -4, y: -40, width: 8, height: 12,
            fill: '#7f8c8d', stroke: '#333', strokeWidth: 0.5
        });

        const ring = new Konva.Ring({
            innerRadius: 18, outerRadius: 25,
            fill: '#2980b9', stroke: '#1c5982', strokeWidth: 2
        });

        for (let i = 0; i < 3; i++) {
            const spoke = new Konva.Rect({
                x: 0, y: 0, width: 4, height: 42,
                fill: '#1c5982', offsetX: 2, offsetY: 21,
                rotation: i * 60
            });
            this.wheelVisual.add(spoke);
        }

        this.wheelVisual.add(ring);
        this.viewGroup.add(shaft, this.wheelVisual);

        this.wheelVisual.on('wheel', (e) => {
            e.cancelBubble = true;
            // 内部以 MPa 为准，delta 影响更精细
            const delta = e.evt.deltaY > 0 ? -0.01 : 0.01;
            this.applyDelta(delta);
        });

        let lastY = null;
        this.wheelVisual.on('touchstart', (e) => {
            e.cancelBubble = true;
            lastY = e.evt.touches[0].clientY;
        });
        this.wheelVisual.on('touchmove', (e) => {
            e.cancelBubble = true;
            const y = e.evt.touches[0].clientY;
            const dy = (lastY - y) * 0.001;
            lastY = y;
            this.applyDelta(dy);
        });
    }

    applyDelta(delta) {
        // 内部单位为 MPa，这里 delta*1 表示旋转一圈对应的大约变化量
        // 限制在 0-10 MPa (相当于 0-100 BAR)
        this.setPressure = Math.max(0, Math.min(10, this.setPressure + (delta*0.5)));
        this.wheelVisual.rotation(this.wheelVisual.rotation() + delta * 600);
        this.update();

        if (this.sys && this.sys.onConfigChange) {
            this.sys.onConfigChange(this.config.id, { setPressure: this.setPressure });
        }
    }

    _drawIndustrialLCD(x, y, label) {
        const lcdGroup = new Konva.Group({ x, y });
        lcdGroup.add(new Konva.Rect({
            width: 45, height: 30, fill: '#34495e', cornerRadius: 1
        }));
        lcdGroup.add(new Konva.Rect({
            x: 2, y: 2, width: 41, height: 26, fill: '#1a1a1a'
        }));

        const valText = new Konva.Text({
            x: 0, y: 4, width: 45, text: '0.0',
            fontSize: 11, fontFamily: 'Courier New',
            fill: '#00ff00', align: 'center', fontStyle: 'bold'
        });

        lcdGroup.add(new Konva.Text({
            text: label, fontSize: 7, fill: '#ecf0f1', y: -8, x: 0
        }));

        lcdGroup.add(valText);
        this.viewGroup.add(lcdGroup);
        return valText;
    }
    _startLoop() {

    }
    setValue(pIn) {
        this.inputPressure = pIn; // pIn 必须是 MPa
        this.update();
    }

    update() {
        // 核心物理逻辑：输出 = Min(输入, 设定值) -> 全 MPa 逻辑
        this.outputPressure = Math.min(this.inputPressure, this.setPressure);

        const formatDisplay = (val) => {
            // 内部是 MPa，如果单位选的是 BAR，则 * 10 显示
            const v = (this.displayUnit === 'BAR') ? val * 10 : val;
            return v.toFixed(this.displayUnit === 'MPa' ? 3 : 2);
        };

        if (this.rightDisplay) this.rightDisplay.text(`${formatDisplay(this.inputPressure)}\n${this.displayUnit}`);
        if (this.leftDisplay) this.leftDisplay.text(`${formatDisplay(this.outputPressure)}\n${this.displayUnit}`);

        const ledColor = this.outputPressure >= this.setPressure ? '#f1c40f' : '#00ff00';
        if (this.leftDisplay) this.leftDisplay.fill(ledColor);

        if (this.group.getLayer()) this.group.getLayer().batchDraw();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '设定压力', key: 'setPressure', type: 'number' },
            {
                label: '压力单位',
                key: 'unit',
                type: 'select',
                options: [
                    { label: 'MPa (兆帕)', value: 'MPa' },
                    { label: 'BAR (公斤)', value: 'BAR' }
                ]
            }
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        this.displayUnit = newConfig.unit || 'MPa';

        if (newConfig.setPressure !== undefined) {
            let p = parseFloat(newConfig.setPressure);
            // 核心修正：如果用户在 BAR 模式下输入，存入内部时 / 10 转为 MPa
            this.setPressure = (this.displayUnit === 'BAR') ? p / 10 : p;
        }
        this.update();
    }
}