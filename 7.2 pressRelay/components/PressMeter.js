import { BaseComponent } from './BaseComponent.js';

export class PressMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        
        // 1. 基础配置与缩放
        this.scale = config.scale || 1;
        this.radius = (config.radius || 80) * this.scale;
        this.textRadius = this.radius - (25 * this.scale);
        
        // 组件宽高（用于容器对齐）
        this.w = (this.radius + 10) * 2;
        this.h = (this.radius + 40) * 2;

        this.type = 'pressMeter';
        
        // 2. 物理量程与角度 (内部存储 MPa)
        this.startAngle = -120;
        this.endAngle = 120;
        this.min = config.min !== undefined ? config.min : 0;
        this.max = config.max !== undefined ? config.max : 1.0; // 默认 1.0 MPa
        this.pressure = 0;
        this.title = config.title || '压力表 MPa';

        // 3. 执行初始化
        this.initVisuals();

        // 4. 添加进气端口 (位于表盘正下方)
        // 坐标系：Center是(0,0)，所以下方是 (0, radius + 延伸管长度)
        this.addPort(0, this.radius + 28 * this.scale, 'i', 'pipe','in');
    }

    initVisuals() {
        // 创建视觉容器，中心点对齐
        this.viewGroup = new Konva.Group({
            x: 0, 
            y: 0
        });
        this.group.add(this.viewGroup);

        // 按层级绘制
        this._drawShell();
        this._drawPipe();  // 底座接头
        this._drawZones(); // 安全分区
        this._drawTicks(); // 刻度与数字
        this._drawPointer();
        this._drawCenter();
        this._drawLcd();
        this._drawName();
        
        // 初次同步 UI
        this.update(this.pressure);
    }

    /** 数值 → 角度（线性映射） */
    valueToAngle(value) {
        const ratio = (value - this.min) / (this.max - this.min);
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        return this.startAngle + clampedRatio * (this.endAngle - this.startAngle);
    }

    _drawShell() {
        this.viewGroup.add(new Konva.Circle({
            radius: this.radius + 6 * this.scale,
            stroke: '#333',
            strokeWidth: 4 * this.scale,
            fillRadialGradientEndPoint: { x: 20 * this.scale, y: 20 * this.scale },
            fillRadialGradientEndRadius: this.radius + 10 * this.scale,
            fillRadialGradientColorStops: [0, '#ffffff', 0.5, '#d0d6da', 1, '#9aa1a5']
        }));
    }

    _drawPipe() {
        const pW = 20 * this.scale;
        const pH = 25 * this.scale;
        this.viewGroup.add(new Konva.Rect({
            x: -pW / 2,
            y: this.radius + 4 * this.scale,
            width: pW,
            height: pH,
            stroke: '#555',
            strokeWidth: 3 * this.scale,
            fill: '#a09c9c',
            cornerRadius: 2
        }));
    }

    _drawZones() {
        const zones = [
            { from: 0.0, to: 0.8 * this.max, color: '#5ff475' }, // 正常区
            { from: 0.8 * this.max, to: 1.0 * this.max, color: '#f80202' } // 危险区
        ];

        zones.forEach(z => {
            const startA = this.valueToAngle(z.from);
            const endA = this.valueToAngle(z.to);
            
            this.viewGroup.add(new Konva.Arc({
                innerRadius: this.radius - 12 * this.scale,
                outerRadius: this.radius,
                angle: endA - startA,
                rotation: startA - 90,
                fill: z.color,
                opacity: 0.5
            }));
        });
    }

    _drawTicks() {
        const majorCount = 10;
        const totalSteps = 50; // 增加细分刻度增加机械感
        const range = this.max - this.min;

        for (let i = 0; i <= totalSteps; i++) {
            const v = this.min + (range * i / totalSteps);
            const angle = this.valueToAngle(v);
            const rad = (angle - 90) * (Math.PI / 180);

            const isMajor = i % (totalSteps / majorCount) === 0;
            const len = (isMajor ? 16 : 8) * this.scale;

            this.viewGroup.add(new Konva.Line({
                points: [
                    (this.radius - len) * Math.cos(rad), (this.radius - len) * Math.sin(rad),
                    this.radius * Math.cos(rad), this.radius * Math.sin(rad)
                ],
                stroke: '#111',
                strokeWidth: (isMajor ? 2 : 1) * this.scale
            }));

            if (isMajor) {
                this.viewGroup.add(new Konva.Text({
                    x: this.textRadius * Math.cos(rad) - 15 * this.scale,
                    y: this.textRadius * Math.sin(rad) - 6 * this.scale,
                    width: 30 * this.scale,
                    align: 'center',
                    text: v.toFixed(1),
                    fontSize: 11 * this.scale,
                    fontStyle: 'bold',
                    fill: '#000'
                }));
            }
        }
    }

    _drawPointer() {
        this.pointer = new Konva.Line({
            points: [0, 5 * this.scale, 0, -(this.radius - 15 * this.scale)],
            stroke: '#c0392b',
            strokeWidth: 3 * this.scale,
            lineCap: 'round',
            rotation: this.startAngle
        });
        this.viewGroup.add(this.pointer);
    }

    _drawCenter() {
        this.viewGroup.add(new Konva.Circle({
            radius: 5 * this.scale,
            fill: '#333',
            stroke: '#000',
            strokeWidth: 1
        }));
    }

    _drawLcd() {
        const w = 70 * this.scale, h = 24 * this.scale;
        const y = this.radius * 0.45+10*this.scale;

        const lcdRect = new Konva.Rect({
            x: -w / 2, y: y, width: w, height: h,
            cornerRadius: 4 * this.scale,
            fill: '#072207', stroke: '#333', strokeWidth: 1
        });

        this.lcdText = new Konva.Text({
            x: -w / 2, y: y+4 * this.scale, width: w,
            align: 'center',
            text: '0.000',
            fontSize: 14 * this.scale,
            fontFamily: 'monospace',
            fill: '#7fff7f'
        });

        this.viewGroup.add(lcdRect, this.lcdText);
    }

    _drawName() {
        this.nameText = new Konva.Text({
            x: -this.radius,
            y: this.radius * 0.35,
            width: this.radius * 2,
            align: 'center',
            text: this.title,
            fontSize: 12 * this.scale,
            fontStyle: 'bold',
            fill: '#444'
        });
        this.viewGroup.add(this.nameText);
    }

    /**
     * 核心更新方法：供求解器调用
     * @param {number} inP 传入的压力值 (MPa)
     */
    update(inP = 0) {
        // 数据限幅
        const val = Math.max(this.min, Math.min(this.max * 1.1, inP));
        this.pressure = val;

        const targetAngle = this.valueToAngle(val);

        // 指针动画或直接赋值
        if (this.pointer) {
            // 如果为了流畅度，可以使用 Tween，但如果是 Solver 每帧调用，直接 rotation 性能更好
            this.pointer.rotation(targetAngle);
        }

        // LCD 更新
        if (this.lcdText) {
            this.lcdText.text(val.toFixed(3));
        }

        // 如果压力超过 max，LCD 变色提醒
        if (this.lcdText) {
            this.lcdText.fill(val > this.max ? '#ff0000' : '#7fff7f');
        }

        if (this.sys?.layer) this.sys.layer.batchDraw();
    }

    // --- 系统接口 ---
    getValue() {
        return this.pressure;
    }

    getConfigFields() {
        return [
            { label: '器件名称', key: 'title', type: 'text' },
            { label: '最大量程 (MPa)', key: 'max', type: 'number' },
            { label: '最小量程 (MPa)', key: 'min', type: 'number' }
        ];
    }

    onConfigUpdate(newConfig) {
        if (newConfig.title) this.title = newConfig.title;
        if (newConfig.max) this.max = parseFloat(newConfig.max);
        if (newConfig.min) this.min = parseFloat(newConfig.min);
        
        // 重绘刻度（简单处理：销毁重建视觉组）
        this.viewGroup.destroy();
        this.initVisuals();
    }
}