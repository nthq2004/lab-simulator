export class AdjustableResistor {
    constructor(config) {
        this.layer = config.layer;
        this.x = config.x || 210;
        this.y = config.y || 100;

        // --- 物理属性 ---
        this.maxResistance = 500;
        this.currentResistance = 250;
        this.stepPercent = 0.10; // 10% 步进
        this.width = config.width || 80;
        this.height = config.height || 25;

        this.terminals = [];
        this.onTerminalClick = config.onTerminalClick || null;
        this.onStateChange = config.onStateChange || null;
        this.type = 'adjResistor';

        // --- Konva 元素组 ---
        this.group = new Konva.Group({
            x: this.x,
            y: this.y,
            draggable: true,
            id: config.id || 'pRr'
        });

        this.initVisuals();
        this.initInteractions();
        this.layer.add(this.group);
    }

    initVisuals() {
        // 1. 端子初始化 (保持 ID 不变)
        this.terminalP = new Konva.Circle({ x: -24, y: this.height / 2, radius: 8, stroke: '#333', strokeWidth: 2, fill: '#a6626b', id: 'pRr_wire_p' });
        this.terminalN = new Konva.Circle({ x: this.width + 24, y: this.height / 2, radius: 8, stroke: '#333', strokeWidth: 2, fill: '#914949', id: 'pRr_wire_n' });

        [this.terminalP, this.terminalN].forEach(term => {
            this.terminals.push(term);
            term.setAttrs({ connType: 'wire', termId: term.id(), parentId: this.group.id() });
            term.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                if (this.onTerminalClick) this.onTerminalClick(term);
            });
        });

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
            points: [this.width, this.height / 2, this.width + 10, this.height / 2, this.width + 10, -20, this.width / 2, -20, this.width / 2, 0],
            stroke: '#333',
            strokeWidth: 3, // 线条加粗
            lineJoin: 'round',
            lineCap: 'round'
        });

        // 4. 箭头滑块 (修改点：增加拖拽)
        this.arrow = new Konva.Group({
            x: this.width / 2,
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
            text: '250Ω',
            fontSize: 14,
            fontStyle: 'bold',
            y: -35,
            x: -25,
            width: 50,
            align: 'center',
            fill: '#e67e22'
        });

        this.arrow.add(arrowHead, this.valLabel);

        // 5. 引出线
        const leadL = new Konva.Line({ points: [-24, this.height / 2, 0, this.height / 2], stroke: '#409c72', strokeWidth: 6 });
        const leadR = new Konva.Line({ points: [this.width, this.height / 2, this.width + 24, this.height / 2], stroke: '#42c9b5', strokeWidth: 6 });

        this.group.add(leadL, leadR, this.body, this.connectorLine, this.arrow);
        this.group.add(this.terminalP, this.terminalN); // 确保端子在最上层
    }

    initInteractions() {
        // 点击逻辑 (步进)
        this.body.on('click tap', (e) => {
            const stage = this.layer.getStage();
            const pointerPos = stage.getPointerPosition();
            const localX = pointerPos.x - (this.group.x() + this.body.x());

            const currentX = this.arrow.x();
            const stepValue = this.maxResistance * this.stepPercent;

            if (localX > currentX) {
                this.currentResistance = Math.min(this.maxResistance, this.currentResistance + stepValue);
            } else {
                this.currentResistance = Math.max(0, this.currentResistance - stepValue);
            }

            this.notifyChange();
            this.update(true); // 使用动画更新
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
            this.valLabel.text(Math.round(this.currentResistance) + 'Ω');

            this.notifyChange();
            this.layer.batchDraw();
        });

        this.arrow.on('mouseenter', () => this.layer.getStage().container().style.cursor = 'ew-resize');
        this.arrow.on('mouseleave', () => this.layer.getStage().container().style.cursor = 'default');
    }



    notifyChange() {
        if (this.onStateChange) {
            this.onStateChange(this.group.id(), { 'resistance': this.currentResistance });
        }
    }

    setValue(resistance) {
        this.currentResistance = Math.max(0, Math.min(this.maxResistance, resistance));
        this.update(true);
    }

    /**
     * 更新视图
     * @param {boolean} useAnimation 是否使用平滑动画
     */
    update() {
        const ratio = this.currentResistance / this.maxResistance;
        const newX = ratio * this.width;
        const targetPoints = [this.width, this.height / 2, this.width + 10, this.height / 2, this.width + 10, -20, newX, -20, newX, 0];

        this.arrow.x(newX);
        this.connectorLine.points(targetPoints);

        this.valLabel.text(Math.round(this.currentResistance) + 'Ω');
        this.layer.batchDraw();
    }

    getValue() {
        return this.currentResistance;
    }
}