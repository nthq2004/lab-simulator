import { BaseComponent } from './BaseComponent.js';

export class AmpMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.radius = config.radius || 70;
        this.textRadius = this.radius - 22;
        // ✔ 船舶仪表标准：270°,这里采用-120° ~ +120°，240度
        this.startAngle = -120;
        this.endAngle = 120;
        this.min = 0;
        this.max = 20;
        this.value = 0;
        this.title = '电流表mA';
        this.init();

        const radp = Konva.getAngle(120); // 与刻度计算保持一致的角度转换
        const x1 = (this.radius + 10) * Math.cos(radp);
        const y1 = (this.radius + 10) * Math.sin(radp);
        this.addPort(x1, y1, 'n', 'wire');
        const radn = Konva.getAngle(60); // 与刻度计算保持一致的角度转换
        const x2 = (this.radius + 10) * Math.cos(radn);
        const y2 = (this.radius + 10) * Math.sin(radn);
        this.addPort(x2, y2, 'p', 'wire', 'p');

    }

    init() {
        // 顺序非常关键（从底到顶）
        this._drawShell();
        this._drawZones();
        this._drawTicks();
        this._drawPointer();
        this._drawCenter();
        this._drawLcd();
        this._drawname();
    }
    /* ===============================
       数值 → 角度（唯一映射）
    =============================== */
    valueToAngle(value) {
        const ratio = (value - this.min) / (this.max - this.min);
        return this.startAngle + ratio * (this.endAngle - this.startAngle);
    }
    /* ===============================
       仪表外框
    =============================== */
    _drawShell() {
        this.group.add(
            new Konva.Circle({
                x: 0,
                y: 0,
                radius: this.radius + 6,
                stroke: '#333',
                strokeWidth: 4,
                // 金属质感：径向渐变
                fillRadialGradientStartPoint: { x: -20, y: -20 },
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndPoint: { x: 20, y: 20 },
                fillRadialGradientEndRadius: this.radius + 10,
                fillRadialGradientColorStops: [0, '#ffffff', 0.5, '#d0d6da', 1, '#9aa1a5']
            })
        );
    }


    /* ===============================
       安全区（绿 / 黄 / 红）
    =============================== */
    _drawZones() {
        const zones = [
            { from: 0.0, to: 0.2, color: '#e74c3c' },
            { from: 0.2, to: 0.9, color: '#2ecc71' },
            { from: 0.9, to: 1.0, color: '#f1c40f' }
        ];

        zones.forEach(z => {
            const angle = (z.to - z.from) * (this.endAngle - this.startAngle);
            const rotation = this.startAngle - 90 + z.from * (this.endAngle - this.startAngle);

            this.group.add(
                new Konva.Arc({
                    x: 0,
                    y: 0,
                    innerRadius: this.radius - 12,
                    outerRadius: this.radius,
                    angle: angle,
                    rotation: rotation,
                    fill: z.color,
                    opacity: 0.65
                })
            );
        });
    }

    /* ===============================
       刻度（完全按数值生成）
    =============================== */
    _drawTicks() {
        const majorCount = 10; // 总共分10个大格
        const totalSteps = 20; // 总共20个小格（minorStep）
        const range = this.max - this.min;

        for (let i = 0; i <= totalSteps; i++) {
            // 通过索引计算当前数值，而不是累加
            const v = this.min + (range * i / totalSteps);
            const angle = this.valueToAngle(v);
            const rad = Konva.getAngle(angle - 90);

            const isMajor = i % (totalSteps / majorCount) === 0;
            const len = isMajor ? 16 : 8;

            // 刻度线
            this.group.add(
                new Konva.Line({
                    points: [
                        (this.radius - len) * Math.cos(rad),
                        (this.radius - len) * Math.sin(rad),
                        this.radius * Math.cos(rad),
                        this.radius * Math.sin(rad)
                    ],
                    stroke: '#111',
                    strokeWidth: isMajor ? 2 : 1
                })
            );

            // 主刻度数字
            if (isMajor) {
                const textRad = Konva.getAngle(angle - 90);

                this.group.add(
                    new Konva.Text({
                        x: this.textRadius * Math.cos(textRad) - 14,
                        y: this.textRadius * Math.sin(textRad) - 6,
                        width: 28,
                        align: 'center',
                        text: v.toString(),
                        fontSize: 11,
                        fill: '#000'
                    })
                );
            }
        }
    }

    /* ===============================
       指针
    =============================== */
    _drawPointer() {
        this.pointer = new Konva.Line({
            points: [0, 0, 0, -(this.radius - 25)],
            stroke: '#c0392b',
            strokeWidth: 3,
            lineCap: 'round',
            rotation: this.startAngle
        });
        this.group.add(this.pointer);
    }
    /* ===============================
       指针的轴心点
    =============================== */
    _drawCenter() {
        this.group.add(
            new Konva.Circle({
                x: 0,
                y: 0,
                radius: 4,
                fill: '#333'
            })
        );
    }
    /* ===============================
       中心下方的LCD显示屏
    =============================== */
    _drawLcd() {
        const w = 70;
        const h = 24;
        const x = -w / 2;
        // 向下移动一点（原 0.38 -> 0.44）
        const y = this.radius * 0.44;

        this.lcdGroup = new Konva.Group({
            x: 0,
            y: y
        });

        // 外壳（浅金属 + 暗边）
        this.lcdGroup.add(new Konva.Rect({
            x: x,
            y: 0,
            width: w,
            height: h,
            cornerRadius: 6,
            stroke: '#333',
            strokeWidth: 1,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h },
            fillLinearGradientColorStops: [0, '#ececec', 0.6, '#c8c8c8', 1, '#9a9a9a']
        }));

        // 内部显示窗（绿色背光）
        this.lcdGroup.add(new Konva.Rect({
            x: x + 4,
            y: 4,
            width: w - 8,
            height: h - 8,
            cornerRadius: 4,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: h - 8 },
            fillLinearGradientColorStops: [0, '#0b2a0b', 0.6, '#042404', 1, '#072207']
        }));

        // 数字文本（初始显示保留一位小数）
        this.lcdText = new Konva.Text({
            x: x + 4,
            y: 4,
            width: w - 8,
            align: 'center',
            text: Number(this.min).toFixed(1),
            fontSize: 14,
            fontFamily: 'monospace',
            fill: '#7fff7f'
        });
        this.lcdGroup.add(this.lcdText);

        this.group.add(this.lcdGroup);
    }
    /* ===============================
       在轴心上方显示仪表名称，this.group.name 属性
    =============================== */
    _drawname() {
        const w = 140;
        const h = 20;
        const x = -w / 2;

        // 名称上移一些，确保位于液晶屏上方且仍在轴心下方
        let y;
        if (this.lcdGroup) {
            const desired = this.lcdGroup.y() - h - 12; // 比之前上移更多，留出间隙
            y = Math.max(12, desired); // 最小为 8，确保在轴心（y=0）下方
        } else {
            y = Math.max(12, this.radius * 0.12);
        }

        this.nameText = new Konva.Text({
            x: x,
            y: y,
            width: w,
            align: 'center',
            text: String(this.title ?? ''),
            fontSize: 14,
            fontStyle: 'bold',
            fill: '#222',
            listening: false
        });

        this.group.add(this.nameText);
    }
    update(mA) {
        // 1️⃣ 数据限幅与更新逻辑
        const clamped = Math.max(this.min, Math.min(this.max, mA));
        this.value = clamped;
        this._currentValue = clamped; // 立即同步

        // 2️⃣ 计算物理角度
        const angle = this.valueToAngle(clamped);

        // 4️⃣ 立即更新 UI 组件属性
        if (this.pointer) {
            this.pointer.rotation(angle); // 立即设置旋转角度
        }

        if (this.lcdText) {
            this.lcdText.text(clamped.toFixed(2)); // 立即设置文本
            
            // 💡 增加一个逻辑检查：如果数值过大变色报警
            if (clamped >= 100) {
                this.lcdText.fill('#ff4444'); // 红色
            } else {
                this.lcdText.fill('#7fff7f'); // 恢复绿色
            }
        }

        // 5️⃣ 强制要求图层重绘
        if (this.sys && this.sys.layer) {
            this.sys.layer.batchDraw();
        }
    }
}