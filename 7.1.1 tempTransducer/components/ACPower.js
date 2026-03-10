import { BaseComponent } from './BaseComponent.js';

export class ACPower extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 145;
        this.height = 145; // 稍高一点以容纳频率旋钮
        this.type = 'ac_source';
        this.isOn = false;

        // 核心参数
        this.voltageRMS = 24;      // 有效值电压 (显示值)
        this.frequency = 50;       // 频率 (Hz)
        this.phase = 0;            // 初始相位

        this._init();

        // 端口布局
        this.addPort(45, 145, 'n', 'wire');
        this.addPort(100, 145, 'p', 'wire', 'p');
    }

    _init() {
        this._drawChassis();
        this._drawNameplate();
        this._drawLCD();
        this._drawControls();
    }

    _drawChassis() {
        this.chassis = new Konva.Rect({
            width: this.width, height: this.height,
            fill: '#dfe6e9', stroke: '#2d3436',
            strokeWidth: 3, cornerRadius: 5
        });
        this.group.add(this.chassis);
    }

    _drawNameplate() {
        const title = new Konva.Text({ x: 10, y: 5, text: `AC 24V`, fontSize: 12, fontStyle: 'bold' });
        const school = new Konva.Text({
            x: this.width - 60, y: 5,
            text: '江苏航院',
            fontSize: 12
        });
        this.group.add(title,school);
    }

    _drawLCD() {
        const lcdBg = new Konva.Rect({
            x: 10, y: 18, width: this.width - 20, height: 40,
            fill: '#000', cornerRadius: 3
        });
        this.displayV = new Konva.Text({
            x: 10, y: 22, width: this.width - 20, text: '',
            fontSize: 18, fontFamily: 'monospace', fill: '#00ff00', align: 'center'
        });
        this.displayF = new Konva.Text({
            x: 10, y: 44, width: this.width - 20, text: '',
            fontSize: 12, fontFamily: 'monospace', fill: '#ed0606', align: 'center'
        });
        this.group.add(lcdBg, this.displayV, this.displayF);
    }

    _drawControls() {
        const ctrlY = 75;

        // 1. 电源键 (复用逻辑)
        this.powerBtnGroup = new Konva.Group({ x: 12, y: ctrlY + 10 });
        this.powerBtnBase = new Konva.Rect({ width: 30, height: 20, fill: '#bdc3c7', cornerRadius: 4 });
        this.powerBtnGroup.add(this.powerBtnBase, new Konva.Text({ x: 4, y: 25, text: '电源', fontSize: 11 }));

        this.powerBtnGroup.on('mousedown touchstart', () => {
            this.isOn = !this.isOn;
            this.update();
        });
        this.powerBtnGroup.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        // 2. 电压旋钮 (V-RMS)
        const vKnob = this._createKnob(72, ctrlY + 20, '电压', 0, 240, (val) => {
            this.voltageRMS = val;
        }, this.voltageRMS);

        // 3. 频率旋钮 (Freq)
        const fKnob = this._createKnob(116, ctrlY + 20, '频率', 10, 110, (val) => {
            this.frequency = val;
        }, this.frequency);

        this.group.add(this.powerBtnGroup, vKnob, fKnob);
    }

    // 通用旋钮构造器
    _createKnob(x, y, label, min, max, onChange, initVal) {
        const group = new Konva.Group({ x, y });
        const circle = new Konva.Circle({ radius: 18, fill: '#c7dae1', stroke: '#2d3436' });
        const pointer = new Konva.Line({ points: [0, 0, 0, -16], stroke: '#d63031', strokeWidth: 2 });

        const updatePointer = (val) => {
            const angle = ((val - min) / (max - min)) * 260 - 130;
            pointer.rotation(angle);
        };
        updatePointer(initVal);
        // 闭包变量记录当前值
        let currentVal = initVal;
        // --- 核心逻辑修改：点击左右增减 ---
        circle.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;

            // 获取点击位置相对于旋钮中心的本地坐标
            // Konva 的 getRelativePointerPosition 可以获取相对于当前节点的坐标
            const pos = circle.getRelativePointerPosition();

            // 计算步长：总程的 5%
            const step = (max - min) * 0.05;

            if (pos.x < 0) {
                // 点击左侧：减少
                currentVal = Math.max(min, currentVal - step);
            } else {
                // 点击右侧：增加
                currentVal = Math.min(max, currentVal + step);
            }

            // 执行回调并更新 UI
            onChange(currentVal);
            updatePointer(currentVal);
            this.update();
        });
        circle.on('dblclick', (e) => {
            e.cancelBubble = true;
        });
        group.add(circle, pointer, new Konva.Text({ x: -10, y: 22, text: label, fontSize: 10 }));
        return group;
    }

    /**
     * 获取瞬时电压值 (供求解器调用)
     * V(t) = V_rms * sqrt(2) * sin(2 * PI * f * t)
     */
    getValue(currentTime) {
        if (!this.isOn) return 0;
        const peak = this.voltageRMS * Math.sqrt(2);
        return peak * Math.sin(2 * Math.PI * this.frequency * currentTime);
    }

    update() {
        if (this.sys.onComponentStateChange) this.sys.onComponentStateChange(this);

        if (!this.isOn) {
            this.displayV.text('');
            this.displayF.text('');
            this.powerBtnBase.fill('#bdc3c7');
        } else {
            this.displayV.text(this.voltageRMS.toFixed(1) + ' V～');
            this.displayF.text(this.frequency.toFixed(1) + ' Hz');
            this.powerBtnBase.fill('#078d67'); // 开启时变绿
        }
        this.sys.layer.draw();
    }
}