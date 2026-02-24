
export class AirBottle {
    constructor(config) {
        this.layer = config.layer;
        this.x = config.x || 750;
        this.y = config.y || 250;
        this.id = config.id || 'caB';

        // --- 物理参数 ---
        this.type = 'airBottle';
        this.maxPressure = 100.0;    // 最大设计压力
        this.pressure = config.initialPressure || 50; // 当前压力 (BAR)
        this.volume = config.volume || 50;  // 气瓶容积 (L)，影响压降速度
        this.isConsuming = false;     // 是否正在耗气
        this.consumptionRate = 0.5;   // 基础耗气速率 (BAR/秒)

        this.terminals = [];
        this.onTerminalClick = config.onTerminalClick || null;
        // this.onStateChange = config.onStateChange || null;


        this.group = new Konva.Group({
            x: this.x,
            y: this.y,
            draggable: true,
            id: this.id
        });

        this.init();
        this.startPhysicsLoop(); // 启动物理仿真循环
    }

    init() {
        const tankW = 70, tankH = 130;
        this._drawLegs(tankW, tankH);

        // 主体及封头绘图逻辑 (保持之前的拟物化设计)
        const body = new Konva.Rect({
            x: -tankW / 2, y: -tankH / 2,
            width: tankW, height: tankH,
            fillLinearGradientStartPoint: { x: -tankW / 2, y: 0 },
            fillLinearGradientEndPoint: { x: tankW / 2, y: 0 },
            fillLinearGradientColorStops: [0, '#1a5276', 0.4, '#3498db', 1, '#1a5276'],
            stroke: '#154360', strokeWidth: 2
        });

        const topDome = new Konva.Arc({
            x: 0, y: -tankH / 2,
            innerRadius: 0, outerRadius: tankW / 2,
            angle: 180, rotation: 180,
            fill: '#3498db', stroke: '#154360', strokeWidth: 2
        });

        const bottomDome = new Konva.Arc({
            x: 0, y: tankH / 2,
            innerRadius: 0, outerRadius: tankW / 2,
            angle: 180, rotation: 0,
            fill: '#1a5276', stroke: '#154360', strokeWidth: 2
        });

        this.group.add(bottomDome, topDome, body);
        this.pressureDisplay = this._drawEmbeddedLCD(0, 0);
        this._drawPorts(tankW, tankH);
        this.layer.add(this.group);
        this.update();
    }

    // --- 核心物理仿真循环 ---
    startPhysicsLoop() {
        // 使用 Konva.Animation 确保与帧率同步，平滑更新
        this.anim = new Konva.Animation((frame) => {
            if (this.isConsuming && this.pressure > 0) {
                // 计算每帧应该减少的压力 (frame.timeDiff 为两帧之间毫秒数)
                const drop = (this.consumptionRate / (this.volume / 10)) * (frame.timeDiff / 1000);
                this.pressure = Math.max(0, this.pressure - drop);
                this.update();
            }
        }, this.layer);

        this.anim.start();
    }

    /**
     * 设置耗气状态，本模块在截止阀打开时，由上层设备调用
     * @param {boolean} active - 是否开启负载
     * @param {number} rate - 负载的耗气权重 (例如大型气缸耗气快)
     */
    setConsumption(active, rate = 0.5) {
        this.isConsuming = active;
        this.consumptionRate = rate;
    }

    /**
     * 充气方法 (模拟压缩机工作)
     */
    refill(amount) {
        this.pressure = Math.min(this.maxPressure, this.pressure + amount);
        this.update();
    }
//本函数被调用时，在3个地方被调用：初始化（1次性）、压缩机调用（压缩机运行时，由上层周期调用、对外供气时（由本身的周期性函数this.anim 调用。
    update() {
        if (this.pressureDisplay) {
            this.pressureDisplay.text(this.pressure.toFixed(1));
            // 压力低于 10 BAR 时数显闪烁红色提醒
            const color = this.pressure < 1.5 ? (Math.sin(Date.now() / 200) > 0 ? '#ff0000' : '#330000') : '#00ff00';
            this.pressureDisplay.fill(color);
            this.pressureDisplay.shadowColor(color);
        }
    }

    // ... (之前的 _drawEmbeddedLCD, _drawPorts, _drawLegs 方法保持不变) ...
    _drawEmbeddedLCD(x, y) {
        const lcdGroup = new Konva.Group({ x, y });
        lcdGroup.add(new Konva.Rect({
            x: -30, y: -20, width: 60, height: 40,
            fill: '#2c3e50', stroke: '#bdc3c7', strokeWidth: 2, cornerRadius: 3
        }));
        lcdGroup.add(new Konva.Rect({ x: -25, y: -12, width: 50, height: 24, fill: '#000' }));
        const valText = new Konva.Text({
            x: -25, y: -8, width: 50, text: '0.0',
            fontSize: 16, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff00', align: 'center', shadowBlur: 8
        });
        lcdGroup.add(valText);
        this.group.add(lcdGroup);
        return valText;
    }

    _drawPorts(tankW, tankH) {

        const terminalData = [
            { label: 'o', color: '#1304e7', x: -tankW / 2 - 12, y: -tankH / 2 + 40 }, // 红
            { label: 'i', color: 'rgb(126, 139, 167)', x: tankW / 2, y: tankH / 2 - 40 } // 黑
        ];
        // 这里的 ID 保持 pipe_i/o 命名，方便您的 reDrawConnections 算法寻找
        terminalData.forEach(data => {
            const term = new Konva.Rect({
                x: data.x,
                y: data.y,
                width: 12,
                height: 22,
                fill: data.color,
                offsetY: 11,
                id: `${this.group.id()}_pipe_${data.label}` // 隐藏的逻辑点
            });
            term.strokeWidth(2);
            term.stroke('#333');
            term.setAttrs({
                connType: 'pipe',
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

    _drawLegs(tankW, tankH) {
        this.group.add(new Konva.Rect({ x: -tankW / 2 + 5, y: tankH / 2, width: 12, height: 15, fill: '#2c3e50' }));
        this.group.add(new Konva.Rect({ x: tankW / 2 - 17, y: tankH / 2, width: 12, height: 15, fill: '#2c3e50' }));
    }

    getValues() {
        return  this.pressure
    }

}