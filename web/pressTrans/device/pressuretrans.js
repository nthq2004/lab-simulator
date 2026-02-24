export class PressureTransmitter {
    constructor(config) {
        this.layer = config.layer;
        this.x = config.x || 210;
        this.y = config.y || 150;
        this.id = config.id || 'pTr';

        // 动态尺寸设置：最小宽140, 最小高180
        this.width = Math.max(140, Math.min(config.width || 140, 200));
        this.height = Math.max(180, Math.min(config.height || 180, 240));

        // 核心参数
        this.inputPressure = 0;
        this.rangeMax = config.rangeMax || 1.0;
        this.zeroAdj = 0;
        this.spanAdj = 1.0;
        this.type = 'pressTransmitter';

        this.isPowered = false;
        this.outCurrent = 4.0; // 输出电流，默认4mA
        this.terminals = [];
        this.knobs = {};// 存储旋钮对象，便于调整时访问

        // 端口点击回调        
        this.onTerminalClick = config.onTerminalClick || null;
        this.onStateChange = config.onStateChange || null;

        this.group = new Konva.Group({
            x: this.x,
            y: this.y,
            draggable: true,
            id: this.id
        });

        this._init();
    }

    _init() {
        this._drawEnclosure();      // 绘制主体仓位
        this._drawLCD();            // 绘制显示屏
        this._drawKnobs();          // 绘制拟物旋钮
        this._drawTerminals();      // 整合后的端口绘制

        this.layer.add(this.group);
        this.layer.draw();
        this.update(0, false);
    }

    _drawEnclosure() {
        const centerX = this.width / 2;

        // 1. 顶部 T 型横梁 (Junction Box)
        const tBar = new Konva.Rect({
            x: 20, y: 10,
            width: this.width - 40, height: 45,
            fill: '#f1f2f6', stroke: '#a4b0be', strokeWidth: 1, cornerRadius: 5
        });

        // 左右金属密封盖 (模拟图片两侧的六角螺帽)
        const leftCap = new Konva.Rect({ x: 0, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });
        const rightCap = new Konva.Rect({ x: this.width - 20, y: 15, width: 20, height: 35, fill: '#ced6e0', stroke: '#747d8c', cornerRadius: 2 });

        // 2. 圆形表头与防滑旋盖 (深绿色)
        const outerRadius = 55;
        const outerCover = new Konva.Circle({
            x: centerX, y: 85, radius: outerRadius,
            fill: '#2f3542', // 底色
            stroke: '#1e272e', strokeWidth: 1
        });

        // 深绿色旋盖 (带凹槽纹理)
        const greenCover = new Konva.Circle({
            x: centerX, y: 85, radius: 52,
            fill: '#27ae60', // 图片中的深绿色
            stroke: '#1e8449', strokeWidth: 4
        });

        // 3. 底部金属丝扣接口
        const stem = new Konva.Rect({ x: centerX - 10, y: 140, width: 20, height: 20, fill: '#ced6e0', stroke: '#747d8c' });
        const bolt = new Konva.Rect({ x: centerX - 15, y: 160, width: 30, height: 15, fill: '#747d8c', cornerRadius: 2 });

        this.group.add(tBar, leftCap, rightCap, outerCover, greenCover, stem, bolt);
        this.lcdCenterY = 85;
    }

    _drawLCD() {
        const centerX = this.width / 2;
        const lcdRadius = 38;

        // LCD 背景 (图片中是弧形顶部的绿色屏幕)
        this.lcdBg = new Konva.Circle({
            x: centerX, y: this.lcdCenterY,
            radius: lcdRadius,
            fill: '#000' // 默认黑屏
        });

        this.lcdText = new Konva.Text({
            x: centerX - 30, y: this.lcdCenterY - 10,
            width: 60,
            text: '',
            fontSize: 18,
            fontFamily: 'Digital-7, monospace',
            fill: '#00ff00',
            align: 'center',
            fontStyle: 'bold'
        });

        const unit = new Konva.Text({
            x: centerX - 15, y: this.lcdCenterY + 12,
            text: 'MPa', fontSize: 10, fill: '#1a1a1a', opacity: 0
        });
        this.unitText = unit;

        this.group.add(this.lcdBg, this.lcdText, unit);
    }

    _drawKnobs() {
        // 旋钮放在顶部 T 型梁上，模拟隐藏盖板下的调节孔
        const knobConfigs = [
            { id: 'zero', x: 50, label: 'Z' },
            { id: 'span', x: this.width - 50, label: 'S' }
        ];

        knobConfigs.forEach(k => {
            const knobGroup = new Konva.Group({ x: k.x, y: 32 });
            const base = new Konva.Circle({ radius: 11, fill: '#dfe4ea', stroke: '#747d8c' });
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 8, fill: '#f1f2f6', stroke: '#2f3542' }));
            rotor.add(new Konva.Line({ points: [0, -7, 0, 7], stroke: '#2f3542', strokeWidth: 3 }));

            knobGroup.add(base, rotor);
            this.knobs[k.id] = rotor; // 存储旋钮对象

            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const startY = e.evt.clientY || e.evt.touches[0].clientY;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY || (me.touches ? me.touches[0].clientY : me.clientY);
                    const delta = (startY - cy) * 2;
                    rotor.rotation(startRot + delta);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.2;
                    else this.spanAdj = 1.0 + (rotor.rotation() / 360) * 0.2;
                    this.update();
                };
                const onUp = () => {
                    const val = (this.inputPressure + this.zeroAdj) * this.spanAdj;
                    //压力换算成电流，最小对应4mA，最大对应20mA。
                    this.outCurrent = Math.min(Math.max((val / this.rangeMax) * 16 + 4, 4), 20);
                    if (this.onStateChange) this.onStateChange(this.group.id(), { 'pTrCurrent': this.outCurrent, 'ZERO': this.zeroAdj, 'SPAN': this.spanAdj });
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
            this.group.add(knobGroup);
        });
    }

    _drawTerminals() {
        const centerX = this.width / 2;
        // 电路端口 (从左侧引出)
        const wireT = [
            { id: 'p', color: '#ff4757', y: 22 },
            { id: 'n', color: '#2f3542', y: 42 }
        ];
        wireT.forEach(p => {
            const term = new Konva.Circle({ x: 5, y: p.y, radius: 7, fill: p.color, stroke: '#333', id: `${this.id}_wire_${p.id}` });
            term.setAttrs({
                connType: 'wire',
                termId: term.id(),
                parentId: this.group.id()
            });
            term.on('mousedown touchstart', (e) => { e.cancelBubble = true; if (this.onTerminalClick) this.onTerminalClick(term); });
            this.group.add(term);
            this.terminals.push(term);
        });

        // 气路端口 (底部凸出一半)
        const pipePort = new Konva.Rect({
            x: centerX - 10, y: 175, width: 20, height: 12,
            fill: '#95a5a6', stroke: '#34495e', id: `${this.id}_pipe_i`
        });
        pipePort.setAttrs({
            connType: 'pipe',
            termId: pipePort.id(),
            parentId: this.group.id()
        });
        pipePort.on('mousedown touchstart', (e) => { e.cancelBubble = true; if (this.onTerminalClick) this.onTerminalClick(pipePort); });
        this.group.add(pipePort);
        this.terminals.push(pipePort);
    }

    setPower(on) {
        this.isPowered = on;
        this.update();
    }

    setValue(pIn){
        this.inputPressure = pIn;
        this.update();
    }
    getValue(){
        return this.outCurrent;
    }

    update() {
        // 更新旋钮位置,根据输入气压、零点调整和量程调整计算输出电流，并更新显示
        this.knobs['zero'].rotation((this.zeroAdj / 0.2) * 360);
        this.knobs['span'].rotation(((this.spanAdj - 1.0) / 0.2) * 360);
        if (!this.isPowered) {
            this.outCurrent = 0;
            this.lcdBg.fill('#1a1a1a'); // 熄灭
            this.lcdText.text('');
            this.unitText.opacity(0);
        } else {
            this.lcdBg.fill('#2ed573'); // 亮起图片中的翠绿色
            const val = (this.inputPressure + this.zeroAdj) * this.spanAdj;
            //压力换算成电流，最小对应4mA，最大对应20mA。
            this.outCurrent = Math.min(Math.max((val / this.rangeMax) * 16 + 4, 3.8), 20.5);
            this.lcdText.text(Math.max(0, val).toFixed(3)); // 
            this.lcdText.fill('#1a1a1a'); // 液晶黑字
            this.unitText.opacity(1);
        }
        this.layer.batchDraw();
    }
}