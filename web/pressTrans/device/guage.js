export class Gauge {
    constructor(options) {
        this.min = options.min ?? 0;
        this.max = options.max ?? 100;
        this.value = options.value ?? 0;

        // ✔ 船舶仪表标准：270°,这里采用-120° ~ +120°，240度
        this.startAngle = -120;
        this.endAngle = 120;

        // 半径限定在 [70, 140]，默认 80
        this.radius = Math.max(70, Math.min(140, options.radius ?? 80));
        this.textRadius = this.radius - 22;

        this.layer = options.layer;//一般分为3层：线缆层、组件层、UI层，仪表放在组件层，最下面，以免遮挡线缆，UI放最上层

        this.group = new Konva.Group({
            x: options.x || 110,
            y: options.y || 320,
            id: options.id,
            name: options.name,
            draggable: true
        });

        // 保存名称，避免直接访问 Konva 节点属性不可靠
        this.title = options.name ?? '';
        this.type = options.type || 'aGauge'; // 仪表类型，默认电流表 'aGauge'，可选气压表 'pGauge'
        this.layer.add(this.group);

        // 顺序非常关键（从底到顶）
        this._drawShell();
        this._drawZones();
        this._drawTicks();
        this._drawPointer();
        this._drawCenter();
        this._drawLcd();
        this._drawname();

        // 终端点击回调（外部可传入）：function(termShape) { ... }
        this.onTerminalClick = options.onTerminalClick || null;
        // 在外壳正下方左右各增加一个接线柱（相隔60度），用于电路连线
        this._drawTerminals();

        this.setValue(this.value);// 初始化指针位置和LCD显示。
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
            { from: 0.0, to: 0.7, color: '#2ecc71' },
            { from: 0.7, to: 0.9, color: '#f1c40f' },
            { from: 0.9, to: 1.0, color: '#e74c3c' }
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
    /* ===============================
        在表壳正下方左右添加两个端子（相隔60度），用于连线
     =============================== */
    _drawTerminals() {
        // 以垂直正下（180°）为中心，左右各偏 30° -> -150° 与 150°

        const r = this.radius + 10; // 放在表盘外一点
        this.terminals = [];

        if (this.type === 'aGauge') {
            /** --- 电流表：在左右两侧创建两个圆形电气端子 --- **/
            const angles = [150, -150];
            angles.forEach((deg, idx) => {
                const rad = Konva.getAngle(deg - 90); // 与刻度计算保持一致的角度转换
                const x = r * Math.cos(rad);
                const y = r * Math.sin(rad);
                const id = `${this.group.id()}_wire_${idx === 0 ? 'p' : 'n'}`;
                const fill = idx === 0 ? '#ff4757' : '#2f3542';
                const term = new Konva.Circle({
                    x, y,
                    radius: 8,
                    fill,
                    stroke: '#333',
                    id,
                    //把圆异化成一个矩形，用什么参数呢？用cornerRadius
                    cornerRadius: 4


                });
                term.strokeWidth(2);
                term.stroke('#333');
                term.setAttr('connType', 'wire');
                term.setAttr('termId', id);
                term.setAttr('parentId', this.group.id());
                term.on('mousedown touchstart', (e) => {
                    e.cancelBubble = true;
                    this.onTerminalClick(term);
                });
                this.group.add(term);
                this.terminals.push(term);
            });
        } else if (this.type === 'pGauge') {
            /** --- 气压表：在正下方（180°）创建一个矩形管路端子 --- **/
            const rad = Konva.getAngle(90);; // 正下方
            const x = r * Math.cos(rad);
            const y = r * Math.sin(rad);
            const id = `${this.group.id()}_pipe_i`;
            const fill = '#2f2b2c66'; // 灰色，代表金属管路接口;
            const term = new Konva.Rect({
                x: x - 10, // 居中修正（矩形起点在左上角）
                y: y - 5,
                width: 22,
                height: 14,
                fill: '#95a5a6', // 工业灰色，代表金属管路接口
                cornerRadius: 2,
                id
            });
            term.strokeWidth(2);
            term.stroke('#333');
            term.setAttr('connType', 'pipe');
            term.setAttr('termId', id);
            term.setAttr('parentId', this.group.id());
            term.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                this.onTerminalClick(term);
            });
            this.group.add(term);
            this.terminals.push(term);
        }


    }

    setPower(on) {
        // 仪表本身没有电源开关，但可以通过这个方法控制是否响应数值变化
        this.isPowered = on;

    }
    /* ===============================
       设置数值（动画）
    =============================== */
    setValue(value) {
        this.value = value;
        this.update();
    }

    getValue() {
        return this.value;
    }

    update() {
        const value = Math.max(this.min, Math.min(this.max, this.value));
        const angle = this.valueToAngle(value);

        if (this.tween) this.tween.destroy();
        if (this._lcdInterval) {
            clearInterval(this._lcdInterval);
            this._lcdInterval = null;
        }

        // 指针动画
        this.tween = new Konva.Tween({
            node: this.pointer,
            rotation: angle,
            duration: 0.8,
            easing: Konva.Easings.EaseInOut
        });
        this.tween.play();

        const startValue = this._currentValue ?? this.min;
        const endValue = this.value;
        this._currentValue = endValue;
        // LCD 数字动画（线性插值，保留一位小数）
        const duration = 800;
        const startTime = Date.now();
        this._lcdInterval = setInterval(() => {
            const t = Math.min(1, (Date.now() - startTime) / duration);
            const cur = startValue + (endValue - startValue) * t;
            if (this.lcdText) this.lcdText.text(cur.toFixed(2));
            if (this.layer && this.layer.batchDraw) this.layer.batchDraw();
            if (t === 1) {
                clearInterval(this._lcdInterval);
                this._lcdInterval = null;
            }
        }, 30);
    }
}