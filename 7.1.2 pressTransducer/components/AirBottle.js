import { BaseComponent } from './BaseComponent.js';

export class AirBottle extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.scale = config.scale || 1;
        this.w = 160 * this.scale;
        this.h = 220 * this.scale;

        this.type = 'airBottle';

        // --- 物理参数 (内部统一使用 MPa) ---
        this.maxPressure = 20.0; // 20MPa 约为 200BAR
        
        // 修正初始单位逻辑：如果配置没传单位，默认当做 MPa 处理
        this.displayUnit = config.unit || 'MPa';
        let initP = config.initialPressure || 2;
        // 如果初始给的是 BAR，转为 MPa 存储
        this.pressure = (this.displayUnit === 'BAR') ? initP / 10 : initP;
        
        this.volume = config.volume || 50; // 升 (L)

        this.isConsuming = false;
        this.consumptionRate = 0.5; // MPa/s 或自定义比例

        this.config = { id: this.id, pressure: this.pressure, volume: this.volume, unit: this.displayUnit };

        this.initVisuals();

        // 端口坐标缩放
        this.addPort(-13 * this.scale, 80 * this.scale, 'o', 'pipe');
        this.addPort(83 * this.scale, 0 * this.scale, 'i', 'pipe','in');

        this._startLoop();
    }

    initVisuals() {
        this.viewGroup = new Konva.Group({
            x: 35 * this.scale,
            y: 40 * this.scale,
            scaleX: this.scale,
            scaleY: this.scale
        });
        this.group.add(this.viewGroup);

        const tankW = 90, tankH = 130;

        // 主体渐变绘制
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
            fill: '#2691d3', stroke: '#154360', strokeWidth: 2
        });

        this.viewGroup.add(bottomDome, topDome, body);
        this.pressureDisplay = this._drawEmbeddedLCD(0, 0);
        this.update();
    }

    _drawEmbeddedLCD(x, y) {
        const lcdGroup = new Konva.Group({ x, y });
        lcdGroup.add(new Konva.Rect({
            x: -30, y: -20, width: 60, height: 40,
            fill: '#2c3e50', stroke: '#bdc3c7', strokeWidth: 2, cornerRadius: 3
        }));
        lcdGroup.add(new Konva.Rect({ x: -25, y: -12, width: 50, height: 24, fill: '#000' }));

        const valText = new Konva.Text({
            x: -25, y: -8, width: 50, text: '0.0',
            fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#00ff00', align: 'center'
        });

        lcdGroup.add(valText);
        this.viewGroup.add(lcdGroup);
        return valText;
    }

    _startLoop() {
        this.anim = new Konva.Animation((frame) => {
            if (!frame) return;
            if (this.isConsuming && this.pressure > 0) {
                // 物理公式修正：
                // 假设 consumptionRate 为标准状态下的流量，drop 为压降 (MPa)
                // 压降速率与容积成反比
                const drop = (this.consumptionRate / this.volume) * (frame.timeDiff / 1000);
                this.pressure = Math.max(0, this.pressure - drop);
                this.update();
            }
        }, this.sys.layer);
        this.anim.start();
    }

    // 外部获取当前压力 (求解器调用)
    getValue() {
        return this.pressure; // 直接返回内部 MPa 
    }

    refill(amount) {
        // amount 需为 MPa
        this.pressure = Math.min(this.maxPressure, this.pressure + amount);
        this.update();
    }

    getConfigFields() {
        return [
            { label: '器件名称 (ID)', key: 'id', type: 'text' },
            { label: '初始压力', key: 'pressure', type: 'number' },
            {
                label: '压力单位',
                key: 'unit',
                type: 'select',
                options: [
                    { label: 'MPa (兆帕)', value: 'MPa' },
                    { label: 'BAR (公斤)', value: 'BAR' }
                ]
            },
            { label: '气瓶容积 (L)', key: 'volume', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.id) this.id = newConfig.id;
        if (newConfig.volume) this.volume = parseFloat(newConfig.volume);

        this.displayUnit = newConfig.unit || 'MPa';

        if (newConfig.pressure !== undefined) {
            let inputP = parseFloat(newConfig.pressure);
            // 修正：内部存 MPa。如果输入的是 BAR，则除以 10
            this.pressure = (this.displayUnit === 'BAR') ? inputP / 10 : inputP;
        }
        this.update();
    }

    update() {
        if (this.pressureDisplay) {
            // 显示换算：内部 MPa -> 界面显示
            const displayValue = (this.displayUnit === 'BAR')
                ? (this.pressure * 10).toFixed(1)
                : this.pressure.toFixed(2);

            this.pressureDisplay.text(`${displayValue}\n${this.displayUnit}`);

            // 报警逻辑修正：0.15 MPa 约为原先的 1.5 BAR
            const isLow = this.pressure < 0.15;
            const blink = Math.sin(Date.now() / 200) > 0;
            const color = isLow ? (blink ? '#ff0000' : '#330000') : '#00ff00';

            this.pressureDisplay.fill(color);
            this.pressureDisplay.shadowColor(color);
            if (this.sys.layer) this.sys.layer.batchDraw();
        }
    }
}