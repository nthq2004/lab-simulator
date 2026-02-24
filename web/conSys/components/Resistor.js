import { BaseComponent } from './BaseComponent.js';

export class Resistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.width = 80;
        this.height = 25;
        // --- 物理属性 ---
        this.maxResistance = 385.1;
        this.type = 'resistor';
        this.currentResistance = 100;
        this.stepPercent = 0.01; // 1% 步进

        this.initVisuals();
        this.initInteractions();
        this.addPort(-24, this.height/2, 'l', 'wire');
        this.addPort(this.width+24, this.height/2, 'r', 'wire');

    }

    initVisuals() {
        // 1. 端子初始化 (保持 ID 不变)

        // 2. 电阻主体
        this.body = new Konva.Rect({
            width: this.width,
            height: this.height,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: this.height },
            fillLinearGradientColorStops: [0, '#d1d1d1', 0.5, '#fdfdfd', 1, '#b5b5b5'],
            stroke: '#555',
            strokeWidth: 1.5,
            cornerRadius: 2,
            shadowBlur: 5,
            shadowOpacity: 0.2
        });

        // 3. 连接导线 (修改点：接到右侧，加粗)
        this.connectorLine = new Konva.Line({
            // 初始路径：从右侧端点引出，向上折，连接到中间的箭头
            points: [this.width, this.height / 2, this.width + 10, this.height / 2, this.width + 10, -20, this.width*this.currentResistance / this.maxResistance, -20, this.width*this.currentResistance / this.maxResistance, 0],
            stroke: '#333',
            strokeWidth: 3, // 线条加粗
            lineJoin: 'round',
            lineCap: 'round'
        });

        // 4. 箭头滑块 (修改点：增加拖拽)
        this.arrow = new Konva.Group({
            x: this.width*this.currentResistance / this.maxResistance,
            y: -5,
            draggable: true,
            dragBoundFunc: (pos) => {
                // 限制只能在电阻宽度内水平拖动
                const transform = this.group.getAbsoluteTransform().copy();
                transform.invert();
                const localPos = transform.point(pos);
                const newX = Math.max(0, Math.min(this.width, localPos.x));

                // 返回绝对坐标
                const absTransform = this.group.getAbsoluteTransform();
                return absTransform.point({ x: newX, y: -5 });
            }
        });

        const arrowHead = new Konva.Arrow({
            points: [0, -15, 0, 10],
            pointerLength: 10,
            pointerWidth: 10,
            fill: '#2c3e50',
            stroke: '#2c3e50',
            strokeWidth: 3
        });

        this.valLabel = new Konva.Text({
            text: '100.00Ω',
            fontSize: 14,
            fontStyle: 'bold',
            y: -35,
            x: -35,
            width: 60,
            align: 'center',
            fill: '#e67e22'
        });

        this.arrow.add(arrowHead, this.valLabel);

        // 5. 引出线
        const leadL = new Konva.Line({ points: [-24, this.height / 2, 0, this.height / 2], stroke: '#409c72', strokeWidth: 6 });
        const leadR = new Konva.Line({ points: [this.width, this.height / 2, this.width + 24, this.height / 2], stroke: '#42c9b5', strokeWidth: 6 });

        this.group.add(leadL, leadR, this.body, this.connectorLine, this.arrow);

    }

    initInteractions() {
        // 点击逻辑 (步进)
        this.body.on('click tap', (e) => {
            const stage = this.sys.layer.getStage();
            const pointerPos = stage.getPointerPosition();
            const localX = pointerPos.x - (this.group.x() + this.body.x());

            const currentX = this.arrow.x();
            const stepValue = this.maxResistance * this.stepPercent;

            if (localX > currentX) {
                this.currentResistance = Math.min(this.maxResistance, this.currentResistance + stepValue);
            } else {
                this.currentResistance = Math.max(0, this.currentResistance - stepValue);
            }

            this.update(); // 使用动画更新
        });

        // 拖拽实时同步 (关键修正)
        this.arrow.on('dragmove', () => {
            // 1. 实时计算阻值
            this.currentResistance = (this.arrow.x() / this.width) * this.maxResistance;

            // 2. 强制连线同步更新，不使用 to() 动画
            const curX = this.arrow.x();
            this.connectorLine.points([
                this.width, this.height / 2,
                this.width + 10, this.height / 2,
                this.width + 10, -20,
                curX, -20,
                curX, 0
            ]);

            // 3. 更新文字
            this.valLabel.text(this.currentResistance.toFixed(2) + 'Ω');
            this.update();
        });

        this.arrow.on('mouseenter', () => this.sys.layer.getStage().container().style.cursor = 'ew-resize');
        this.arrow.on('mouseleave', () => this.sys.layer.getStage().container().style.cursor = 'default');
    }

    /**
 * 更新视图
 */
    update() {
        const ratio = this.currentResistance / this.maxResistance;
        const newX = ratio * this.width;
        const targetPoints = [this.width, this.height / 2, this.width + 10, this.height / 2, this.width + 10, -20, newX, -20, newX, 0];

        this.arrow.x(newX);
        this.connectorLine.points(targetPoints);

        this.valLabel.text(this.currentResistance.toFixed(2) + 'Ω');
        this.sys.layer.draw();
    }
}