
export class PressureRegulator {
    constructor(config) {
        this.layer = config.layer;
        this.x = config.x || 510;
        this.y = config.y || 390;
        this.id = config.id || `pRe`;
        this.reverse = config.reverse || true;

        // 核心仿真属性
        this.type = 'regulator';
        this.inputPressure = 0;   // 右侧输入气压
        this.setPressure = 0;    // 设定压力值 (0-1)
        this.outputPressure = 0;

        this.terminals = [];
        this.onTerminalClick = config.onTerminalClick || null;
        this.onStateChange = config.onStateChange || null;

        this.group = new Konva.Group({
            x: this.x,
            y: this.y,
            draggable: true,
            id: this.id
        });

        this.init();
    }

    init() {
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
        // 4. 工业化 LCD (位置上移)
        this.leftDisplay = this._drawIndustrialLCD(-70, -bodyH - 10, 'OUTPUT');
        this.rightDisplay = this._drawIndustrialLCD(25, -bodyH - 10, 'INPUT');

        // 5. 端口
        this._drawPorts(this.reverse);
        this.group.add(pipe, body);

        // 3. 工业手轮 (修正旋转中心)
        this._drawHandWheel(0, -bodyH + 10);

        this.layer.add(this.group);
        // this.update(0);
    }

    _drawHandWheel(centerX, centerY) {
        // 轴心连接件
        const shaft = new Konva.Rect({
            x: centerX - 4, y: centerY - 12,
            width: 8, height: 12,
            fill: '#7f8c8d', stroke: '#333', strokeWidth: 0.5
        });

        // 手轮容器 - 设置其坐标为旋转中心
        const wheelCenterY = centerY - 32;
        this.wheelVisual = new Konva.Group({
            x: centerX,
            y: wheelCenterY
        });


        // 蓝色外圈 (使用 Ring)
        const ring = new Konva.Ring({
            innerRadius: 18,
            outerRadius: 25,
            fill: '#2980b9',
            stroke: '#1c5982',
            strokeWidth: 2,
            shadowBlur: 2, shadowOpacity: 0.5
        });

        // 辐条 (以 wheelVisual 中心旋转)
        for (let i = 0; i < 3; i++) {
            const spoke = new Konva.Rect({
                x: 0, y: 0,
                width: 4, height: 42,
                fill: '#1c5982',
                offsetX: 2, offsetY: 21, // 核心：偏置设为宽高的50%
                rotation: i * 60,
                draggable: false
            });
            this.wheelVisual.add(spoke);
        }

        this.wheelVisual.add(ring);
        this.group.add(shaft, this.wheelVisual);
        this.wheelVisual.draggable(false); // 手轮本身不直接拖动，旋转由事件控制

        // 滚轮逻辑
        this.wheelVisual.on('wheel', (e) => {
            e.cancelBubble = true;
            e.evt.cancelBubble = true;
            // 如果是在滚动或调节，防止手机页面整体拉动
            e.evt.preventDefault();

            const delta = e.evt.deltaY > 0 ? -0.01 : 0.01;
            this.applyDelta(delta);
        });

        //用触屏实现类似滚轮的效果
        let lastY = null;
        this.wheelVisual.on('touchstart', (e) => {
            e.cancelBubble = true;
            e.evt.cancelBubble = true;
            // 如果是在滚动或调节，防止手机页面整体拉动
            e.evt.preventDefault();
            lastY = e.evt.touches[0].clientY;
        });

        this.wheelVisual.on('touchmove', (e) => {
            e.cancelBubble = true;
            e.evt.cancelBubble = true;
            // 如果是在滚动或调节，防止手机页面整体拉动
            e.evt.preventDefault();
            const y = e.evt.touches[0].clientY;
            const dy = lastY - y;   // 上滑为正
            lastY = y;

            // 灵敏度控制（很重要）
            const sensitivity = 0.001;
            const delta = dy * sensitivity;

            if (delta !== 0) {
                this.applyDelta(delta);
            }
        });

        this.wheelVisual.on('touchend', () => {
            lastY = null;
        });
    }

    //滚轮滚动，触屏滑动的共同效果
    applyDelta(delta) {
        this.setPressure = Math.max(0, Math.min(50, this.setPressure + (delta * 5)));

        this.wheelVisual.rotation(
            this.wheelVisual.rotation() + delta * 600
        );

        this.update();
        if (this.onStateChange) {
            this.onStateChange(this.group.id(), { 'regPres': this.outputPressure, 'setPres': this.setPressure }); 
        }

    }

    _drawIndustrialLCD(x, y, label) {
        const lcdGroup = new Konva.Group({ x, y });

        // 1. 工业外壳
        lcdGroup.add(new Konva.Rect({
            width: 42, height: 26,
            fill: '#34495e', stroke: '#2c3e50',
            cornerRadius: 1, strokeWidth: 1.5
        }));

        // 2. 屏幕凹陷阴影感
        lcdGroup.add(new Konva.Rect({
            x: 2, y: 2, width: 38, height: 22,
            fill: '#1a1a1a'
        }));

        // 3. LED 888 背景底纹 (增加工业感)
        const bgText = new Konva.Text({
            x: 2, y: 6, width: 38,
            text: '88.8',
            fontSize: 14, fontFamily: 'Courier New',
            fill: '#222', // 极暗绿色，模拟未发光笔画
            align: 'center', fontStyle: 'bold'
        });

        // 4. 实际数值显示
        const valText = new Konva.Text({
            x: 2, y: 6, width: 38,
            text: '0.0',
            fontSize: 14, fontFamily: 'Courier New',
            fill: '#00ff00',
            align: 'center', fontStyle: 'bold',
            shadowColor: '#00ff00', shadowBlur: 5, shadowOpacity: 0.5
        });

        // 5. 顶部标签
        lcdGroup.add(new Konva.Text({
            text: label,
            fontSize: 8, fill: '#ecf0f1',
            y: -10, x: 0, letterSpacing: 1
        }));

        lcdGroup.add(bgText, valText);
        this.group.add(lcdGroup);
        return valText;
    }

    _drawPorts(reverse) {
        let terminalData = [];
        if (reverse) {
            terminalData = [
                { label: 'i', color: '#ff4757', x: 60 }, // 红
                { label: 'o', color: '#2f3542', x: -72 } // 黑
            ];
        } else {
            terminalData = [
                { label: 'o', color: '#2f3542', x: -72 }, // 黑
                { label: 'i', color: '#ff4757', x: 60 }
            ];
        }


        terminalData.forEach(data => {
            const term = new Konva.Rect(
                {
                    width: 12,
                    height: 22,
                    fill: data.color,
                    x: data.x,
                    y: 0,
                    cornerRadius: 2,
                    offsetY: 11,
                    id: `${this.group.id()}_pipe_${data.label}`
                });
            term.strokeWidth(2);
            term.stroke('#333');
            term.setAttr('connType', 'pipe');
            term.setAttr('termId', term.id());
            term.setAttr('parentId', this.group.id());
            term.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                this.onTerminalClick(term);
            });
            this.terminals.push(term);
            this.group.add(term);
        });
    }

    //1.主程序调用通知调节器气源气压的变化，2.手轮操作后调用计算设定值的变化和输出压力的变化，通知上层应用。
    setValue(pIn) {
        this.inputPressure = pIn;
        this.update();
    }

    getValue() {
        return this.outputPressure;
    }

    update() {

        this.outputPressure = Math.min(this.inputPressure, this.setPressure);

        this.rightDisplay.text(this.inputPressure.toFixed(1));
        this.leftDisplay.text(this.outputPressure.toFixed(1));

        // 状态变色
        const ledColor = this.outputPressure >= this.setPressure ? '#f1c40f' : '#00ff00';
        this.leftDisplay.fill(ledColor);
        this.leftDisplay.shadowColor(ledColor);

        this.layer.batchDraw();
    }
}