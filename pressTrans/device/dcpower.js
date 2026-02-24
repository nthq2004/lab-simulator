/**
 * DC 24V 可调直流电源模拟器
 * 功能：电压调节、开关控制、状态指示、手动连线端子集成
 */
export class DCPower {
    constructor(config) {

        this.layer = config.layer;
        this.x = config.x || 20;
        this.y = config.y || 70;
        // 动态尺寸：最小宽120，高140,最大宽240，高220，默认120x100
        this.width = Math.max(145, Math.min(config.width || 145, 200));
        this.height = Math.max(135, Math.min(config.height || 135, 145));
        // 状态变量
 
        this.isOn = false;
        this.voltage = config.voltage || 24; // 默认24V
        this.maxVoltage = 24;
        this.terminals = []; // 存储接线柱对象
        this.type = 'dcPower';

        this.onStateChange = config.onStateChange || null;
        this.onTerminalClick = config.onTerminalClick || null;

        // Konva 组
        this.group = new Konva.Group({
            x: this.x,
            y: this.y,
            draggable: true,
            id: config.id || 'dcP'
        });

        this._init();
    }

    _init() {
        this._drawChassis();      // 绘制外壳
        this._drawNameplate();    // 绘制铭牌
        this._drawLCD();          // 绘制液晶屏
        this._drawControls();     // 绘制开关和旋钮
        this._drawTerminals();    // 绘制接线柱

        this.layer.add(this.group);
        this.update();
    }

    // 1. 矩形外框
    _drawChassis() {
        this.chassis = new Konva.Rect({
            width: this.width,
            height: this.height,
            fill: '#ecf0f1',
            stroke: '#2c3e50',
            strokeWidth: 3,
            cornerRadius: 5
        });
        this.group.add(this.chassis);
    }
    // 2. 铭牌
    _drawNameplate() {
        const title = new Konva.Text({
            x: 10, y: 5,
            text: `DC 24V`,
            fontSize: 12,
            fontStyle: 'bold'
        });
        const school = new Konva.Text({
            x: this.width - 60, y: 5,
            text: '江苏航院',
            fontSize: 11
        });
        this.group.add(title, school);
    }
    // 3. 液晶显示屏
    _drawLCD() {
        // 液晶屏高度固定，宽度随设备调整
        const lcdHeight = 30;
        const lcdBg = new Konva.Rect({
            x: 10, y: 18,
            width: this.width - 20,
            height: lcdHeight,
            fill: '#000',
            cornerRadius: 3
        });

        this.voltageText = new Konva.Text({
            x: 10, y: 22,
            width: this.width - 20,
            text: '',
            fontSize: 22,
            fontFamily: 'monospace',
            fill: '#00ff00',
            align: 'center'
        });

        this.group.add(lcdBg, this.voltageText);
    }

    // 4. 控制面板（开关、旋钮、指示灯）
    _drawControls() {
        const ctrlY = 78; // 控制区起始高度

        // --- 凹陷式电源键 ---
        this.powerBtnGroup = new Konva.Group({ x: 12, y: ctrlY });

        this.powerBtnBase = new Konva.Rect({
            width: 33, height: 20,
            fill: '#bdc3c7',
            stroke: '#7f8c8d',
            strokeWidth: 1,
            shadowColor: '#000',
            shadowBlur: 5,
            shadowOffset: { x: 2, y: 2 },
            cornerRadius: 2
        });

        const btnText = new Konva.Text({
            x: 0, y: 25,
            text: '电源键',
            fontSize: 12,
            fontStyle: 'bold',
            fill: '#34495e'
        });

        this.powerBtnGroup.add(this.powerBtnBase, btnText);
        //每次点击切换状态，都要报告给上层，以便更新显示和逻辑。上层通过传入的 update 方法处理。所有产生输出信号的设备都应如此设计。
        this.powerBtnGroup.on('mousedown touchstart', () => {
            this.isOn = !this.isOn;
            if (this.onStateChange) this.onStateChange(this.group.id(), { 'isOn': this.isOn, 'voltage': this.getValue() });
            this.update();
        });

        // --- 带刻度的旋钮 ---
        const knobX = this.width - 50;
        const knobY = ctrlY + 10;
        this.knobGroup = new Konva.Group({ x: knobX, y: knobY });

        // 绘制刻度线和数字
        const scaleValues = [0, 4, 8, 12, 16, 20, 24];
        scaleValues.forEach(v => {
            // 映射 0-24V 到旋钮的角度（-150° 到 150°）
            const angle = (v / 24) * 300 - 150;
            const rad = (angle - 90) * Math.PI / 180;
            const r = 32; // 刻度半径

            const txt = new Konva.Text({
                x: r * Math.cos(rad) - 10,
                y: r * Math.sin(rad) - 5,
                text: v.toString(),
                fontSize: 10,
                fontStyle: 'bold',
                width: 20,
                align: 'center',
                fill: '#0a1314'
            });
            this.knobGroup.add(txt);
        });

        const knobCircle = new Konva.Circle({
            radius: 26,
            fill: '#e3e8e9',
            stroke: '#34495e',
            cursor: 'hand'
        });

        this.knobPointer = new Konva.Line({
            points: [0, 0, 0, -24],
            stroke: '#e74c3c',
            strokeWidth: 2,
            lineCap: 'round'
        });

        this.knobGroup.add(knobCircle, this.knobPointer);

        // 旋钮逻辑
        knobCircle.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const startY = e.evt.clientY || e.evt.touches[0].clientY;
            const startV = this.voltage;
            const onMove = (me) => {
                const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                this.voltage = Math.max(0, Math.min(24, startV + (startY - cy) * 0.1));
                this.update();
            };
            const onUp = () => {
                this.update();
                // 报告状态变化
                if (this.onStateChange) this.onStateChange(this.group.id(), { 'isOn': this.isOn, 'voltage': this.getValue() });
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('touchmove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchend', onUp);
        });

        this.group.add(this.powerBtnGroup, this.knobGroup);
    }

    // 5. 接线柱（关键：集成手动连线属性）
    _drawTerminals() {
        const termY = this.height; // 对齐底边线
        const terminalData = [
            { label: 'p', color: '#ff4757', x: this.width * 0.7 }, // 红
            { label: 'n', color: '#2f3542', x: this.width * 0.3 } // 黑
        ];

        terminalData.forEach(data => {
            const term = new Konva.Circle({
                x: data.x,
                y: termY,
                radius: 8,
                fill: data.color,
                stroke: '#333',
                strokeWidth: 2,
                id: `${this.group.id()}_wire_${data.label}`
            });

            // 避开保留属性 'type'，改用 'connectionType'
            term.setAttrs({
                connType: 'wire',
                termId: term.id(),
                parentId: this.group.id()
            });

            term.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                if (this.onTerminalClick) this.onTerminalClick(term);
            });

            this.group.add(term);
            this.terminals.push(term);
        });
    }

    // 更新电源键样式
    _updateBtnStyle() {
        if (this.isOn) {
            // 压下效果：阴影消失，位置微移
            this.powerBtnBase.setAttrs({
                shadowBlur: 0,
                shadowOffset: { x: 0, y: 0 },
                x: 1, y: 1,
                fill: '#bdc3c7'
            });
        } else {
            // 凸起效果
            this.powerBtnBase.setAttrs({
                shadowBlur: 5,
                shadowOffset: { x: 2, y: 2 },
                x: 0, y: 0,
                fill: '#bdc3c7'
            });
        }
    }
    // 更新显示逻辑
    update() {
        this._updateBtnStyle();
        const angle = (this.voltage / 24) * 300 - 150;
        this.knobPointer.rotation(angle);
        if (!this.isOn) {
            this.voltageText.text('OFF');
            this.voltageText.fill('#333');
        } else {
            this.voltageText.text(this.voltage.toFixed(1) + ' V');
            this.voltageText.fill('#00ff00');
        }
        this.layer.batchDraw();
    }

    setValue(isOn,voltage) {
        this.isOn = isOn;
        this.voltage = Math.max(0, Math.min(this.maxVoltage, voltage));
        this.update();
    }   

    // 获取当前输出电压
    getValue() {
        return this.isOn ? this.voltage : 0;
    }
}